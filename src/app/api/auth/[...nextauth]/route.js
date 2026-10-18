import NextAuth from "next-auth";
import { buildAuthOptions } from "@/lib/auth";

// 透传参数（App Router 签名为 (req, context)）；每次请求重建 options 以支持 DB 动态凭据
async function handler(...args) {
  const options = await buildAuthOptions();
  const response = await NextAuth(options)(...args);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export { handler as GET, handler as POST };
