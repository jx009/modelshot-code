import { expect, it } from "vitest";
import { IMAGE_RATIOS, IMAGE_RESOLUTIONS, IMAGE_SIZES, imageSizeChoice, resolveImageSize, imageSizeError } from "../../src/lib/studio/image-size.js";
import { paramsSchema, contentSchema } from "../../src/lib/studio/tools.js";
import { commerceSchema } from "../../src/lib/commerce/schema.js";

it("accepts all 15 ratios at three resolutions and bounds extreme image sizes",()=>{
  expect(IMAGE_RATIOS).toHaveLength(15);
  for(const ratio of IMAGE_RATIOS) for(const resolution of IMAGE_RESOLUTIONS) {
    const size=`${ratio}@${resolution}`;
    expect(paramsSchema.parse({size}).size).toBe(size);
    const [w,h]=resolveImageSize(size).split("x").map(Number);
    expect(Math.max(w,h)).toBeLessThanOrEqual(8192);
    expect(Math.min(w,h)).toBeGreaterThanOrEqual(256);
    expect(w%16).toBe(0); expect(h%16).toBe(0);
    if(ratio!=="auto") {
      const [rw,rh]=ratio.split(":").map(Number);
      expect(Math.abs(w/h-rw/rh)/(rw/rh)).toBeLessThan(.025);
    }
  }
  expect(paramsSchema.safeParse({size:"99999x99999"}).success).toBe(false);
  expect(paramsSchema.safeParse({size:"16:9@8K"}).success).toBe(false);
});
it("keeps legacy projects unchanged and resolves smart ratios from the source",()=>{
  for(const size of IMAGE_SIZES.slice(0,3)) expect(resolveImageSize(size)).toBe(size);
  expect(imageSizeChoice("1024x1536")).toMatchObject({ratio:"2:3",resolution:"1K"});
  expect(resolveImageSize("auto@2K")).toBe("2048x2048");
  expect(resolveImageSize("auto@2K",{width:1600,height:900})).toBe(resolveImageSize("16:9@2K"));
  expect(resolveImageSize("auto@4K",{width:8000,height:100})).toBe("8192x1024");
  const content={schemaVersion:1,layers:[],messages:[],jobs:[],composer:{size:"21:9@4K"}};
  expect(contentSchema.parse(content).composer.size).toBe("21:9@4K");
  // Existing commerce defaults remain valid; both collection and scene may override them.
  const commerce=commerceSchema.parse({version:1,brief:{product:"Chair"},sections:[],size:"9:16@2K"});
  expect(commerce.size).toBe("9:16@2K");
});
it("rejects known unsupported sizes without silently downgrading explicit resolution",()=>{
  expect(imageSizeError({imageKind:"volcengine"},"16:9@1K")).toBe("IMAGE_RESOLUTION_UNSUPPORTED");
  expect(imageSizeError({imageKind:"volcengine"},"16:9@2K")).toBeNull();
  expect(imageSizeError({imageKind:"dashscope",imageModel:"qwen-image-edit"},"1:4@2K")).toBe("IMAGE_SIZE_UNSUPPORTED");
  expect(imageSizeError({imageModel:"gpt-image-1"},"1:1@4K")).toBe("IMAGE_SIZE_UNSUPPORTED");
  expect(imageSizeError({imageModel:"gpt-image-1"},"2:3@1K")).toBeNull();
  expect(imageSizeError({imageModel:"custom",baseURL:"https://gateway.example/v1"},"1:8@4K")).toBeNull();
});
