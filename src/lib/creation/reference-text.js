export function decodeReferenceText(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (!text.trim() || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) throw new Error("invalid");
    return text;
  } catch { throw new Error("CREATION_REFERENCE_INVALID"); }
}
