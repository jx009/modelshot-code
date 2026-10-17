import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("case imports owned references once, jobs stream safely, and scene editing generates durable output", async ({page},info) => {
  const db = new PrismaClient({adapter:new PrismaPg({connectionString:getTestEnvironment().databaseUrl})});
  const email=`recipes-${info.project.name}-${Date.now()}@modelshot.test`;
  try {
    const user=await db.user.create({data:{email,passwordHash:await bcrypt.hash(E2E_PASSWORD,10),credits:100,emailVerified:new Date()}});
    expect((await page.request.get("/api/studio/events?documentId=private")).status()).toBe(401);
    await page.goto("/en/login?callbackUrl=/en/explore/quiet-living");
    await page.getByRole("button",{name:"Email",exact:true}).click();
    await page.getByLabel("Email",{exact:true}).fill(email); await page.getByLabel("Password",{exact:true}).fill(E2E_PASSWORD);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await expect(page.getByRole("button",{name:"Use recipe in canvas",exact:true})).toBeVisible();
    const key=randomUUID(), data={caseId:"quiet-living",locale:"en",createKey:key};
    const first=await page.request.post("/api/studio/cases",{data}); expect(first.ok(),await first.text()).toBe(true);
    const imported=await first.json();
    expect(await (await page.request.post("/api/studio/cases",{data})).json()).toEqual(imported);
    const document=await db.studioDocument.findUnique({where:{id:imported.documentId}});
    expect(document.userId).toBe(user.id); expect(document.content.composer).toMatchObject({size:"1024x1536",outputCount:1});
    expect(document.content.layers).toHaveLength(1);
    expect(await db.asset.count({where:{userId:user.id}})).toBe(1);
    expect((await page.request.get("/api/studio/events?documentId=not-owned")).status()).toBe(404);
    await page.goto(`/en/studio-v2?document=${imported.documentId}`);
    const firstFrame=await page.evaluate(async id=>{
      const controller=new AbortController();
      try {
        const response=await fetch(`/api/studio/events?documentId=${id}`,{signal:controller.signal});
        const reader=response.body.getReader(); let text="";
        while(!text.includes("event: jobs")) { const {value,done}=await reader.read(); if(done)break; text+=new TextDecoder().decode(value); }
        await reader.cancel(); return {type:response.headers.get("content-type"),text};
      } finally {controller.abort();}
    },imported.documentId);
    expect(firstFrame.type).toBe("text/event-stream"); expect(firstFrame.text).toContain("data: []");
    const target=document.content.layers[0], jobKey=randomUUID();
    const body={tool:"translate",documentId:document.id,documentVersion:document.version,targetId:target.id,assetId:target.assetId,params:{language:"en",size:"1024x1536",prompt:"Preserve product"}};
    const jobResponse=await page.request.post("/api/studio/jobs",{headers:{"Idempotency-Key":jobKey},data:body}); expect(jobResponse.status(),await jobResponse.text()).toBe(202);
    const job=await jobResponse.json();
    expect((await (await page.request.post("/api/studio/jobs",{headers:{"Idempotency-Key":jobKey},data:body})).json()).id).toBe(job.id);
    await expect.poll(async()=> (await db.tryOn.findUnique({where:{id:job.id}})).status,{timeout:45000}).toBe("succeeded");
    expect((await db.user.findUnique({where:{id:user.id}})).credits).toBe(82);
    const final=await db.tryOn.findUnique({where:{id:job.id}}); expect(final.resultData.assets).toHaveLength(1);
    await page.reload();
    await expect(page.locator(".ms-canvas-label")).toContainText("2 layers");
  } finally { await db.$disconnect(); }
});
