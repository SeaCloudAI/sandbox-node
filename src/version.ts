import packageJson from "../package.json" with { type: "json" };

export const SDK_VERSION = packageJson.version?.trim() || "dev";
