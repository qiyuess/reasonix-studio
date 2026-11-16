// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { WorkbenchLauncher } from "./WorkbenchLauncher";

afterEach(cleanup);

const noop = () => {};

it("offers one explorer entry with the change count alongside the browser", async () => {
  const files = vi.fn();
  render(<WorkbenchLauncher changes={4} onFiles={files} onBrowser={noop} />);
  expect([...document.querySelectorAll(".workbench-launcher > button b")].map((b) => b.textContent)).toEqual(["资源管理器4", "浏览器"]);
  await userEvent.click(screen.getByRole("button", { name: "资源管理器" }));
  expect(files).toHaveBeenCalledOnce();
});

// The launcher is three ways in and nothing else: a list of files opened earlier
// was tried and taken out, so nothing here may bring it back by accident.
it("draws the ways in and no recently-opened list", () => {
  render(<WorkbenchLauncher changes={3} onFiles={noop} onBrowser={noop} />);
  expect(document.querySelector(".workbench-launcher-recent")).toBeNull();
  expect(document.querySelector('[data-action="workbench.launch-recent"]')).toBeNull();
  expect(screen.queryByText("最近打开")).toBeNull();
});
