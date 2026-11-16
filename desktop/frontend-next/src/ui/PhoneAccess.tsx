import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import type { HubPort } from "../port/hub";
import type { OfferChannel, ShareOffer, ShareStatus } from "../port/share";
import { copyText } from "./CopyButton";
import { Switch } from "./Switch";

interface Props {
  hub: HubPort;
  onError: (e: unknown) => void;
}

// While the door is open the list is what changes under the reader: a phone
// pairs, the code on screen is spent. Nothing pushes that, so it is read.
const POLL_MS = 3000;

export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// A device is named by when it paired. Its user agent is kept, as the title,
// but read as a name it is a hundred characters and every one starts the same.
export const deviceLabel = (i: number) => t("remote.device_n", { n: i + 1 });

/** The address the door should open on.
 *
 *  Loopback is never the answer: no phone dials it. The kernel opens the proxy's
 *  loopback door beside the one named here when a proxy is configured, so naming
 *  the Wi-Fi address costs the proxy nothing and keeps the phone's own channel
 *  answering. The list is ordered for a phone, so the first entry is the one. */
export function doorAddress(st: ShareStatus | null): string {
  if (!st) return "";
  const reachable = st.addresses.find((a) => a.kind !== "loopback");
  return reachable?.ip ?? st.addresses[0]?.ip ?? "";
}

export type Share = ReturnType<typeof useShare>;

/** The window's door for phones, as one state both the settings block and the
 *  chrome's card draw from. `watch` is whether this surface is on screen: only
 *  then is the device list worth reading on a timer. */
export function useShare(hub: HubPort, onError: (e: unknown) => void, watch = true) {
  const [st, setSt] = useState<ShareStatus | null>(null);
  const [ip, setIp] = useState("");
  const [offer, setOffer] = useState<ShareOffer | null>(null);
  // Which door the panel is showing: the address a phone on this network dials,
  // or the reverse proxy's name. Only the code and the address follow it — the
  // door itself answers on both, so switching this moves nothing.
  const [channel, setChannel] = useState<OfferChannel>("lan");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState<boolean | null>(null);

  const read = useCallback(
    () =>
      hub.shareStatus().then((now) => {
        setSt(now);
        return now;
      }),
    [hub],
  );

  useEffect(() => {
    read().catch(() => setSt(null));
  }, [read]);

  useEffect(() => {
    if (!watch) return;
    void read().catch(() => {});
    const timer = setInterval(() => read().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [watch, read]);

  // The kernel withdraws a code once it pairs or lapses; the picture of it has
  // to go too, or the next phone scans a code that can no longer work.
  useEffect(() => {
    if (offer && st && !st.offerExpires) setOffer(null);
  }, [st, offer]);

  const run = useCallback(
    async (step: () => Promise<void>) => {
      setBusy(true);
      try {
        await step();
      } catch (e) {
        onError(e);
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    hub.shareRemember().then((r) => setRemember(r?.remember ?? false)).catch(() => setRemember(null));
  }, [hub]);

  const saveRemember = useCallback(
    (on: boolean) => run(async () => setRemember((await hub.setShareRemember(on)).remember)),
    [run, hub],
  );

  // The code and the status that knows it is on offer land together; set one
  // at a time, the effect above reads a fresh code against a status that has
  // not heard of it yet and drops it. It answers with the offer so a caller that
  // needs the link in hand — copying one, say — does not have to wait a render.
  const mint = useCallback(
    async (which: OfferChannel) => {
      const next = await hub.offerShare(which);
      const now = await hub.shareStatus();
      setSt(now);
      setOffer(next);
      return next;
    },
    [hub],
  );

  // The link worth copying: the address plus the one-shot code the picture
  // carries. A bare address only leads a browser that has already paired to the
  // window — a fresh one stops at "this device is not paired", which is exactly
  // what a code is for. The code in hand is reused; when none is, one is minted.
  const pairingLink = useCallback(async (): Promise<string> => {
    const live = offer ?? (await mint(channel));
    return live.url;
  }, [offer, mint, channel]);

  const newCode = useCallback(() => run(async () => { await mint(channel); }), [run, mint, channel]);

  // Switching the channel asks that door for its own code: the picture on screen
  // was minted for the other one, and its link would be spent nowhere. Nothing
  // moves — the door answers on both addresses at once.
  const chooseChannel = (next: OfferChannel) => {
    if (next === channel) return;
    setChannel(next);
    setOffer(null);
    if (!st?.open) return;
    void run(async () => { await mint(next); });
  };

  const toggle = () => run(async () => {
    if (st?.open) {
      setOffer(null);
      setSt(await hub.closeShare());
      return;
    }
    const at = ip || doorAddress(st);
    await hub.openShare(at);
    await mint(channel);
  });

  const revoke = (id: string) => run(async () => setSt(await hub.revokeDevice(id)));

  // Choosing another network while the door is open moves it there: the old
  // address stops answering, so the code and every pairing go with it.
  const pick = (next: string) => {
    setIp(next);
    if (!st?.open) return;
    void run(async () => {
      setOffer(null);
      await hub.openShare(next);
      await mint(channel);
    });
  };

  // A fixed port is read at the next open, so an open door is moved to it the
  // way a network change moves it: the old origin stops answering.
  const savePort = (port: number) =>
    run(async () => {
      const next = await hub.setSharePort(port);
      setSt(next);
      if (!next.open) return;
      const at = ip || next.origin?.replace(/^https?:\/\//, "").replace(/:\d+$/, "") || doorAddress(next);
      setOffer(null);
      await hub.openShare(at);
      await mint(channel);
    });

  // The proxy's name is read at the next open too — its gate is built then —
  // so unlike the port it is saved without moving an open door: moving a door
  // that phones are already using would unpair them for a setting about where
  // the *next* one listens.
  const savePublicOrigin = (origin: string) =>
    run(async () => setSt(await hub.setSharePublicOrigin(origin)));

  return { st, ip, pick, savePort, savePublicOrigin, offer, channel, chooseChannel, pairingLink, busy, confirm, setConfirm, newCode, toggle, revoke, remember, saveRemember, refresh: read };
}

/** The switch, the network, the code and the paired phones. */
export function ShareBody({ share }: { share: Share }) {
  const { st, ip, pick, savePort, savePublicOrigin, offer, busy, confirm, setConfirm, newCode, toggle, revoke, remember, saveRemember } = share;
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  const [portDraft, setPortDraft] = useState<string | null>(null);
  const [publicDraft, setPublicDraft] = useState<string | null>(null);
  if (!st) return null;
  // The link the code draws, for a device that cannot scan: the same one-time
  // credential, so it is copied on request and never shown as text.
  const copyLink = (url: string) =>
    copyText(url)
      .then(() => setCopied("done"))
      .catch(() => setCopied("failed"))
      .finally(() => window.setTimeout(() => setCopied(""), 1600));
  const chosen = ip || (st.open ? st.origin?.replace(/^https?:\/\//, "").replace(/:\d+$/, "") : "") || doorAddress(st);
  // Loopback is not a choice this panel offers: no phone dials it, and the kernel
  // opens the proxy's door there by itself when a proxy is named. Listing it only
  // invited a pick that leaves the phone with nothing to connect to.
  const dialable = st.addresses.filter((a) => a.kind !== "loopback");
  // A machine with neither a dialable address nor a proxy in front has nowhere
  // to open: loopback alone is a door only this machine can dial, which is
  // useless without something on this machine dialling it.
  const noNetwork = !st.publicOrigin && dialable.length === 0;
  const commitPort = () => {
    if (portDraft === null) return;
    const next = portDraft === "" ? 0 : Number(portDraft);
    setPortDraft(null);
    if (next !== (st.port ?? 0)) void savePort(next);
  };
  const commitPublicOrigin = () => {
    if (publicDraft === null) return;
    const next = publicDraft.trim();
    setPublicDraft(null);
    if (next !== (st.publicOrigin ?? "")) void savePublicOrigin(next);
  };

  return (
    <>
      <div className="lrow">
        <span className="tx">
          <span className="lb">{t("remote.allow_phones_to_connect")}</span>
          <span className="ds">
            {noNetwork
              ? t("remote.this_computer_has_no_private")
              : t("remote.a_phone_on_the_same")}
          </span>
        </span>
        <Switch data-action="share.toggle" on={st.open} busy={busy || noNetwork} label={t("remote.allow_phones_to_connect")} onClick={() => void toggle()} />
      </div>

      <div className="lrow">
        <span className="tx">
          <span className="lb">{t("remote.remember_paired_phones")}</span>
          <span className="ds">
            {t("remote.when_on_a_restart_reopens")}
          </span>
        </span>
        <Switch data-action="share.remember" on={remember ?? false} busy={busy || remember === null} label={t("remote.remember_paired_phones")} onClick={() => void saveRemember(!(remember ?? false))} />
      </div>

      {dialable.length > 1 && (
        <label className="rmtf">
          <span>{t("common.network")}</span>
          <select
            data-action="share.address"
            value={chosen}
            disabled={busy}
            onChange={(e) => pick(e.target.value)}
          >
            {dialable.map((a) => (
              <option key={a.ip} value={a.ip}>
                {a.kind === "tailnet"
                  ? `${a.ip} · Tailscale`
                  : a.kind === "virtual"
                    ? `${a.ip} · ${a.interface} · ${t("remote.virtual_adapter")}`
                    : `${a.ip} · ${a.interface}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {st.addresses.length > 1 && st.open && st.devices.length > 0 && (
        <p className="rmthint">{t("remote.switching_networks_disconnects_the_connected")}</p>
      )}

      <label className="rmtf">
        <span>{t("common.port")}</span>
        <input
          data-action="share.port"
          inputMode="numeric"
          maxLength={5}
          value={portDraft ?? (st.port ? String(st.port) : "")}
          placeholder={t("common.auto")}
          disabled={busy}
          onChange={(e) => setPortDraft(e.target.value.replace(/\D/g, ""))}
          onBlur={commitPort}
        />
      </label>
      <p className="rmthint">
        {t("remote.leave_empty_to_let_the")}
      </p>
      {st.open && st.devices.length > 0 && <p className="rmthint">{t("remote.changing_the_port_disconnects_the")}</p>}

      <label className="rmtf">
        <span>{t("remote.reverse_proxy_address")}</span>
        <input
          data-action="share.public-origin"
          inputMode="url"
          maxLength={255}
          value={publicDraft ?? st.publicOrigin ?? ""}
          placeholder="https://agent.example.com"
          disabled={busy}
          onChange={(e) => setPublicDraft(e.target.value)}
          onBlur={commitPublicOrigin}
        />
      </label>
      <p className="rmthint">{t("remote.reverse_proxy_address_hint")}</p>
      {st.open && st.devices.length > 0 && <p className="rmthint">{t("remote.reverse_proxy_takes_effect_next_open")}</p>}

      {st.open && (
        <div className="shareopen">
          {offer ? (
            <div className="shareqr">
              <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(offer.qr)}`} alt={t("remote.pairing_qr_code")} width={184} height={184} />
              <div className="sharehow">
                <span className="lb">{t("remote.scan_with_your_phones_camera")}</span>
                <span className="ds">{t("remote.the_code_pairs_one_phone", { time: clock(offer.expires) })}</span>
                <code dir="ltr">{st.origin}</code>
                <button className="rmtlnk sharecopy" data-action="share.copy" onClick={() => void copyLink(offer.url)}>
                  {copied === "done" ? t("common.copied") : copied === "failed" ? t("remote.copy_blocked") : t("remote.copy_pairing_link")}
                </button>
              </div>
            </div>
          ) : (
            <button className="rmtadd" data-action="share.offer" disabled={busy} onClick={() => void newCode()}>
              {t("remote.show_a_pairing_code")}
            </button>
          )}

          <div className="sharedevs">
            {st.devices.map((d, i) => (
              <div className="sharedev" key={d.id}>
                <span className="nm" title={d.name}>{deviceLabel(i)}</span>
                <span className="st">{d.online ? t("remote.paired_time_online", { time: clock(d.pairedAt) }) : t("remote.paired_time_last_seen_seen", { time: clock(d.pairedAt), seen: clock(d.lastSeen) })}</span>
                {confirm === d.id ? (
                  <span className="rmtconfirm" role="alertdialog">
                    <span>{t("remote.disconnect_this_phone_it_will")}</span>
                    <button data-action="share.keep" data-target={d.id} onClick={() => setConfirm("")}>{t("common.cancel")}</button>
                    <button
                      data-danger=""
                      data-action="share.revoke"
                      data-target={d.id}
                      autoFocus
                      onClick={() => {
                        setConfirm("");
                        void revoke(d.id);
                      }}
                    >
                      {t("remote.disconnect")}
                    </button>
                  </span>
                ) : (
                  <button className="rmtlnk" data-danger="" data-action="share.ask-revoke" data-target={d.id} onClick={() => setConfirm(d.id)}>
                    {t("remote.disconnect")}
                  </button>
                )}
              </div>
            ))}
            {st.devices.length === 0 && <p className="rmtempty">{t("remote.no_phone_is_connected_yet")}</p>}
          </div>

          <p className="sharewarn">
            {t("remote.the_connection_is_plain_http")}
          </p>
        </div>
      )}
    </>
  );
}

/** A phone on the same network drives this window's panes. Nothing here is
 *  kept: the door shuts with the window, and shutting it unpairs every phone. */
export function PhoneAccess({ hub, onError }: Props) {
  const share = useShare(hub, onError);
  // A settings page must not grow a heading for a door this kernel cannot open.
  if (!share.st) return null;
  return (
    <div className="phone-door">
      <div className="grp-hd">
        <h3>{t("remote.phone_access")}</h3>
      </div>
      <div className="grp-items share">
        <ShareBody share={share} />
      </div>
    </div>
  );
}
