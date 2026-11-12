// The boot screen is drawn by index.html's own styles: the wordmark is on the
// page before this bundle parses, and CSS fades it in. Nothing here animates
// it — no meteor, no shards, no flare. What the script owns is the two things
// that depend on facts: the step marks, which light as real startup steps land,
// and the hand-over, which waits for the app and then fades the screen away.

const LEAVE_MS = 240;
// A boot that settles in a blink would show the lockup and its steps for less
// time than it takes to read them, so the screen holds this long before it
// leaves — and no longer than the app makes it wait.
const MIN_MS = 900;

export interface Intro {
  /** Resolves once the wordmark stands whole. It is on screen from the first
   *  paint, so this settles at once. */
  held: Promise<void>;
  /** Lights the first `done` startup steps, each one a thing that has actually
   *  happened: the bundle ran, the kernel answered, the app settled. */
  progress(done: number): void;
  /** Settles the boot screen onto the app's page and resolves when it is gone. */
  leave(): Promise<void>;
}

export function play(boot: HTMLElement | null): Intro {
  if (!boot) return { held: Promise.resolve(), progress: () => {}, leave: () => Promise.resolve() };

  const born = performance.now();
  // The steps and the line arrive with the lockup, on the short delays their
  // own styles name — they mark progress, they are not an animation of their
  // own.
  boot.dataset.wait = "";

  return {
    held: Promise.resolve(),
    progress(done) {
      boot.dataset.step = String(done);
      boot.querySelectorAll(".bsteps i").forEach((mark, i) => {
        mark.toggleAttribute("data-lit", i < done);
        // The one still pending breathes, so the marks read as progress
        // rather than as three dots that happen to be there.
        mark.toggleAttribute("data-now", i === done);
      });
    },
    leave() {
      const left = Math.max(0, MIN_MS - (performance.now() - born));
      return new Promise((done) =>
        setTimeout(() => {
          boot.dataset.leave = "";
          setTimeout(done, LEAVE_MS);
        }, left),
      );
    },
  };
}
