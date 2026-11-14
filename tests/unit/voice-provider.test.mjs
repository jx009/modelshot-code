import { expect, it, vi } from "vitest";
import { synthesizeSpeech, voiceBase } from "../../src/lib/domain/studio/voice.js";
import { validChannel, validVoiceOptions, voiceChannelReady, channelScope } from "../../src/lib/studio/model-channels.js";
import { resolveStudioConfig } from "../../src/lib/domain/studio/providers.js";
import { jobSchema } from "../../src/lib/studio/tools.js";
import { encryptSecret } from "../../src/lib/crypto.js";

const voices = [{ id: "alloy", label: "温和女声" }, { id: "echo", label: "沉稳男声" }];
const channel = { kind: "openai", apiKey: "private-key", model: "tts-1", baseURL: "https://voice.example/v1", voiceOptions: { voices } };
const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);
const ok = (bytes = mp3, headers = {}) => new Response(bytes, { status: 200, headers: { "Content-Type": "audio/mpeg", ...headers } });

it("calls the OpenAI-compatible speech endpoint with admin-configured model and an allowed voice", async () => {
  const fetcher = vi.fn().mockResolvedValue(ok());
  expect(await synthesizeSpeech(channel, { text: " 欢迎来到新品发布会 ", voice: "echo" }, { fetcher })).toEqual(mp3);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://voice.example/v1/audio/speech");
  expect(init.redirect).toBe("manual");
  expect(init.headers.Authorization).toBe("Bearer private-key");
  expect(JSON.parse(init.body)).toEqual({ model: "tts-1", input: "欢迎来到新品发布会", voice: "echo", response_format: "mp3" });
  expect(voiceBase("https://voice.example/v1/")).toBe("https://voice.example");
});

it("rejects unknown voices, empty or long text, redirects, oversize and non-MP3 results", async () => {
  const fetcher = vi.fn();
  await expect(synthesizeSpeech(channel, { text: "你好", voice: "nova" }, { fetcher })).rejects.toMatchObject({ code: "VOICE_UNSUPPORTED" });
  await expect(synthesizeSpeech(channel, { text: " ", voice: "alloy" }, { fetcher })).rejects.toMatchObject({ code: "VOICEOVER_TEXT_REQUIRED" });
  await expect(synthesizeSpeech(channel, { text: "长".repeat(401), voice: "alloy" }, { fetcher })).rejects.toMatchObject({ code: "VOICEOVER_TEXT_REQUIRED" });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(synthesizeSpeech(channel, { text: "你好", voice: "alloy" }, { fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://other.example" } })) })).rejects.toMatchObject({ code: "VOICE_PROVIDER_REJECTED" });
  await expect(synthesizeSpeech(channel, { text: "你好", voice: "alloy" }, { fetcher: vi.fn().mockResolvedValue(ok(mp3, { "Content-Length": String(9 * 1024 * 1024) })) })).rejects.toMatchObject({ code: "VOICE_RESULT_TOO_LARGE" });
  await expect(synthesizeSpeech(channel, { text: "你好", voice: "alloy" }, { fetcher: vi.fn().mockResolvedValue(ok(Buffer.from("<html>not audio</html>"))) })).rejects.toMatchObject({ code: "VOICE_RESULT_INVALID" });
  await expect(synthesizeSpeech({ ...channel, apiKey: "" }, { text: "你好", voice: "alloy" }, { fetcher })).rejects.toMatchObject({ code: "VOICE_NOT_CONFIGURED" });
});

it("validates voice channels and keeps them out of user-selectable model lists", () => {
  const config = { studioCapability: "voice", scope: "tool", model: "tts-1", voiceOptions: { voices } };
  expect(validChannel("openai", config)).toBe(true);
  expect(validChannel("gptbest", config)).toBe(true);
  expect(validChannel("dashscope", config)).toBe(false);
  expect(validChannel("openai", { ...config, scope: "public" })).toBe(false);
  expect(validChannel("openai", { ...config, voiceOptions: { voices: [] } })).toBe(false);
  expect(validVoiceOptions({ voices: [voices[0], voices[0]] })).toBe(false);
  expect(validVoiceOptions({ voices: [{ id: "bad id", label: "x" }] })).toBe(false);
  expect(channelScope({ kind: "openai" }, config)).toBe("tool");
  expect(voiceChannelReady(channel)).toBe(true);
  expect(voiceChannelReady({ ...channel, baseURL: "" })).toBe(false);
});

it("resolves the pinned voice channel with its voices and decrypted key", () => {
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  const rows = [{ name: "voice-a", kind: "gptbest", displayName: "标准旁白", creditCost: 3, config: JSON.stringify({ studioCapability: "voice", scope: "tool", model: "tts-1", baseURL: "https://voice.example/v1", apiKeyEnc: encryptSecret("secret-a"), voiceOptions: { voices } }) }];
  const config = resolveStudioConfig(rows, [], "voice-a", "voice", "tts", { pinned: true });
  expect(config.voiceChannel).toMatchObject({ name: "voice-a", kind: "gptbest", model: "tts-1", apiKey: "secret-a", creditCost: 3, voiceOptions: { voices } });
});

it("requires narration text and a voice only for the voiceover tool", () => {
  const base = { documentId: "doc", documentVersion: 1 };
  expect(jobSchema.safeParse({ ...base, tool: "tts", params: { prompt: "旁白", voice: "alloy" } }).success).toBe(true);
  expect(jobSchema.safeParse({ ...base, tool: "tts", params: { prompt: "旁白" } }).success).toBe(false);
  expect(jobSchema.safeParse({ ...base, tool: "generate", params: { prompt: "图", voice: "alloy" } }).success).toBe(false);
});
