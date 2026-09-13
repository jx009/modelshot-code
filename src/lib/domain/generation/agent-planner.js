import { getWorkflow, workflowNeedsModel, workflowOutputCount } from "./workflow-catalog.js";

const WORKFLOW_RULES = [
  ["reference-remix", /(?:参考|复刻|仿照|同款|reference|remix|recreate|match\s+(?:this|the)\s+(?:style|layout))/i],
  ["product-polish", /(?:精修|抠图|去背|白底|清理背景|retouch|polish|remove\s+(?:the\s+)?background)/i],
  ["detail-page", /(?:详情页|详情长图|详情屏|detail\s*page|product\s*detail)/i],
  ["campaign-pack", /(?:海报|营销|广告|投放|社媒|活动|campaign|poster|social|advert)/i],
  ["model-set", /(?:模特套图|多视角模特|同一模特|model\s*set|consistent\s*model)/i],
  ["single-shot", /(?:单张|试拍|测试一张|one\s+(?:image|shot)|single\s*(?:image|shot))/i],
  ["main-gallery", /(?:只要主图|主图套图|商品主图|商城主图|storefront|gallery)/i],
  ["sku-kit", /(?:sku|单品上新|上新套图|launch\s*kit)/i],
  ["commerce-suite", /(?:一整套|全套|上新视觉|主图.*详情|详情.*主图|commerce\s*suite|full\s+(?:launch|set))/i],
];

const CATEGORY_RULES = [
  ["fashion", /(?:服装|衣服|上衣|裙|裤|鞋|包|fashion|apparel|garment|dress|shirt|jacket|shoe|bag)/i],
  ["beauty", /(?:美妆|护肤|口红|香水|面霜|beauty|cosmetic|skincare|lipstick|perfume)/i],
  ["electronics", /(?:数码|耳机|手机|电脑|键盘|音箱|electronics|earbuds|phone|laptop|keyboard|speaker)/i],
  ["food", /(?:食品|饮料|咖啡|零食|酒|food|drink|coffee|snack|wine)/i],
  ["home", /(?:家居|家具|灯具|沙发|椅|桌|home|furniture|lamp|sofa|chair|desk)/i],
  ["jewelry", /(?:珠宝|首饰|项链|戒指|耳环|手表|jewelry|necklace|ring|earring|watch)/i],
  ["sports", /(?:运动|户外|健身|露营|sports|outdoor|fitness|camping)/i],
];

const PLATFORM_RULES = [
  ["taobao", /(?:淘宝|天猫|taobao|tmall)/i],
  ["amazon", /(?:亚马逊|amazon)/i],
  ["tiktok", /(?:抖音|tiktok)/i],
  ["shein", /(?:shein)/i],
];

function firstMatch(text, rules) {
  return rules.find(([, pattern]) => pattern.test(text))?.[0];
}

function confidenceFor({ workflowId, category, platform, text }) {
  let score = 0.45;
  if (workflowId) score += 0.2;
  if (category) score += 0.15;
  if (platform) score += 0.12;
  if (text.length > 24) score += 0.08;
  return Math.min(0.99, Number(score.toFixed(2)));
}

export function planAgentTurn(message, current = {}) {
  const text = String(message || "").trim();
  const matchedCategory = firstMatch(text, CATEGORY_RULES);
  const matchedPlatform = firstMatch(text, PLATFORM_RULES);
  const workflowId = firstMatch(text, WORKFLOW_RULES) || current.workflowId || "commerce-suite";
  const productCategory = matchedCategory || current.productCategory || "other";
  const platformSpec = matchedPlatform || current.platformSpec || "";
  const workflow = getWorkflow(workflowId);
  const needsModel = workflowNeedsModel(workflowId);
  const clarifications = [];
  if (!(current.images?.length > 0)) clarifications.push("productImage");
  if (productCategory === "other" && !matchedCategory) clarifications.push("productCategory");
  if (!platformSpec) clarifications.push("platform");
  if (needsModel && !current.modelPresetId && !current.personImage) clarifications.push("model");
  const estimatedOutputs = workflowOutputCount(workflowId, Math.max(current.images?.length || 1, 1), current.variants || 1);
  const previewWorkflow = estimatedOutputs > 4 ? (needsModel ? "single-shot" : "product-polish") : workflowId;
  return {
    workflowId,
    productCategory,
    platformSpec,
    needsModel,
    estimatedOutputs,
    previewWorkflow,
    clarifications,
    confidence: confidenceFor({ workflowId: firstMatch(text, WORKFLOW_RULES), category: matchedCategory, platform: matchedPlatform, text }),
    ready: clarifications.length === 0,
    workflowTitle: workflow.title,
  };
}

export function conversationPrompt(history = []) {
  const entries = history.map((turn, index) => `Brief ${index + 1}: ${turn.text.trim()}`).filter(Boolean);
  let prompt = entries.join("\n\n");
  if (prompt.length <= 4000) return prompt;
  return prompt.slice(-4000);
}
