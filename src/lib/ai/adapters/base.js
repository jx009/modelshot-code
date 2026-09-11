export class BaseAdapter {
  constructor(name, config = {}) { this.name = name; this.config = config; }
  async generateTryOn() { throw new Error(`${this.name}: generation unavailable`); }
  async inpaint() { throw new Error(`${this.name}: inpainting unavailable`); }
  async healthCheck() { return { ok: false, provider: this.name, status: "unverified" }; }
}

// Domain services resolve and validate owned assets before invoking adapters.
export async function toFileObject(source, filename = "image.png") {
  if (!Buffer.isBuffer(source)) throw new Error("Adapter requires a validated image buffer");
  return new File([source], filename.endsWith(".png") ? filename : `${filename}.png`, { type: "image/png" });
}

export async function toInlineData(source) {
  if (!Buffer.isBuffer(source)) throw new Error("Adapter requires a validated image buffer");
  return { mimeType: "image/png", data: source.toString("base64") };
}

export function toDataUri(source) {
  if (!Buffer.isBuffer(source)) throw new Error("Adapter requires a validated image buffer");
  return `data:image/png;base64,${source.toString("base64")}`;
}
