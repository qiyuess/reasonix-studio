import { MockWorkspace } from "./mock_workspace";
import type { StudioLogs, VersionHub, VersionNotes } from "./port";

// The version panel and launch-health surface of the demo port. It is a base
// class only because the demo's version behaviour is independent of a session;
// MockPort supplies the rest of AgentPort.
export abstract class MockUpdates extends MockWorkspace {
  async versions(_refresh?: boolean): Promise<VersionHub> {
    return { current: "dev", pinned: "", stalePin: false, latest: "", newer: false, versions: [] };
  }

  private welcomed = true;
  async welcomeSeen(): Promise<boolean> { return this.welcomed; }
  async markWelcomed(): Promise<void> { this.welcomed = true; }

  async pinVersion(): Promise<void> {}
  async versionNotes(version: string): Promise<VersionNotes> {
    return { version, markdown: "", cached: false };
  }
  async studioLogs(): Promise<StudioLogs> {
    return {
      dir: "C:\\Users\\demo\\AppData\\Roaming\\Reasonix Studio\\io.reasonix.studio.1a2b3c\\logs",
      crashDir: "C:\\Users\\demo\\AppData\\Roaming\\Reasonix Studio\\io.reasonix.studio.1a2b3c\\logs\\crash",
      crashes: [{ name: "host-20261010T230806Z-2.31.0-4412.log", at: "2026-10-10T23:08:06Z", bytes: 8421 }],
      truncated: false,
    };
  }
  async acknowledgeLaunchHealth(): Promise<void> {} // booted from no update
  async goToVersion(): Promise<void> {
    throw new Error("演示模式不会真的安装版本");
  }
  async cancelVersion(): Promise<void> { throw new Error("演示模式不会真的安装版本"); }
  async restartToVersion(): Promise<void> { throw new Error("演示模式不会真的安装版本"); }

  onUpdateProgress(): () => void {
    return () => {};
  }
}
