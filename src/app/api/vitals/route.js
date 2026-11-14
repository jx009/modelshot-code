import { z } from "zod";

// 浏览器性能指标的轻量接收端：只校验并写一行结构化日志，供运维按页面汇总。
// 不落库、不关联用户；路径只保留已知前缀之后的段数，避免把项目 ID 等写入日志。
const metricSchema = z.object({
  name: z.enum(["TTFB", "FCP", "LCP", "INP", "CLS"]),
  value: z.number().int().min(0).max(600_000),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  path: z.string().max(200),
  nav: z.string().max(40).optional(),
}).strict();

const route = path => path.split("?")[0].split("/").slice(0, 2).join("/") || "/";

export async function POST(request) {
  try {
    const text = await request.text();
    if (text.length > 1024) return new Response(null, { status: 413 });
    const metric = metricSchema.parse(JSON.parse(text));
    console.info(JSON.stringify({ code: "WEB_VITAL", ...metric, path: route(metric.path) }));
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
