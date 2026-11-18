import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";
import { getSiteConfigs } from "./site-config";
import { rateLimit } from "./domain/identity/rate-limit.js";
import { createRegisteredUser, registrationCredits } from "./domain/identity/registration.js";

/**
 * 动态构建 authOptions（每次请求重建，Google 凭据 DB > env）
 * 原因：NextAuth providers 在模块加载时固化；要支持管理端在线改 OAuth 凭据，
 * 必须改为工厂函数。调用方：`getServerSession(await buildAuthOptions())`
 *
 * Google 凭据只在真正登录时读取：会话校验（会话 cookie、各接口的鉴权）不会用到
 * providers。默认不读，避免每个鉴权请求都多查一次数据库，也避免这次查询失败
 * 连累会话接口；登录入口需显式传 `{ providers: true }`。
 */
export async function buildAuthOptions({ providers = false } = {}) {
  const google = providers
    ? await getSiteConfigs(["google_client_id", "google_client_secret", "google_login_enabled"])
    : null;
  return {
  adapter: {
    ...PrismaAdapter(prisma),
    async createUser(data) {
      const credits = await registrationCredits();
      return prisma.$transaction(tx => createRegisteredUser(tx, data, credits));
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    ...(google && !["0", "false"].includes(google.google_login_enabled) && google.google_client_id && google.google_client_secret ? [GoogleProvider({
      clientId: google.google_client_id,
      clientSecret: google.google_client_secret,
    })] : []),
    CredentialsProvider({
      id: "email",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }
        if (typeof credentials.email !== "string" || typeof credentials.password !== "string" || credentials.email.length > 254 || Buffer.byteLength(credentials.password) > 72) throw new Error("Invalid email or password");
        const email = credentials.email.trim().toLowerCase();
        await rateLimit("login-email", email, 20, 600);
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) {
          throw new Error("Invalid email or password");
        }
        if (user.status === "banned") {
          throw new Error("This account has been banned");
        }
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          throw new Error("Invalid email or password");
        }
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image || null,
          credits: user.credits,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Discard obsolete claims from sessions issued before user-managed provider keys were removed.
      delete token.customApiKey;
      delete token.isApiKeyUser;
      if (user) {
        token.id = user.id;
      }
      token.invalid = true;
      const userId = token.id || token.sub;
      if (userId) {
        token.id = userId;
        try {
          const query = () => prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true, status: true, role: true, sessionVersion: true }
          });
          // Retry a dropped pool connection once, still failing closed on outage.
          const dbUser = await query().catch(() => query());
          if (dbUser) {
            if (user) token.sessionVersion = dbUser.sessionVersion;
            token.credits = dbUser.credits;
            token.role = dbUser.role;
            token.invalid = dbUser.status !== "active" || !Number.isInteger(token.sessionVersion) || token.sessionVersion !== dbUser.sessionVersion;
          }
        } catch {
          // Authentication fails closed while account state cannot be verified.
          token.invalid = true;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // 封禁用户：session 置空（前端视为未登录，立即失效）
      if (!token || token.invalid !== false) {
        return null;
      }
      if (session.user && token) {
        session.user.id = token.id || token.sub;
        session.user.credits = token.credits;
        delete session.user.customApiKey;
        delete session.user.isApiKeyUser;
        session.user.role = token.role || "user";
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  };
}
