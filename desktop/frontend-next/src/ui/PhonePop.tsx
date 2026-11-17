import { StudioIcon } from "./StudioIcon";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { reason } from "../i18n/kernel";
import type { HubPort } from "../port/hub";
import type { CloudDevice, PairedDevice } from "../port/share";
import { copyText } from "./CopyButton";
import { arrowTabs } from "./tablist";
import { useDismiss } from "./dismiss";
import { clock, deviceLabel, doorAddress, type Share, useShare } from "./PhoneAccess";
import { TooltipButton } from "./TooltipButton";

/** The chrome's way to put a phone on this window: a code on a card, one
 *  press from anywhere. Drawn only where the kernel has a window to share —
 *  a browser tab or a paired phone gets nothing here. */
export function PhonePop({ hub }: { hub: HubPort }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, box, close);
  // Watched while the door is open, card or not: the count on the button and
  // the note that a phone came or went are the window's to show unasked.
  // A failure in the card is said in the card, next to what failed.
  const [failure, setFailure] = useState("");
  const share = useShare(hub, useCallback((e: unknown) => setFailure(reason(e)), []));
  const { refresh, newCode } = share;
  const shareOpen = share.st?.open ?? false;
  const offerHeld = useRef(false);
  offerHeld.current = share.offer !== null;

  // Opening the card is asking for a code, once per opening: after a phone
  // spends it, the next one is asked for by hand. Another surface may have shut
  // the door since the card was last drawn, so the code waits for the read.
  const minted = useRef(false);
  useEffect(() => {
    if (!open) {
      minted.current = false;
      setFailure("");
      return;
    }
    let live = true;
    refresh()
      .then((now) => {
        if (!live || minted.current) return;
        minted.current = true;
        if (now?.open && !(offerHeld.current && now.offerExpires)) {
          void newCode();
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, refresh, newCode]);

  const localNote = usePresenceNote(share.st?.devices, open);
  const cloudNote = useCloudPresenceNote(share.st?.cloudDevices, open);

  if (!share.st) return null;
  const online = share.st.devices.filter((d) => d.online).length + share.st.cloudDevices.length;
  return (
    <div className="phonepop" ref={box}>
      <TooltipButton
        className="thbtn phone-action"
        data-action="share.card"
        data-live={shareOpen ? "" : undefined}
        aria-expanded={open}
        aria-label={t("remote.device_access")}
        title={online > 0 ? t("remote.device_access_n_online", { n: online }) : t("remote.device_access")}
        onClick={() => setOpen((v) => !v)}
      >
        <StudioIcon name="qr" />
        {online > 0 && <b className="pc-count">{online}</b>}
      </TooltipButton>
      {open && <PhoneCard share={share} failure={failure} />}
      {(cloudNote || localNote) && <div className="pc-note-pop" role="status">{cloudNote || localNote}</div>}
    </div>
  );
}

/** What changed between two reads of the device list, as the one line worth
 *  saying: a phone that came online, went offline, or was unpaired. Each is
 *  named by its place in the list it was read from. */
export function presenceNote(prev: PairedDevice[], next: PairedDevice[]): string {
  let said = "";
  next.forEach((d, i) => {
    const was = prev.find((p) => p.id === d.id);
    if (d.online && !was?.online) said = t("remote.device_n_connected", { n: i + 1 });
    else if (!d.online && was?.online) said = t("remote.device_n_disconnected", { n: i + 1 });
  });
  prev.forEach((p, i) => {
    if (!next.some((d) => d.id === p.id)) said = t("remote.device_n_disconnected", { n: i + 1 });
  });
  return said;
}

export function cloudPresenceNote(prev: CloudDevice[], next: CloudDevice[]): string {
  const connected = next.find((device) => !prev.some((was) => was.id === device.id));
  if (connected) return t("remote.web_studio_connected");
  const disconnected = prev.find((device) => !next.some((now) => now.id === device.id));
  return disconnected ? t("remote.web_studio_disconnected") : "";
}

/** A line under the button when a phone comes or goes, for as long as it takes
 *  to read. Not while the card is open: the list there already shows it. */
function usePresenceNote(devices: PairedDevice[] | undefined, open: boolean): string {
  const [note, setNote] = useState("");
  const before = useRef<PairedDevice[] | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!devices) return;
    const prev = before.current;
    before.current = devices;
    if (!prev || open) return;
    const said = presenceNote(prev, devices);
    if (!said) return;
    setNote(said);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(""), 3200);
  }, [devices, open]);
  return open ? "" : note;
}

function useCloudPresenceNote(devices: CloudDevice[] | undefined, open: boolean): string {
  const [note, setNote] = useState("");
  const before = useRef<CloudDevice[] | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!devices) return;
    const prev = before.current;
    before.current = devices;
    if (!prev || open) return;
    const said = cloudPresenceNote(prev, devices);
    if (!said) return;
    setNote(said);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(""), 3200);
  }, [devices, open]);
  return open ? "" : note;
}

/** The phones already connected, then the two ways a phone gets here: the
 *  address it dials on this network, or the proxy's name when it is elsewhere.
 *  The door itself is switched from settings, so the card only shows a code. */
function PhoneCard({ share, failure }: { share: Share; failure: string }) {
  const { st, ip, pick, offer, channel, chooseChannel, pairingLink, busy, newCode, revoke } = share;
  const [copied, setCopied] = useState("");
  const [arming, setArming] = useState("");
  const arm = useRef<number | null>(null);
  useEffect(() => () => { if (arm.current !== null) window.clearTimeout(arm.current); }, []);
  // One button copies, so one flag names it. The timer is held and cleared on
  // each press, or the previous press's would blank this one's confirmation
  // early — and again after the card is gone. Declared above the `!st` return:
  // a hook below it would run on some renders and not others.
  const confirm = useRef<number | null>(null);
  useEffect(() => () => { if (confirm.current !== null) window.clearTimeout(confirm.current); }, []);
  if (!st) return null;
  const hasProxy = Boolean(st.proxyOrigin);
  const onProxy = channel === "proxy";
  const chosen = ip || (st.open ? st.origin?.replace(/^https?:\/\//, "").replace(/:\d+$/, "") : "") || doorAddress(st);
  // Loopback is not a choice this card offers: no phone dials it, and the kernel
  // opens the proxy's door there by itself whenever a proxy is named.
  const dialable = st.addresses.filter((a) => a.kind !== "loopback");
  // What this tab is telling a phone to type in. Held as a local so the onClick
  // below reads a value that cannot change under it. The proxy tab names the
  // proxy's own address, never the loopback socket behind it: that one is what
  // the proxy dials, and no phone can reach it.
  const address = st.open ? (onProxy ? st.proxyOrigin ?? "" : st.origin ?? "") : "";
  // The proxy tab has nothing to show until a name is configured, and neither
  // tab has anything until the door is switched on in settings.
  const blocked = !st.open ? "off" : onProxy && !hasProxy ? "no-proxy" : "";
  // A proxy named while its door stayed shut is not the same as no proxy named,
  // and it cannot be said from the proxy tab: that tab is unusable in both
  // cases, so nothing on it would ever be read. It is a fact about the share
  // rather than about either tab, so it is said beside the share.
  const proxyMissed = st.open && !hasProxy && Boolean(st.proxyDoorError);

  // One press either copies or says it could not. The press is remembered for as
  // long as the word is readable, and the timer is cleared on the next press so
  // the earlier one cannot blank this one's confirmation early.
  const showCopied = (what: string) => {
    setCopied(what);
    if (confirm.current !== null) window.clearTimeout(confirm.current);
    confirm.current = window.setTimeout(() => setCopied(""), 1600);
  };

  const copy = (what: string, url: string) =>
    copyText(url)
      .then(() => showCopied(what))
      // A refused clipboard is said on the button rather than swallowed: a press
      // that did nothing and said nothing reads as a broken button.
      .catch(() => showCopied("failed"));

  // What the copy button puts on the clipboard is the pairing link, not the bare
  // address: a browser that has not paired cannot get past the gate with an
  // address alone, and "copy the address" read as though it could. The code rides
  // the fragment, so the recipient's browser trades it for a cookie on the way in
  // and wipes it from the address bar afterwards.
  const copyPairingLink = () => {
    void pairingLink()
      .then((url) => copy("address", url))
      .catch(() => showCopied("failed"));
  };

  // Disconnecting takes a second press on the same place, which is cheaper
  // than a dialog in a card this small and still not one slip.
  const disconnect = (id: string) => {
    if (arm.current !== null) window.clearTimeout(arm.current);
    if (arming !== id) {
      setArming(id);
      arm.current = window.setTimeout(() => setArming(""), 3000);
      return;
    }
    setArming("");
    void revoke(id);
  };

  const phones = st.cloudDevices.length + (st.open ? st.devices.filter((d) => d.online).length : 0);
  return (
    <div className="phonecard" role="dialog" aria-label={t("remote.device_access")}>
      <header>
        <span>
          <b>{t("remote.use_studio_on_your_phone")}</b>
          <small>{t("remote.scan_with_your_phone_to")}</small>
        </span>
      </header>

      {failure && <p className="pc-err" role="alert">{failure}</p>}

      {(st.cloudDevices.length > 0 || (st.open && st.devices.length > 0)) && (
        <section className="pc-phones">
          <div className="pc-hd">
            <b>{t("remote.n_phones_connected", { n: phones })}</b>
          </div>
          {st.cloudDevices.map((device) => (
            <div className="pc-dev" key={device.id} data-online="">
              <i aria-hidden="true" />
              <span>{t("remote.device_n", { n: device.ordinal })}</span>
              <small>{device.name} · {t("remote.from_anywhere")}</small>
              <button
                data-action={arming === device.id ? "share.revoke" : "share.ask-revoke"}
                data-target={device.id}
                data-armed={arming === device.id ? "" : undefined}
                onClick={() => disconnect(device.id)}
              >
                {arming === device.id ? t("remote.disconnect_2") : t("remote.disconnect")}
              </button>
            </div>
          ))}
          {st.open && st.devices.map((d, i) => (
            <div className="pc-dev" key={d.id} data-online={d.online ? "" : undefined}>
              <i aria-hidden="true" />
              <span title={d.name}>{deviceLabel(i)}</span>
              <small>{d.door === "proxy" ? t("remote.proxy_network") : t("remote.local_network")} · {d.online ? t("remote.online") : t("remote.last_seen_time", { time: clock(d.lastSeen) })}</small>
              <button
                data-action={arming === d.id ? "share.revoke" : "share.ask-revoke"}
                data-target={d.id}
                data-armed={arming === d.id ? "" : undefined}
                onClick={() => disconnect(d.id)}
              >
                {arming === d.id ? t("remote.disconnect_2") : t("remote.disconnect")}
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="pc-route" data-on={st.open ? "" : undefined}>
        <div className="pc-hd">
          <span>
            <b>{onProxy ? t("remote.proxy_network") : t("remote.local_network")}</b>
            <small>{onProxy ? t("remote.proxy_reaches_this_machine_at") : t("remote.this_machines_address_on_this")}</small>
          </span>
        </div>

        {/* The two doors a code can point at. Switching the tab asks the other
            door for its own code — the picture on screen carries a one-shot
            credential, and a link minted for one door is spent nowhere on the
            other. Nothing moves: the share answers on both at once. */}
        <div className="pc-tabs" role="tablist" aria-label={t("remote.pairing_door")} onKeyDown={arrowTabs}>
          <button
            role="tab"
            aria-selected={!onProxy}
            tabIndex={onProxy ? -1 : 0}
            data-action="share.channel"
            data-channel="lan"
            disabled={busy}
            onClick={() => chooseChannel("lan")}
          >
            {t("remote.local_network")}
          </button>
          <button
            role="tab"
            aria-selected={onProxy}
            tabIndex={onProxy ? 0 : -1}
            data-action="share.channel"
            data-channel="proxy"
            disabled={busy || !hasProxy}
            onClick={() => chooseChannel("proxy")}
          >
            {t("remote.proxy_network")}
          </button>
        </div>

        {/* What this tab is telling a phone to dial, and the one press that hands
            it to someone else. The code shown is the bare address — the part
            worth reading out when a camera cannot be used — while the copy button
            puts the pairing link on the clipboard, because an address alone stops
            a fresh browser at "this device is not paired". */}
        {address && (
          <div className="pc-row pc-origin">
            <span>{t("remote.address")}</span>
            <code dir="ltr" title={address}>{address}</code>
            <button data-action="share.copy-address" onClick={() => void copyPairingLink()}>
              {copied === "address" ? t("common.copied") : copied === "failed" ? t("remote.copy_blocked") : t("remote.copy_pairing_link")}
            </button>
          </div>
        )}

        {blocked === "off" && <p className="pc-when">{t("remote.turn_on_access_in_settings")}</p>}
        {blocked === "no-proxy" && <p className="pc-when">{t("remote.no_proxy_configured")}</p>}
        {proxyMissed && <p className="pc-when">{t("remote.proxy_door_could_not_open")}</p>}

        {st.open && !blocked && (
          <div className="pc-code">
            {offer ? (
              <>
                <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(offer.qr)}`} alt={t("remote.pairing_qr_code")} width={148} height={148} />
                <span className="pc-when">
                  {onProxy
                    ? t("remote.proxy_pairing_until", { time: clock(offer.expires) })
                    : t("remote.local_pairing_until", { time: clock(offer.expires) })}
                </span>
                <span className="pc-acts">
                  <button data-action="share.offer" disabled={busy} onClick={() => void newCode()}>{t("common.new_code")}</button>
                </span>
              </>
            ) : (
              <button className="pc-mint" data-action="share.offer" disabled={busy} onClick={() => void newCode()}>
                {t("remote.show_local_network_qr_code")}
              </button>
            )}
          </div>
        )}

        {/* Which of this machine's adapters the local door listens on. The proxy
            tab has no such choice: loopback is the only address a proxy on this
            machine can dial. Loopback is not offered here either — the kernel
            opens that door by itself, and no phone dials it. */}
        {!onProxy && dialable.length > 1 && (
          <label className="pc-row">
            <span>{t("common.network")}</span>
            <select data-size="sm" data-action="share.address" value={chosen} disabled={busy} onChange={(e) => pick(e.target.value)}>
              {dialable.map((a) => (
                <option key={a.ip} value={a.ip}>
                  {a.kind === "tailnet"
                    ? `${a.ip} · Tailscale`
                    : a.kind === "virtual"
                      ? `${a.ip} · ${t("remote.virtual_adapter")}`
                      : `${a.ip} · ${a.interface}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
    </div>
  );
}
