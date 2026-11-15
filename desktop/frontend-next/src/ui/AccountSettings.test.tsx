// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import "./testkit";
import { MockPort } from "../port/mock";
import type { AgentPort } from "../port/port";
import { AccountSettings } from "./AccountSettings";

afterEach(cleanup);

// No state is drawn in any more: with the cloud surfaces gone, this page is
// what its name still promises — the version and the diagnostics.
function draw() {
  const port = new MockPort() as unknown as AgentPort;
  render(
    <>
      <AccountSettings port={port} homePort={port} />
    </>,
  );
}

it("is version and diagnostics: one row per setting", () => {
  draw();
  // The about card is gone: a sponsorship block and an author line outlived the
  // features they belonged to, and a page named for settings had neither.
  expect([...document.querySelectorAll(".prefs-card > header h3")].map((h) => h.textContent)).toEqual(["版本与诊断"]);
  for (const id of ["versions", "logs"]) expect(document.querySelector(`[data-setting="${id}"]`), id).toBeTruthy();
});

it("shows versions and diagnostics inline", async () => {
  draw();
  await waitFor(() => expect(document.querySelector("#set-versions .vnow")).toBeTruthy());
  expect(document.querySelector('#set-logs .grp-items')).toBeTruthy();
});
