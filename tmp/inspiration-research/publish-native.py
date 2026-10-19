import json, hashlib
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[2]
items=json.loads((root/'tmp/imagegen/native-items.json').read_text(encoding='utf-8'))
manifest=json.loads((root/'docs/inspiration/generation-manifest.json').read_text(encoding='utf-8'))
previous={i['id']:i for i in manifest['images']}
entries=[]
for i in items:
    raw=root/'output/imagegen/inspiration-native'/f"{i['id']}.png"
    published=root/'public/inspiration/generated'/f"{i['id']}.webp"
    if raw.exists():
        image=Image.open(raw).convert('RGB')
        expected=tuple(map(int,i['size'].split('x')))
        assert image.size==expected, (i['id'],image.size,expected)
        image.save(published,format='WEBP',quality=90,method=6)
        entry=dict(previous[i['id']],originalSize=i['size'])
    else:
        entry=previous[i['id']]
    with Image.open(published) as image:
        size='x'.join(map(str,image.size))
    entry.update(title=i['title'],requestedSize=i['size'],publishedSize=size,publishedBytes=published.stat().st_size,sha256=hashlib.sha256(published.read_bytes()).hexdigest(),sourceUrl=i['sourceUrl'],sourceAuthor=i['sourceAuthor'],sourceLicense=i['sourceLicense'])
    i['imageVersion']=entry['sha256'][:12]
    entries.append(entry)
(root/'src/lib/inspiration/defaults.js').write_text('// Generated artwork and adapted open-source prompts. See docs/inspiration/README.md for provenance.\nexport const DEFAULT_LAYOUT = { mode: "masonry", columns: 4, gap: 16 };\nexport const DEFAULT_ITEMS = '+json.dumps(items,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
manifest['images']=entries
manifest['note']='Final selection: 8 original square works, 8 newly generated portrait works (1024x1536) and 4 newly generated landscape works (1536x1024). All 12 new outputs match requested dimensions. Preserved entire image; WebP quality 90, no cropping or stretching. Two new initial requests failed; comic succeeded on retry, travel poster succeeded after simplifying its prompt. See defaults.js for the exact successful prompts. CLI fallback used with the user-specified provider/model. Original PNG files remain local.'
(root/'docs/inspiration/generation-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=root/'docs/inspiration/README.md'
s=p.read_text(encoding='utf-8')
a=s.index('生成接口为用户指定的')
b=s.index('\n\n逐图生成参数',a)
total=sum(e['publishedBytes'] for e in entries)
s=s[:a]+f'生成接口为用户指定的 `https://api.callyouai.com/codex/images/generations`，模型 `gpt-image-2.5-flare`、质量 `medium`，通过 imagegen 技能的 CLI fallback 实际调用。最终精选 **8 张方图 + 8 张竖图 + 4 张横图**。方图保留原批次的优秀作品；另外 12 张针对竖版漫画、时尚封面、产品叙事、旅行海报及横向场景重新编写提示词并生成，实际返回尺寸全部为请求的 `1024x1536` / `1536x1024`。未将方图裁切、拉伸或加边冒充其他比例。新批次 2 张初次失败，漫画重试成功，旅行海报简化提示词后成功。\n\n发布文件转换为质量 90 的 WebP，保留完整构图，总计约 {total/1_000_000:.2f} MB。旧方图中部分供应商返回 `1254x1254`，此前等比缩为 `1024x1024`。原始 PNG 保留在本地 `output/imagegen/inspiration/` 和 `output/imagegen/inspiration-native/`，不进入 Git；部署图片位于 `public/inspiration/generated/`。'+s[b:]
a=s.index('3. 列表上/下移调整顺序。')
b=s.index('\n4. ',a)
s=s[:a]+'3. 列表上/下移调整顺序。默认采用自然瀑布流：所有图片按真实原图比例完整展示，列宽一致，底边自然错落，不强制对齐，也不让个别图片突然跨列放大。桌面支持 3/4/5 列，间距 8–40 px；手机 2 列。另提供完整展示图片的等高网格（contain，不裁切）。已移除强制拼排、封面比例与裁切焦点控件。后台选图及上传自动选择最接近原图方向的创作尺寸，修改配方尺寸不会改变封面。'+s[b:]
s=s.replace('17 个方向，重新设计主题、文案、构图及材质描述','18 个方向，重新设计主题、文案、构图及材质描述').replace('爆炸食材构图、分镜叙事，署名 @icreatelife、@GeminiApp','分镜叙事，署名 @GeminiApp')
a=s.index('| 作品 | 方向 | 来源案例 / 原作者 |')
s=s[:a]+'| 作品 | 方向 / 原生尺寸 | 来源案例 / 原作者 |\n| --- | --- | --- |\n'+'\n'.join(f"| {i['title']} | {i['category']} · {i['size']} | [{i['sourceName']}]({i['sourceUrl']}) · {i['sourceAuthor']} |" for i in items)+'\n\n`soft-sound` 的源仓库案例标题与图片署名存在不一致，保留两者并注明位置，没有将其推断为同一作者。\n'
p.write_text(s,encoding='utf-8')
print(f'Published 20 works: {total:,} bytes. Native portrait/landscape sources verified.')
