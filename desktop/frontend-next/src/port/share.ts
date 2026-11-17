// The window's door for phones: a second listener on a private address that a
// paired device reaches the same panes through. Mirrors serve.ShareStatus,
// serve.ShareOffer and serve.DeviceView.

// lan is Wi-Fi or Ethernet; virtual is a VPN or proxy tunnel a phone usually
// cannot reach. Loopback is 127.0.0.1: no phone dials it, but a proxy or tunnel
// on this machine does, and it is the only address that survives this machine
// changing networks. The kernel lists them in that order, so the first is the
// default.
export type AddressKind = "lan" | "tailnet" | "virtual" | "loopback";

export interface ShareAddress {
  interface: string;
  ip: string;
  kind: AddressKind;
}

export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeen: string;
  // Holding an event stream open now: a page on screen.
  online: boolean;
  // How this device last reached the share: the address a phone on this network
  // dials, or the proxy's name. Absent in a status read from a kernel that
  // predates it, which the card reads as the local door.
  door?: OfferChannel;
}

export interface CloudDevice {
  id: string;
  name: string;
  connectedAt: string;
  lastSeen: string;
  ordinal: number;
}

export interface CloudRemoteStatus {
  deviceId?: string;
  name?: string;
  online: boolean;
  error?: string;
  reason?: "signed_out" | "relay_unreachable" | "relay_refused";
}

// A paired device's answer about itself. Mirrors serve.DeviceSelf.
export interface DeviceSelf {
  id: string;
  // The number the window lists it under, so both say 设备 N.
  ordinal: number;
  machine: string;
}

export interface ShareStatus {
  open: boolean;
  // The fixed port the user chose; absent means the system picks one each time.
  port?: number;
  // The address a phone on this network types in — the local channel's door.
  origin?: string;
  // The address the proxy channel answers at, which is the proxy's configured
  // name. Absent until a proxy is named, and absent while a saved name has not
  // reached an open door yet (appliedPublicOrigin says the latter).
  proxyOrigin?: string;
  // The reverse proxy's name for this machine, when one is configured: the
  // address a phone outside this network reaches the door through.
  publicOrigin?: string;
  // The name the open door's gate was built with. It lags `publicOrigin` after
  // a change that has not been applied yet, so the panel can say "next time the
  // door opens" without showing a stale value in the field just typed into.
  appliedPublicOrigin?: string;
  // Why a named proxy has no door beside the phone's, when it could not be
  // raised. A name applied to an open share whose proxy channel is missing
  // reads as a feature that should work and does not; this says which half is
  // missing. Absent when the proxy's door is open or no proxy is named.
  proxyDoorError?: string;
  addresses: ShareAddress[];
  devices: PairedDevice[];
  cloudDevices: CloudDevice[];
  cloudRemote?: CloudRemoteStatus;
  offerExpires?: string;
}

// The two doors a share can hand out a code for: the address a phone on this
// network dials, and the reverse proxy's name for machines that are not here.
export type OfferChannel = "lan" | "proxy";

export interface ShareOffer {
  // Which door the link below points at. The kernel always names it — a code is
  // minted for one door and is spent nowhere on the other — so a reader can tell
  // which door the picture on screen belongs to instead of trusting the tab.
  channel: OfferChannel;
  url: string;
  // An SVG document, drawn dark on light whatever the theme so it scans.
  qr: string;
  expires: string;
}

export interface CloudShareOffer {
  url: string;
  qr: string;
}

// One device (a phone's browser) enrolled against this Studio at the account
// service. Mirrors serve.PhoneView. pending is waiting for the person here.
export interface PhoneView {
  id: string;
  ordinal?: number;
  name: string;
  state: "pending" | "active" | "revoked";
  uaClass: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt?: string;
  // What to compare when two devices look alike.
  keyThumbprint: string;
  // The active device a pending one says it replaces.
  replaceCandidate?: string;
}

export interface PhoneList {
  phones: PhoneView[];
}

export type PhoneAction = "add" | "replace" | "reject";

export interface SharePort {
  // Null where this kernel has no window to share from: a browser tab, or a
  // phone that is itself paired.
  shareStatus(): Promise<ShareStatus | null>;
  openShare(ip: string): Promise<ShareStatus>;
  closeShare(): Promise<ShareStatus>;
  // Zero clears the choice. Used the next time the door opens.
  setSharePort(port: number): Promise<ShareStatus>;
  // The reverse proxy's name a phone reaches this door through, or empty for
  // none. Used the next time the door opens, and where its code points.
  setSharePublicOrigin(origin: string): Promise<ShareStatus>;
  // Whether this install keeps the phones that paired across restarts. Null
  // where the reading failed: the share routes exist only on a window's kernel.
  shareRemember(): Promise<{ remember: boolean } | null>;
  setShareRemember(remember: boolean): Promise<{ remember: boolean }>;
  // A pairing code for one door. The channel names which: the local address a
  // phone on this network dials, or the reverse proxy's name for machines that
  // are elsewhere. Omitting it asks for the local one.
  //
  // link asks for a code to ride a copied link rather than the symbol drawn on
  // screen. The two are separate one-shot credentials: minting the link's leaves
  // the symbol scannable, so "copy the link" no longer cancels the picture.
  offerShare(channel?: OfferChannel, link?: boolean): Promise<ShareOffer>;
  offerCloudShare(): Promise<CloudShareOffer>;
  revokeDevice(id: string): Promise<ShareStatus>;
  // The devices enrolled against this Studio at the account service. Null where
  // this kernel has no window to ask from; a refusal is a thrown coded error.
  sharePhones(): Promise<PhoneList | null>;
  // Answers a waiting device, and answers with the list as it is afterwards.
  resolvePhone(id: string, action: PhoneAction, replaceId?: string): Promise<PhoneList>;
  revokePhone(id: string): Promise<PhoneList>;
  // What this page is to the kernel: a paired device, or null for the window
  // and for a browser on a networked serve.
  device(): Promise<DeviceSelf | null>;
  // Unpairs this device from its own side.
  leaveDevice(): Promise<void>;
}
