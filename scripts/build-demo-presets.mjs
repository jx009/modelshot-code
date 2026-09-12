import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const modelDir = path.join(root, "public", "presets", "models");
const sceneDir = path.join(root, "public", "presets", "scenes");

const models = [
  { file: "model-01.png", skin: "#e2b394", hair: "#181412", suit: "#eee9e2", accent: "#315c58", build: 1, gender: "female", hairStyle: "bob" },
  { file: "model-02.png", skin: "#efc3a3", hair: "#28201d", suit: "#f2ece6", accent: "#9e493e", build: 0.88, gender: "female", hairStyle: "long" },
  { file: "model-03.png", skin: "#d7a17d", hair: "#171514", suit: "#e8ecec", accent: "#375a74", build: 1.08, gender: "male", hairStyle: "short" },
  { file: "model-04.png", skin: "#f0c7aa", hair: "#8a5d35", suit: "#eeeae7", accent: "#47634b", build: 1, gender: "female", hairStyle: "wave" },
  { file: "model-05.png", skin: "#d9ad8d", hair: "#6f4a2e", suit: "#e7e9e8", accent: "#434c62", build: 1.12, gender: "male", hairStyle: "short" },
  { file: "model-06.png", skin: "#70462f", hair: "#17110e", suit: "#eee9e1", accent: "#bc6d3f", build: 1, gender: "female", hairStyle: "natural" },
  { file: "model-07.png", skin: "#bd7954", hair: "#271813", suit: "#ede9e5", accent: "#8c4053", build: 1.02, gender: "female", hairStyle: "long" },
  { file: "model-08.png", skin: "#e0ad8d", hair: "#211815", suit: "#eeeae5", accent: "#3f6762", build: 1.22, gender: "female", hairStyle: "wave" },
];

function modelSvg(model, index) {
  const cx = 450;
  const shoulder = model.gender === "male" ? 210 * model.build : 174 * model.build;
  const hip = (model.gender === "male" ? 138 : 170) * model.build;
  const waist = (model.gender === "male" ? 142 : 125) * model.build;
  const hair = {
    bob: `<path d="M350 262c0-116 44-177 100-177s100 61 100 177v62h-200z" fill="${model.hair}"/>`,
    long: `<path d="M343 252c0-110 45-168 107-168s107 58 107 168v180H343z" fill="${model.hair}"/>`,
    wave: `<path d="M338 250c8-111 47-166 112-166s104 55 112 166l-18 194-54-46-40 39-43-39-52 46z" fill="${model.hair}"/>`,
    natural: `<ellipse cx="450" cy="185" rx="126" ry="118" fill="${model.hair}"/>`,
    short: `<path d="M359 213c8-89 42-130 91-130 55 0 88 41 94 130-51-29-117-31-185 0z" fill="${model.hair}"/>`,
  }[model.hairStyle];
  const torso = `M${cx - shoulder} 474 Q${cx - waist} 421 ${cx - 91} 407 L${cx + 91} 407 Q${cx + waist} 421 ${cx + shoulder} 474 L${cx + hip} 867 Q450 904 ${cx - hip} 867z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f5f2ec"/><stop offset="1" stop-color="#d9ddd9"/></linearGradient>
      <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${model.skin}"/><stop offset="1" stop-color="${model.skin}" stop-opacity=".72"/></linearGradient>
      <linearGradient id="cloth" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${model.suit}"/><stop offset="1" stop-color="#c9cccb"/></linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-opacity=".2"/></filter>
    </defs>
    <rect width="900" height="1200" fill="url(#bg)"/>
    <path d="M0 945 Q450 850 900 945V1200H0z" fill="#c9ceca"/>
    <ellipse cx="450" cy="1080" rx="236" ry="38" fill="#27302b" opacity=".16"/>
    <g filter="url(#shadow)">
      ${hair}
      <ellipse cx="450" cy="236" rx="82" ry="111" fill="url(#skin)"/>
      <path d="M425 335h50l14 90h-78z" fill="${model.skin}"/>
      <path d="${torso}" fill="url(#cloth)"/>
      <path d="M${cx - shoulder + 5} 480Q${cx - shoulder - 58} 645 ${cx - shoulder - 23} 826" fill="none" stroke="url(#skin)" stroke-width="58" stroke-linecap="round"/>
      <path d="M${cx + shoulder - 5} 480Q${cx + shoulder + 58} 645 ${cx + shoulder + 23} 826" fill="none" stroke="url(#skin)" stroke-width="58" stroke-linecap="round"/>
      <path d="M${cx - 82 * model.build} 844L${cx - 103 * model.build} 1065" stroke="#363a3a" stroke-width="91" stroke-linecap="round"/>
      <path d="M${cx + 82 * model.build} 844L${cx + 103 * model.build} 1065" stroke="#363a3a" stroke-width="91" stroke-linecap="round"/>
      <path d="M${cx - 158 * model.build} 523Q450 565 ${cx + 158 * model.build} 523" fill="none" stroke="${model.accent}" stroke-width="16" opacity=".9"/>
      <ellipse cx="422" cy="232" rx="7" ry="5" fill="#30251f"/><ellipse cx="478" cy="232" rx="7" ry="5" fill="#30251f"/>
      <path d="M425 283Q450 298 475 283" fill="none" stroke="#8f554c" stroke-width="5" stroke-linecap="round"/>
    </g>
    <text x="54" y="1116" font-family="Arial,sans-serif" font-size="22" fill="#4e5652">DIGITAL MODEL ${String(index + 1).padStart(2, "0")} · SYNTHETIC TEST FIXTURE</text>
  </svg>`;
}

function studioSvg(gray = false) {
  const wall = gray ? "#a8abaa" : "#f7f7f4";
  const floor = gray ? "#797e7c" : "#dddeda";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960"><defs><radialGradient id="light"><stop stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="${wall}" stop-opacity="0"/></radialGradient></defs><rect width="1280" height="690" fill="${wall}"/><rect y="690" width="1280" height="270" fill="${floor}"/><ellipse cx="640" cy="510" rx="520" ry="500" fill="url(#light)"/><path d="M0 690Q640 635 1280 690" fill="none" stroke="#777" stroke-opacity=".18" stroke-width="4"/><ellipse cx="640" cy="830" rx="245" ry="42" fill="#111" opacity=".08"/></svg>`;
}

const remoteScenes = [
  ["scene-03.jpg", "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c4/2013.04_-_%27View_in_rainy_Spring%27%2C_with_still_empty_trees_in_Amsterdam_West%2C_urban_photo_in_Amsterdam%2C_The_Netherlands_by_Fons_Heijnsbroek_%2812084191045%29.jpg/1280px-2013.04_-_%27View_in_rainy_Spring%27%2C_with_still_empty_trees_in_Amsterdam_West%2C_urban_photo_in_Amsterdam%2C_The_Netherlands_by_Fons_Heijnsbroek_%2812084191045%29.jpg"],
  ["scene-04.jpg", "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9f/Minimal_creative_interior_%28Unsplash%29.jpg/1280px-Minimal_creative_interior_%28Unsplash%29.jpg"],
  ["scene-05.jpg", "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/06/Autumn_park_path_%28Unsplash%29.jpg/1280px-Autumn_park_path_%28Unsplash%29.jpg"],
  ["scene-06.jpg", "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/17/Beach_by_the_pier_%28Unsplash%29.jpg/1280px-Beach_by_the_pier_%28Unsplash%29.jpg"],
];

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "ModelShot demo preset builder/1.0" } });
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.length || data.length > 10 * 1024 * 1024) throw new Error(`Invalid download size: ${url}`);
      return data;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

await mkdir(modelDir, { recursive: true });
await mkdir(sceneDir, { recursive: true });
for (const [index, model] of models.entries()) {
  await sharp(Buffer.from(modelSvg(model, index))).png({ compressionLevel: 9 }).toFile(path.join(modelDir, model.file));
}
await sharp(Buffer.from(studioSvg(false))).png({ compressionLevel: 9 }).toFile(path.join(sceneDir, "scene-01.png"));
await sharp(Buffer.from(studioSvg(true))).png({ compressionLevel: 9 }).toFile(path.join(sceneDir, "scene-02.png"));
for (const [file, url] of remoteScenes) {
  const cachedSource = path.join(sceneDir, file.replace(/\.jpg$/, ".source.jpg"));
  const bytes = await readFile(cachedSource).catch(() => download(url));
  await sharp(bytes).rotate().resize(1280, 960, { fit: "cover" }).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(sceneDir, file));
}

for (const file of [...models.map(model => path.join(modelDir, model.file)), ...["scene-01.png", "scene-02.png", ...remoteScenes.map(([file]) => file)].map(file => path.join(sceneDir, file))]) {
  const bytes = await readFile(file);
  console.log(`${path.relative(root, file)}  ${createHash("sha256").update(bytes).digest("hex")}`);
}
