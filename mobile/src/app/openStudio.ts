/**
 * Open the paired computer's own Studio page.
 *
 * One implementation for every entry: the chat header and the settings rows
 * must agree on which URL the native WebView loads and when it goes through
 * the loopback proxy. A call reads the proxy config fresh; the answer is a
 * result rather than a throw, because "no address" and "both doors failed"
 * need different words on screen.
 */

import { Browser } from "@capacitor/browser";
import { WebMode } from "../native/webmode";
import { readProxyConfig, studioAppUrl, studioWebUrl } from "../net/server";

export type StudioOpenResult =
  | { kind: "native" }
  | { kind: "browser" }
  | { kind: "none" }
  | { kind: "failed"; error: unknown };

let opening: Promise<StudioOpenResult> | null = null;

/** Single-flight: a second tap joins the first instead of opening twice. */
export function openStudio(): Promise<StudioOpenResult> {
  opening ??= run().finally(() => {
    opening = null;
  });
  return opening;
}

async function run(): Promise<StudioOpenResult> {
  const config = await readProxyConfig();
  if (config === null) return { kind: "none" };

  const url = studioAppUrl(config);
  if (!url) return { kind: "none" };

  // The page must load through the loopback proxy: it carries the pairing
  // cookie, the CSRF Origin and the VPN detour.
  const viaProxy = Boolean(config.studioUrl?.trim());
  try {
    await WebMode.open({ url, viaProxy, origin: config.origin ?? "" });
    return { kind: "native" };
  } catch {
    try {
      // The browser cannot reach the loopback address, so it gets the real one.
      await Browser.open({ url: studioWebUrl(config) || url });
      return { kind: "browser" };
    } catch (error) {
      return { kind: "failed", error };
    }
  }
}
