import { t } from "../i18n";
import type { AgentPort } from "../port/port";
import { Group } from "./Group";
import { Logs } from "./Logs";
import { SectionCard } from "./SectionCard";
import { TraceExport } from "./TraceExport";
import { Versions } from "./Versions";

// Signing in used to have a card here, the community a group below it, and an
// about card under that. None survives the removal of the cloud features: an
// account existed to own a cloud backup and to publish to the market, and the
// sponsorship block outlived the audience it was written for. What is left is
// what the page's name still promises — the version and the diagnostics.
export function AccountSettings({ port, homePort }: { port: AgentPort; homePort: AgentPort }) {
  return (
    <>
      <SectionCard title={t("settings.version_and_diagnostics")}>
        <Group id="versions" title={t("common.version")} hint={t("settings.versions_hint")}>
          <Versions port={homePort} />
        </Group>
        <Group id="logs" title={t("about.logs_and_abnormal_exit_records")} hint={t("settings.logs_hint")}>
          <Logs port={homePort} />
        </Group>
        <TraceExport port={port} />
      </SectionCard>
    </>
  );
}
