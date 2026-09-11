function unavailable() {
  throw new Error("Signing is not included in this build. Install C2PA, configure credentials, and rebuild with C2PA_ENABLED=1.");
}

export const createC2pa = unavailable;
export class ManifestBuilder {
  constructor() { unavailable(); }
}
