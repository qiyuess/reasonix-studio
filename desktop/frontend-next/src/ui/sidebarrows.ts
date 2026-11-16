import { fireEvent, waitFor } from "@testing-library/react";

const control = () => document.querySelector<HTMLButtonElement>('[data-action="workspace.fold-all"]');
const folded = () => document.querySelectorAll('.wsrow[aria-expanded="false"]').length;

/**
 * Opens every project, so a guard can reach the session rows under it.
 *
 * The project list starts folded on a cold launch (`da805c2`), so a guard that
 * reaches for a session row has to open it first — the same press a person
 * makes, not a test-only back door. It finds the fold control by the action it
 * declares and each project by its own `aria-expanded`, never by the words
 * drawn on them: which sentence a control shows is the interface's business
 * (`src/wording.test.ts`).
 */
export async function expandProjects(): Promise<void> {
  // The control is drawn before the tree arrives, disabled for as long as
  // nothing is foldable. Pressing it then does nothing, and a count of zero
  // folded rows at that moment means "nothing drawn yet", not "all open" — so
  // wait for an enabled control beside at least one drawn project before
  // reading the count.
  await waitFor(() => {
    const button = control();
    if (!button || button.disabled) throw new Error("the fold control is not usable yet");
    if (!document.querySelector(".wsrow")) throw new Error("no project is drawn yet");
    return button;
  });
  // A half-open list needs two presses: the control offers only "all" or
  // "none", so a partly open list is closed by the first one.
  for (let press = 0; press < 3; press++) {
    if (folded() === 0) return;
    const button = control();
    if (!button) throw new Error("the fold control went away before the list opened");
    fireEvent.click(button);
  }
  // Still folded after every press it is allowed: say so here, rather than let
  // a later query time out with no hint about the cause.
  if (folded() > 0) throw new Error(`${folded()} projects are still folded after pressing expand`);
}
