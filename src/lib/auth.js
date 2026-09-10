import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";
import { getSiteConfigs } from "./site-config";

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
    GoogleProvider({
      clientId: googleClientId || process.env.GOOGLE_CLIENT_ID,
      clientSecret: googleClientSecret || process.env.GOOGLE_CLIENT_SECRET,
    }),
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
        const email = credentials.email.trim().toLowerCase();
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
          customApiKey: user.customApiKey || null,
          isApiKeyUser: false,
          role: user.role,
        };
      },
    }),
    CredentialsProvider({
      id: "credentials",
      name: "API Key",
      credentials: {
        apiKey: { label: "API Key", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.apiKey) {
          throw new Error("API Key is required");
        }
        const apiKey = credentials.apiKey.trim();
        if (apiKey.length < 5) {
          throw new Error("Invalid API key format");
        }

        const dummyEmail = `apikey_${apiKey.slice(-8)}@modelshot.local`;
        let dbUser = await prisma.user.findFirst({
          where: {
            OR: [
              { customApiKey: apiKey },
              { email: dummyEmail }
            ]
          }
        });

        if (!dbUser) {
          dbUser = await prisma.user.create({
            data: {
              name: "API Key User",
              email: dummyEmail,
              customApiKey: apiKey,
              credits: 0,
            }
          });
        } else if (!dbUser.customApiKey) {
          dbUser = await prisma.user.update({
            where: { id: dbUser.id },
            data: { customApiKey: apiKey }
          });
        }

        return {
          id: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          image: dbUser.image || null,
          credits: dbUser.credits,
          customApiKey: dbUser.customApiKey || apiKey,
          isApiKeyUser: true,
        };
      }
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.credits = user.credits;
        token.customApiKey = user.customApiKey;
        token.isApiKeyUser = user.isApiKeyUser || false;
      }
      if (trigger === "update" && session) {
        if (session.customApiKey !== undefined) token.customApiKey = session.customApiKey;
        if (session.credits !== undefined) token.credits = session.credits;
      }
      const userId = token.id || token.sub;
      if (userId) {
        token.id = userId;
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true, customApiKey: true, status: true, role: true }
          });
          if (dbUser) {
            token.credits = dbUser.credits;
            token.customApiKey = dbUser.customApiKey;
            token.role = dbUser.role;
            // 封禁用户：token 标记失效（session callback 里剔除 user，等于登出）
            if (dbUser.status === "banned") {
              token.banned = true;
            }
          }
        } catch (err) {}
      }
      return token;
    },
    async session({ session, token }) {
      // 封禁用户：session 置空（前端视为未登录，立即失效）
      if (token?.banned) {
        return { ...session, user: null };
      }
      if (session.user && token) {
        session.user.id = token.id || token.sub;
        session.user.credits = token.credits;
        session.user.customApiKey = token.customApiKey;
        session.user.isApiKeyUser = Boolean(token.customApiKey);
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
