import { getModel, REGISTRY_CONFIG, MODELS, isConfigured } from "./model-registry.js";
import { decryptSecret } from "../crypto.js";

// Adapter 懒加载表 — 动态 import() 的路径必须是静态字面量（Turbopack/webpack 要求），
// 所以每个 Adapter 在这里注册一个加载函数，调用时才真正 import（懒加载语义不变）。
// 新增模型：model-registry.js 加声明 + 这里加一行 loader + 写 Adapter 文件
const LOADERS = {
  openai: () => import("./adapters/openai.js"),
  gemini: () => import("./adapters/gemini.js"),
  fashn: () => import("./adapters/fashn.js"),
};

// Adapter 实例缓存（懒加载后缓存，不重复创建）
const adapterCache = new Map();

/**
 * 懒加载 Adapter（参考 OpenTryOn 的 import_path + class_name 模式）
 * 首次调用才 import，启动零开销
 */
async function loadAdapter(spec, adapterConfig) {
  const createAdapter = async () => {
    const loader = LOADERS[spec.id];
    if (!loader) throw new Error(`No loader registered for provider "${spec.id}"`);
    const mod = await loader();
    const AdapterClass = mod[spec.className];
    if (!AdapterClass) throw new Error(`Adapter for "${spec.id}" does not export ${spec.className}`);
    return new AdapterClass(adapterConfig || {});
  };

  // 自定义配置（如用户自带 key）不进缓存，每次新建实例
  if (adapterConfig) return createAdapter();

  if (adapterCache.has(spec.id)) return adapterCache.get(spec.id);

  const adapter = await createAdapter();
  adapterCache.set(spec.id, adapter);
  return adapter;
}

/**
 * DB 配置缓存 — Admin 在 ModelProvider 表改的 isActive/priority 实时影响调度
 * （修复：此前 Admin 停用通道不影响真实调度，是假开关）
 */
let dbConfigCache = null;
let dbConfigCacheAt = 0;
const DB_CONFIG_TTL_MS = 30_000;

async function getDbProviderConfig() {
  if (dbConfigCache && Date.now() - dbConfigCacheAt < DB_CONFIG_TTL_MS) {
    return dbConfigCache;
  }
  try {
    const { prisma } = await import("../prisma.js");
    const rows = await prisma.modelProvider.findMany({
      where: { isActive: true },
      orderBy: { priority: "asc" },
      select: { name: true, isDefault: true },
    });
    if (rows.length > 0) {
      const order = rows.map(r => r.name);
      dbConfigCache = {
        fallbackOrder: order,
        defaultProvider: rows.find(r => r.isDefault)?.name || order[0],
      };
    }
    dbConfigCacheAt = Date.now();
  } catch (err) {
    console.warn("[Runner] DB config lookup failed, using built-in registry:", err.message);
    dbConfigCacheAt = Date.now(); // 失败也记时间，避免每次打 DB
  }
  return dbConfigCache;
}

/** Admin 改配置后清缓存（立即生效） */
export function invalidateProviderConfig() {
  dbConfigCache = null;
  dbConfigCacheAt = 0;
  credentialsCache.clear();
}

/**
 * 按通道读 DB 凭据（ModelProvider.config：apiKeyEnc 加密 + baseURL + model）
 * 30s 缓存；解密失败（密钥轮换后旧密文）视为未配置，降级 env
 */
const credentialsCache = new Map(); // name -> { config, at }

export async function getProviderCredentials(name) {
  const cached = credentialsCache.get(name);
  if (cached && Date.now() - cached.at < 30_000) return cached.config;

  let config = null;
  try {
    const { prisma } = await import("../prisma.js");
    const row = await prisma.modelProvider.findUnique({
      where: { name },
      select: { config: true },
    });
    if (row?.config) {
      const parsed = JSON.parse(row.config);
      config = {
        apiKey: parsed.apiKeyEnc ? decryptSecret(parsed.apiKeyEnc) : null,
        baseURL: parsed.baseURL || null,
        model: parsed.model || null,
      };
      // 无 key 则整个置空（只有 baseURL 没有 key 没意义）
      if (!config.apiKey) config = { ...config, apiKey: null };
    }
  } catch (err) {
    console.warn(`[Runner] credentials lookup failed for ${name}:`, err.message);
  }
  credentialsCache.set(name, { config, at: Date.now() });
  return config;
}

/** 通道可用性：用户自带 key 或 DB 有 key 或 env 有 key 任一成立 */
async function isProviderUsable(name, adapterConfig) {
  if (adapterConfig?.apiKey) return true;
  const dbCred = await getProviderCredentials(name);
  if (dbCred?.apiKey) return true;
  return isConfigured(MODELS[name]);
}

/**
 * 统一调度入口 — 所有生图调用的唯一入口
 *
 * 参考 OpenTryOn runner.py 的 invoke_model()：
 * - 永远不抛异常（返回结构化 { success, error }）
 * - 支持 dry_run（预览调用但不真发）
 * - 支持 fallback（一个挂了自动切下一个）
 * - fallback 顺序优先读 DB（Admin 后台可调），DB 不可用回落代码内注册表
 *
 * @param {Object} opts
 * @param {string} opts.provider         - 指定模型（可选，默认用系统默认）
 * @param {Buffer|string} opts.garmentImage  - 服装平铺图（URL 或 base64）
 * @param {string} opts.modelRef         - 模特参考图（URL 或 base64）
 * @param {string} opts.sceneRef         - 场景参考图（可选）
 * @param {string} opts.prompt           - 组装好的 prompt
 * @param {string} opts.size             - 输出尺寸
 * @param {string} opts.quality          - 输出质量
 * @param {boolean} opts.dryRun          - 预览模式
 * @returns {Promise<{success: boolean, provider?: string, imageBase64?: string, imageUrl?: string, costUsd?: number, error?: string}>}
 */
export async function invokeModel(opts) {
  const { provider, dryRun = false, adapterConfig, ...params } = opts;

  // fallback 顺序：DB 配置优先（Admin 可调），回落代码内注册表
  const dbConfig = await getDbProviderConfig();
  const fallbackOrder = dbConfig?.fallbackOrder || REGISTRY_CONFIG.fallbackOrder;
  const defaultProvider = provider || dbConfig?.defaultProvider || REGISTRY_CONFIG.defaultProvider;

  // 确定调用顺序：指定的 provider 优先，然后按 fallback 顺序
  const order = defaultProvider
    ? [defaultProvider, ...fallbackOrder.filter(p => p !== defaultProvider)]
    : [...fallbackOrder];

  // 过滤掉未配置的 provider（可用性：用户自带 key > DB 配置 key > env key）
  const usableChecks = await Promise.all(order.map(p => MODELS[p] ? isProviderUsable(p, adapterConfig) : Promise.resolve(false)));
  const available = order.filter((_, i) => usableChecks[i]);

  if (available.length === 0) {
    return { success: false, error: "No model providers configured. Set at least one API key (OPENAI_API_KEY / GOOGLE_GEMINI_API_KEY / FASHN_API_KEY)." };
  }

  if (dryRun) {
    const spec = getModel(available[0]);
    return {
      success: true,
      dryRun: true,
      provider: available[0],
      call: `${spec.className}.${spec.method}(${JSON.stringify(params).slice(0, 200)}...)`,
    };
  }

  // 按顺序尝试，带 fallback（带自定义 key 时只在指定 provider 上重试，不 fallback 到系统 key）
  let lastError;
  for (const providerName of available) {
    try {
      const spec = getModel(providerName);
      // adapter 配置合并：用户自带 key（adapterConfig）优先，其次 DB 通道配置，最后 env（adapter 内部兜底）
      let effectiveConfig = adapterConfig;
      if (!adapterConfig) {
        const dbCred = await getProviderCredentials(spec.id);
        if (dbCred && (dbCred.apiKey || dbCred.baseURL)) {
          effectiveConfig = { apiKey: dbCred.apiKey || undefined, baseURL: dbCred.baseURL || undefined, model: dbCred.model || undefined };
          // 注意：effectiveConfig 有值会绕过 adapterCache（loadAdapter 语义），DB 配置变更 30s 内生效
        }
      }
      const adapter = await loadAdapter(spec, effectiveConfig);
      const result = await adapter[spec.method](params);

      return {
        success: true,
        provider: providerName,
        imageBase64: result.imageBase64 || null,
        imageUrl: result.imageUrl || null,
        costUsd: result.costUsd || 0,
        raw: result.raw,
      };
    } catch (err) {
      console.error(`[invokeModel] ${providerName} failed:`, err.message);
      lastError = err;
    }
  }

  return {
    success: false,
    error: `All providers failed. Last error: ${lastError?.message}`,
    triedProviders: available,
  };
}

/**
 * 所有已注册 provider 的健康检查
 */
export async function healthCheckAll() {
  const results = {};
  for (const [id, spec] of Object.entries(MODELS)) {
    if (!isConfigured(spec)) {
      results[id] = { ok: false, error: "not configured" };
      continue;
    }
    try {
      const adapter = await loadAdapter(spec);
      results[id] = adapter.healthCheck ? await adapter.healthCheck() : { ok: true };
    } catch (err) {
      results[id] = { ok: false, error: err.message };
    }
  }
  return results;
}
