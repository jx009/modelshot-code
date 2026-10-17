export async function chooseImageTool(page, name) {
  const group = {
    "AI 超清放大": "画质提升", "细节增强": "画质提升",
    "反推提示词": "反推提示词", "提取风格配方": "反推提示词",
    "局部修改": "局部修改", "焦点编辑": "局部修改", "多图融合": "局部修改",
    "无痕改字": "文字编辑", "图片翻译": "文字编辑", "文字识别": "文字编辑",
    "一键抠图": "抠图与图层", "图层拆分": "抠图与图层", "物体移动": "抠图与图层",
    "图片裁剪": "更多", "调色": "更多", "生成视频": "更多",
  }[name];
  if (group) {
    await page.locator(".ms-context-scroll").getByRole("button", { name: group, exact: true }).click();
    await page.getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
  } else await page.locator(".ms-context-scroll").getByRole("button", { name, exact: true }).click();
}
