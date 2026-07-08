import { NextResponse } from "next/server";
import { SPEC_VERSION } from "@waypoint/spec";

import { aiEnabled } from "@/lib/ai/config";
import { APP_VERSION } from "@/lib/version";

// Always fresh — this is the CLI handshake target (§8), not a static asset.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    version: APP_VERSION,
    specVersion: SPEC_VERSION,
    // Server-driven capability flag (§14): whether AI features are available.
    // Never the key itself — just whether one is configured.
    aiEnabled: aiEnabled(),
  });
}
