import { getSiteConfig } from "../../site-config.js";
import { allocateInviteCode } from "./invite-codes.js";

export async function registrationCredits(db) {
  const value = Number(await getSiteConfig("registration_credits", db) ?? 0);
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : 0;
}

export async function createRegisteredUser(tx, data, credits) {
  const user = await tx.user.create({ data: { ...data, credits, inviteCode: await allocateInviteCode(tx) } });
  if (credits > 0) await tx.creditTransaction.create({ data: {
    userId: user.id, type: "registration_bonus", channel: "credits", amount: credits,
    businessKey: `registration:${user.id}`, reason: "registration_bonus",
  } });
  return user;
}
