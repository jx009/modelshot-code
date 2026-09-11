import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  // Provider-bound encrypted credentials replace this legacy endpoint in M1.
  return NextResponse.json({ code: "BYOK_UNAVAILABLE", error: "BYOK is temporarily unavailable." }, { status: 503 });
}

export async function DELETE(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { customApiKey: null }
    });

    return NextResponse.json({ success: true, customApiKey: null });
  } catch (error) {
    console.error("Error clearing custom API key:", error);
    return NextResponse.json({ error: error.message || "Failed to remove API key" }, { status: 500 });
  }
}
