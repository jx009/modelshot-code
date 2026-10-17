import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { adjustPixels } from "../../src/lib/studio/adjustments.js";
import { createImageQueue } from "../../src/lib/studio/image-queue.js";
import { alignLayers, distributeLayers, selectedLayerIds, layersInRect } from "../../src/lib/studio/layer-operations.js";
import { jobEvent, createJobStream } from "../../src/lib/domain/studio/job-stream.js";
import { runImageTool } from "../../src/lib/domain/studio/execution.js";
import { jobSchema } from "../../src/lib/studio/tools.js";
const solid = color => sharp({ create: { width: 64, height: 64, channels: 4, background: color } }).png().toBuffer();

it("preserves identity pixels and alpha, and produces neutral monochrome", () => {
  const source = new Uint8ClampedArray([90,120,30,0,200,60,80,128]);
  expect(adjustPixels(source.slice(),2,1,{})).toEqual(source);
  const result = adjustPixels(source.slice(),2,1,{ saturation:-100 });
  expect(result[0]).toBe(result[1]); expect(result[1]).toBe(result[2]);
  expect([result[3],result[7]]).toEqual([0,128]);
});
it("bounds concurrent image work, drains after rejection, and retains result order", async () => {
  const queue = createImageQueue(4); let running=0, peak=0;
  const tasks = Array.from({ length:20 },(_,i) => queue(async () => {
    running++; peak=Math.max(peak,running);
    await new Promise(resolve => setTimeout(resolve,2)); running--;
    if (i===6) throw new Error("decode failed"); return i;
  }));
  const results = await Promise.allSettled(tasks);
  expect(peak).toBe(4); expect(results[6].status).toBe("rejected"); expect(results[19].value).toBe(19);
});
it("text replacement uses a real mask and preserves all unselected pixels", async () => {
  const image=await solid("red"), output=await solid("blue");
  const mask=await sharp(await solid("black")).composite([{ input:await sharp({ create:{ width:16,height:16,channels:4,background:"white" } }).png().toBuffer(),left:16,top:16 }]).png().toBuffer();
  const generate=vi.fn(async () => output);
  const result=await runImageTool({}, {tool:"text-edit",params:{newText:"新品",prompt:"",size:"1024x1024"}},image,mask,null,{generate});
  expect(generate.mock.calls[0][1].prompt).toContain('"新品"'); expect(generate.mock.calls[0][1].mask).toBeInstanceOf(Buffer);
  const pixels=await sharp(result.images[0]).raw().toBuffer();
  expect([...pixels.subarray(0,4)]).toEqual([255,0,0,255]);
  expect([...pixels.subarray((20*64+20)*4,(20*64+20)*4+4)]).toEqual([0,0,255,255]);
});
it("focus preserves original input and supplies a separate numbered guide", async () => {
  const original=await solid("red"), generate=vi.fn(async () => original);
  await runImageTool({}, {tool:"focus",params:{prompt:"@1 blue",size:"1024x1024",focusPoints:[{id:"one",x:.5,y:.5,label:"bottle"}]}},original,null,null,{generate});
  const args=generate.mock.calls[0][1]; expect(args.image).toBe(original); expect(args.references).toHaveLength(1);
  expect(args.references[0].equals(original)).toBe(false); expect(args.prompt).toContain("bottle");
});
it("extracts a recipe as language output without starting image generation", async () => {
  const generate=vi.fn(), vision=vi.fn(async () => "Subject: {product}; soft light");
  const result=await runImageTool({}, {tool:"template",params:{}},await solid("red"),null,null,{generate,vision});
  expect(result.text).toContain("{product}"); expect(generate).not.toHaveBeenCalled();
});
it("rejects paid submissions missing tool-specific input and rejects local adjustments", () => {
  const base={documentId:"doc",documentVersion:1,targetId:"target",assetId:"asset",params:{prompt:"change"}};
  for (const tool of ["focus","merge","translate","text-edit","adjust"]) expect(jobSchema.safeParse({...base,tool}).success).toBe(false);
  expect(jobSchema.safeParse({...base,tool:"focus",params:{prompt:"@1 blue",focusPoints:[{id:"one",x:2,y:0,label:"a"}]}}).success).toBe(false);
});
it("aligns rotated bounding boxes, ignores locked layers, and distributes equal gaps", () => {
  const layers=[{id:"a",x:0,y:0,width:10,height:20,visible:true,selectionGroup:"g"},{id:"b",x:30,y:5,width:10,height:20,visible:true,selectionGroup:"g"},{id:"c",x:100,y:10,width:20,height:20,visible:true},{id:"d",x:70,y:0,width:20,height:20,locked:true}];
  expect(selectedLayerIds(layers,[],"a")).toEqual(["a","b"]);
  expect(selectedLayerIds(layers,["a","b","c"],"a",true)).toEqual(["c"]);
  const aligned=alignLayers(layers,["a","b","d"],"left"); expect(aligned[1].x).toBe(0); expect(aligned[3].x).toBe(70);
  const distributed=distributeLayers(layers,["a","b","c"]); expect(distributed[1].x).toBe(50);
  const rotated=alignLayers([{...layers[0],rotation:90},layers[1]],["a","b"],"left"); expect(rotated[1].x).toBeCloseTo(-20);
  expect(layersInRect(layers,{x:0,y:0,width:1,height:1})).toEqual(["a","b"]);
  expect(layersInRect(layers,{x:69,y:0,width:5,height:5})).toEqual([]);
});
it("streams complete snapshots with stable IDs, emits changes, and stops on cancellation", async () => {
  const rows=[{id:"job",status:"running"}];
  expect(jobEvent(rows).id).toBe(jobEvent(structuredClone(rows)).id);
  const read=vi.fn(async () => rows);
  const reader=createJobStream(read,null,{interval:5,lifetime:1000}).getReader();
  await reader.read();
  const first=new TextDecoder().decode((await reader.read()).value); expect(first).toContain('"running"');
  rows[0].status="succeeded";
  const next=new TextDecoder().decode((await reader.read()).value); expect(next).toContain('"succeeded"');
  await reader.cancel(); const count=read.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve,15)); expect(read).toHaveBeenCalledTimes(count);
});
