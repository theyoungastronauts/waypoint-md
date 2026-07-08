import {
  isConfigKey,
  loadGlobalConfig,
  resolveConfig,
  saveGlobalConfig,
  type ConfigKey,
  CONFIG_KEYS,
} from "../config";
import { globalConfigPath } from "../paths";
import { CliError, type IO } from "../io";

/**
 * `waypoint config get [key]` (§12): print resolved server settings. Writes go
 * to the global file, so `get` reads from the full resolution chain to show what
 * would actually be used. The token is never printed in the clear — only whether
 * one is set.
 */
export function runConfigGet(key: string | undefined, io: IO): void {
  const config = resolveConfig();
  const view: Record<ConfigKey, string> = {
    url: config.url,
    token: config.token ? "(set)" : "(unset)",
    project: config.project ?? "(unset)",
    publicUrl: config.publicUrl,
  };

  if (key) {
    if (!isConfigKey(key)) {
      throw new CliError(`Unknown config key "${key}". Known keys: ${CONFIG_KEYS.join(", ")}.`);
    }
    io.log(view[key]);
    return;
  }
  for (const k of CONFIG_KEYS) {
    io.log(`${k} = ${view[k]}`);
  }
}

/**
 * `waypoint config set <key> <value>` (§12): persist to the global config file
 * (`~/.waypoint/config.json`). Even `url`/`project` go there — the token must
 * never touch the project-local `.waypoint.json`, and keeping all `config set`
 * writes in one place makes that rule simple to reason about.
 */
export function runConfigSet(key: string, value: string, io: IO): void {
  if (!isConfigKey(key)) {
    throw new CliError(`Unknown config key "${key}". Known keys: ${CONFIG_KEYS.join(", ")}.`);
  }
  saveGlobalConfig({ [key]: value });
  const shown = key === "token" ? "(hidden)" : value;
  io.log(`Set ${key} = ${shown} in ${globalConfigPath()}`);
}

/** Read the raw global config (used by tests / diagnostics). */
export function currentGlobalConfig() {
  return loadGlobalConfig();
}
