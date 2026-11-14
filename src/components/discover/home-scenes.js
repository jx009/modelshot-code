import { Package, Megaphone, Cookie, Palette, UserRound, Shirt, Brush, Box, BookOpen, Building2, Clapperboard, Presentation } from "lucide-react";

// 存文件名，路径统一由 hero-wall.js 的 sceneImage 生成
const art = file => file;

// 首页“快速上手”场景：一张真实作品 + 一句可直接生成的提示词。
// kind 决定点击后切换到哪个创作入口；image 类会把 prompt 填入输入框。
export const HOME_SCENES = [
  { id: "product", kind: "image", Icon: Package, label: "电商主图", labelEn: "Product shots", image: art("sneaker-chrome.209c06fb2093"),
    prompt: "一双银色运动鞋悬浮在深色背景中，霓虹轮廓光，镜面倒影，商业产品摄影，超清细节" },
  { id: "poster", kind: "image", Icon: Megaphone, label: "产品海报", labelEn: "Ad posters", image: art("cocoa-splash.8fe5e3931d67"),
    prompt: "高端黑巧克力饮品广告海报，液体飞溅环绕瓶身，暖金色逆光，杂志级商业摄影" },
  { id: "food", kind: "image", Icon: Cookie, label: "食品广告", labelEn: "Food ads", image: art("citrus-burst.ac2987b684fe"),
    prompt: "柑橘气泡饮料在阳光下爆开，果肉与水珠飞溅，清爽夏日色调，广告大片" },
  { id: "brand", kind: "image", Icon: Palette, label: "品牌视觉", labelEn: "Brand visuals", image: art("neon-creator.28d6fc2c622c"),
    prompt: "潮流品牌活动主视觉，撞色波普风，大号中文标题“脑洞开大”，贴纸与手绘元素" },
  { id: "portrait", kind: "image", Icon: UserRound, label: "人像写真", labelEn: "Portraits", image: art("noir-portrait.e8e926ff7fe9"),
    prompt: "黑白电影感人像，窗边侧光，颗粒胶片质感，安静克制的情绪" },
  { id: "fashion", kind: "image", Icon: Shirt, label: "时尚大片", labelEn: "Fashion editorial", image: art("petal-editorial.17c20ad4930e"),
    prompt: "春季时装杂志大片，模特身穿花瓣质感连衣裙，柔和自然光，留白构图" },
  { id: "guochao", kind: "image", Icon: Brush, label: "国风插画", labelEn: "Ink painting", image: art("mist-river-scroll.2b68224dcd66"),
    prompt: "中国当代水墨画，巨龙从云海中盘旋升起，宣纸留白，一点朱砂红" },
  { id: "toy", kind: "image", Icon: Box, label: "3D 潮玩", labelEn: "3D toys", image: art("wool-friend.bc7c44f963ac"),
    prompt: "毛毡质感的可爱小怪兽潮玩，柔光棚拍，奶油色背景，3D 渲染" },
  { id: "comic", kind: "image", Icon: BookOpen, label: "漫画分镜", labelEn: "Comics", image: art("rainy-comic.646316969015"),
    prompt: "原创日式双格漫画，雨中京都花店门口，撑透明伞的少女，细腻线稿" },
  { id: "space", kind: "image", Icon: Building2, label: "空间概念", labelEn: "Spaces", image: art("cloud-cafe.d40868d92a64"),
    prompt: "漂浮在云端的玻璃咖啡馆，清晨柔光，建筑概念设计，电影感广角" },
  { id: "video", kind: "video", Icon: Clapperboard, label: "AI 视频", labelEn: "AI video", image: art("film-morning-market.4ce00a57e01e") },
  { id: "slides", kind: "slides", Icon: Presentation, label: "一键 PPT", labelEn: "Slides", image: art("architecture-blueprint.052952081a77") },
];

// 输入框下方的缩略图快捷入口，复用场景数据，避免两处维护
export const HOME_CHIPS = ["product", "poster", "guochao", "toy"].map(id => HOME_SCENES.find(scene => scene.id === id));
