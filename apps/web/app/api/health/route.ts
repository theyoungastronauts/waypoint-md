import { NextResponse } from "next/server";
import { SPEC_VERSION } from "@waypoint/spec";

import { aiEnabled } from "@/lib/ai/config";
import { publishEnabled } from "@/lib/publish/config";
import { APP_VERSION } from "@/lib/version";

// Always fresh — this is the CLI handshake target (§8), not a static asset.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    version: APP_VERSION,
    specVersion: SPEC_VERSION,
    // Server-driven capability flags (§14): whether AI / publish features are
    // available. Never the secrets themselves — just whether they are configured.
    aiEnabled: aiEnabled(),
    publishEnabled: publishEnabled(),
  });
}
