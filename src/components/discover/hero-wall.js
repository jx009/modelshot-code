// 首屏作品墙：本地内置作品（public/inspiration/generated），[文件名, 宽, 高]
export const HERO_WALL = [
  ["mist-river-scroll.2b68224dcd66", 1536, 1024],
  ["cocoa-splash.8fe5e3931d67", 1152, 2048],
  ["noir-portrait.e8e926ff7fe9", 1024, 1536],
  ["paper-coral-reef.3c23030138cd", 1024, 1536],
  ["sneaker-chrome.209c06fb2093", 1024, 1024],
  ["gouache-rooftop-cat.544821b98eff", 1536, 1024],
  ["petal-editorial.17c20ad4930e", 1024, 1536],
  ["glass-orbit.fcb7cbd2851f", 1024, 1024],
  ["neon-creator.28d6fc2c622c", 1086, 1448],
  ["cloud-cafe.d40868d92a64", 1536, 1024],
  ["linocut-whale.876908979ba9", 1024, 1536],
  ["citrus-burst.ac2987b684fe", 1024, 1024],
  ["kyoto-print.c1584ad11710", 1024, 1536],
  ["wool-friend.bc7c44f963ac", 1024, 1024],
  ["midnight-train.6fb4b8359f5b", 1536, 1024],
  ["botanical-lab-glass.935d9eb0af97", 1024, 1024],
  ["charcoal-dancer.fb29735bc5f5", 1024, 1536],
  ["tiny-night-market.c122555eb3d7", 1024, 1024],
  ["embroidered-orchard.a327be7670a6", 1024, 1024],
  ["sneaker-track.39584cf68bb1", 864, 1536],
  ["cyanotype-wildflowers.218dc7ce3582", 1024, 1536],
  ["clay-planet-garden.bc20fa88aa45", 1024, 1024],
  ["creator-pop.bc364dd5b4f0", 1536, 2048],
  ["architecture-night.a7aad7385356", 2048, 1152],
  ["forest-exposure.5aa114e1a529", 1024, 1536],
  ["silk-bloom.07d771788c2f", 1024, 1024],
  ["tea-ceremony.e2220360fc96", 1024, 1536],
  ["little-astronaut.9e7403880999", 1536, 1024],
  ["club-festival.c57045afc459", 864, 1536],
  ["brass-fish.8d18e64ac317", 1024, 1024],
  ["film-morning-market.4ce00a57e01e", 1536, 1024],
  ["paper-garden.9683dfcef2e1", 1024, 1024],
];

// 四列纵向滚动。用宽高比分配，让每列视觉高度接近，避免某列过长或过短。
export const WALL_COLUMNS = (() => {
  const columns = [[], [], [], []];
  const heights = [0, 0, 0, 0];
  for (const tile of HERO_WALL) {
    const target = heights.indexOf(Math.min(...heights));
    columns[target].push(tile);
    heights[target] += tile[1] / tile[2];
  }
  return columns;
})();

// 装饰位一律用预生成的 480px 缩略图（scripts/build-inspiration-thumbs.mjs）
export const sceneImage = file => `/inspiration/thumbs/${file}-480.webp`;
