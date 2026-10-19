from pathlib import Path
root = Path(__file__).resolve().parents[2]
def edit(name, fn):
    p=root/name
    p.write_text(fn(p.read_text(encoding='utf-8')),encoding='utf-8')
edit('src/lib/inspiration/defaults.js',lambda s:s.replace('mode: "mosaic"','mode: "masonry"'))
edit('src/lib/inspiration/gallery.js',lambda s:s.replace('z.enum(["mosaic", "masonry", "grid"])','z.enum(["masonry", "grid"])').replace('return ({ square: "1 / 1", portrait: "3 / 4", landscape: "4 / 3" })[item.aspect] || item.size.replace("x", " / ");','return item.size.replace("x", " / ");'))
def gallery(s):
    s=s.replace('import Image from "next/image";\n','').replace(', coverAspect','').replace('import InspirationMosaic from "./InspirationMosaic";','import InspirationCover from "./InspirationCover";')
    a=s.index('    <div className="ig-cover"')
    b=s.index('\n    <div className="ig-caption"',a)
    s=s[:a]+'''    <InspirationCover item={item} src={inspirationImage(item)} mode={layout.mode} className="ig-cover" unoptimized={item.cover.type === "asset"} alt={zh ? item.title : item.titleEn || item.title}><span className="ig-use">{zh ? "以此创作" : "Create with this"}<ArrowUpRight size={14} /></span></InspirationCover>'''+s[b:]
    a=s.index('    {layout.mode === "mosaic"')
    b=s.index('\n    {!visible.length',a)
    s=s[:a]+'''    <div className={`ig-gallery ig-${layout.mode} ig-columns-${layout.columns}`} style={{ "--ig-columns": layout.columns, "--ig-gap": `${layout.gap}px` }}>{visible.map(renderCard)}</div>'''+s[b:]
    return s
edit('src/components/discover/InspirationGallery.jsx',gallery)
edit('src/components/discover/InspirationDetail.jsx',lambda s:s.replace('width={1024} height={1024}', 'width={Number(item.size.split("x")[0])} height={Number(item.size.split("x")[1])}'))
edit('src/components/discover/inspiration.css',lambda s:s.replace('.ig-cover img{transition:transform .45s ease}.ig-card:hover .ig-cover img{transform:scale(1.035)}',''))
def admin(s):
    s=s.replace(', coverAspect','').replace('import InspirationMosaic from "@/components/discover/InspirationMosaic";','import InspirationCover from "@/components/discover/InspirationCover";')
    s=s.replace('<option value="mosaic">艺术拼排 · 底边对齐</option><option value="masonry">瀑布流</option><option value="grid">整齐网格</option>', '<option value="masonry">自然瀑布流 · 原图比例</option><option value="grid">等高网格 · 完整展示</option>')
    a=s.index('<div className="ig-admin-cover"')
    b=s.index('<button type="button" className="button compact ig-admin-replace"',a)
    s=s[:a]+'<InspirationCover item={current} src={previewImage(current)} className="ig-admin-cover" unoptimized />'+s[b:]
    a=s.index('<Field label="封面比例">')
    b=s.index('</div>\n      <div className="ig-admin-fields">',a)
    s=s[:a]+'<p className="ig-admin-note">按图片真实比例完整展示。生成尺寸仅用于创作配方，不会改变封面构图。</p>'+s[b:]
    a=s.index('    <section className="ig-admin-preview">')
    b=s.index('\n    <p className="ig-admin-note">新案例',a)
    s=s[:a]+'''    <section className="ig-admin-preview"><div><h2>画廊预览</h2><p>只展示已启用的作品。瀑布流保留原图比例，自然错落，不裁图、不强制底边对齐。</p></div><div className={`ig-admin-preview-grid ${gallery.layout.mode}`} style={{"--preview-columns":gallery.layout.columns,"--preview-gap":`${gallery.layout.gap}px`}}>{gallery.items.filter(i => i.enabled).map(i => <button type="button" key={i.id} onClick={() => setSelected(i.id)}><InspirationCover item={i} src={previewImage(i)} mode={gallery.layout.mode} unoptimized /><span>{i.title}</span></button>)}</div></section>'''+s[b:]
    return s
edit('src/app/[locale]/admin/inspiration/page.js',admin)
def e2e(s):
    s=s.replace('await expect(page.locator(".ig-mosaic-cell")).toHaveCount(20);\n    await assertMosaic(page);','await expect(page.locator(".ig-masonry")).toBeVisible();')
    s=s.replace('inspiration-default-mosaic.png','inspiration-default-native.png').replace('selectOption("mosaic")','selectOption("masonry")').replace('mode: "mosaic"','mode: "masonry"').replace('await assertMosaic(page);','await assertNativeImages(page);')
    s=s.replace('await loadGalleryImages(page);\n    await page.screenshot', 'await loadGalleryImages(page);\n    await assertNativeImages(page);\n    await page.screenshot')
    a=s.index('async function assertMosaic(page) {')
    b=s.index('async function loadGalleryImages(page)',a)
    s=s[:a]+'''async function assertNativeImages(page) {
  const images = await page.locator(".ig-card img").evaluateAll(images => images.map(image => {
    const box = image.getBoundingClientRect(), cover = image.parentElement.getBoundingClientRect();
    return { ratio: image.naturalWidth / image.naturalHeight, rendered: box.width / box.height, full: Math.abs(box.height - cover.height) < 1 };
  }));
  for (const image of images) {
    expect(image.rendered).toBeCloseTo(image.ratio, 2);
    expect(image.full).toBe(true);
  }
  expect(images.some(i => i.ratio < .8)).toBe(true);
  expect(images.some(i => i.ratio > 1.2)).toBe(true);
  expect(images.some(i => Math.abs(i.ratio - 1) < .01)).toBe(true);
}

'''+s[b:]
    return s
edit('tests/e2e/inspiration.spec.mjs',e2e)
print('Updated natural sizing, removed mosaic and crop controls; browser tests verify actual bitmap ratios.')
