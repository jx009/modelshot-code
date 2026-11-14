// 分镜成片场景卡：只改变规划提示词的补充说明与默认参数，不引入新的流程。
export const MOTION_SCENARIO_PRESETS = {
  product: {
    zh: "产品种草", en: "Product ad", ratio: "9:16", seconds: 20,
    hint: ["展示一款产品的卖点", "Show what makes a product great"],
    brief: "Scenario: product promotion for social feeds. Open with a 2-second hook, show the product clearly in every AI shot (same product look across shots), cover 2-3 concrete selling points, end with the product name and a short call to action. Upbeat pacing, mostly 4-6 second shots.",
  },
  story: {
    zh: "故事短片", en: "Short story", ratio: "16:9", seconds: 30,
    hint: ["讲一个有起承转合的小故事", "Tell a short story with a clear arc"],
    brief: "Scenario: cinematic short story. Keep one consistent protagonist and setting described identically in every visual. Structure setup, turn and resolution. Prefer fade transitions between time or place changes, sparse on-screen text, narration optional.",
  },
  explainer: {
    zh: "图文解说", en: "Explainer", ratio: "16:9", seconds: 45,
    hint: ["把一个知识点讲清楚", "Explain one idea clearly"],
    brief: "Scenario: illustrated explainer. Every shot has a clear narration line; prefer ai-image shots with calm camera moves for diagrams and scenes, use short on-screen key phrases. Logical order: question, explanation in steps, summary.",
  },
};
export const MOTION_SCENARIO_IDS = Object.keys(MOTION_SCENARIO_PRESETS);
