/**
 * The person asked to stay offline, and it should survive a restart.
 *
 * The boot path reads this and leaves the phone offline instead of quietly
 * re-establishing the last connection; only a person's own connect clears it.
 * It is a mark about intent, not about any one route, which is why it outlives
 * every connection kind the app has ever had.
 */

const KEY = "reasonix.link.stand-down";

export function loadStandDown(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveStandDown(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // A lost mark costs one automatic reconnect, not a broken promise.
  }
}

export function clearStandDown(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
