import pkg from "../package.json";

/** The app version reported by GET /api/health (the CLI handshake target, §8). */
export const APP_VERSION: string = pkg.version;
