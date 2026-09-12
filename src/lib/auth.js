import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";
import { getSiteConfigs } from "./site-config";
import { rateLimit } from "./domain/identity/rate-limit.js";

/**
 * 动态构建 authOptions（每次请求重建，Google 凭据 DB > env）
 * 原因：NextAuth providers 在模块加载时固化；要支持管理端在线改 OAuth 凭据，
 * 必须改为工厂函数。调用方：`getServerSession(await buildAuthOptions())`
 */
export async function buildAuthOptions() {
  const cfg = await getSiteConfigs(["google_client_id", "google_client_secret"]);
  const googleClientId = cfg.google_client_id;
  const googleClientSecret = cfg.google_client_secret;
  return {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  providers: [
    ...(googleClientId && googleClientSecret ? [GoogleProvider({
      clientId: googleClientId || process.env.GOOGLE_CLIENT_ID,
      clientSecret: googleClientSecret || process.env.GOOGLE_CLIENT_SECRET,
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
          const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true, status: true, role: true, sessionVersion: true }
          });
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
        return { ...session, user: null };
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
