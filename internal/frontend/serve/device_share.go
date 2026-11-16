package serve

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
)

// ErrShareAddress refuses an address the window does not own on a private
// network. Binding a wildcard or a public address is not a sharing decision
// this surface makes.
var ErrShareAddress = errors.New("that address is not a private address on this machine")

// ErrShareClosed is an offer asked of a share that is not listening.
var ErrShareClosed = errors.New("sharing is off")

// ErrShareUnattached is a share opened before the host named what it serves.
var ErrShareUnattached = errors.New("sharing has nothing to serve yet")

// tailnetPrefix is the CGNAT range Tailscale hands out; its traffic is already
// encrypted end to end, which makes it the one routed network worth offering.
var tailnetPrefix = netip.MustParsePrefix("100.64.0.0/10")

// loopbackIP is the address a proxy on this machine dials, and the one address
// that does not change when the machine joins another network.
const loopbackIP = "127.0.0.1"

// DeviceShare is a window's second door: a listener on a private address that
// paired devices reach the window's hub through, behind a device gate. It is
// shut until the person at the window opens it, and shutting it unpairs every
// device.
type DeviceShare struct {
	registry *DeviceRegistry
	cloud    *cloudPresence
	page     fs.FS
	// addresses lists what may be bound; a variable seam so tests need no NIC.
	addresses func() []ShareAddress
	// turn serialises Open and Close, so two opens cannot leave one listener
	// running that nothing will ever stop.
	turn sync.Mutex

	mu              sync.Mutex
	handler         http.Handler
	live            *shareListener
	cloudDisconnect func(string) error
	cloudStatus     func() CloudRemoteStatus
	cloudPhones     CloudPhones
	port            int
	// publicOrigin is the name a reverse proxy answers for this machine, as the
	// user configured it. Empty means nothing stands in front of the listener.
	publicOrigin string
	persistPort  func(int) error
	// persistState records whether the share is open and on what address, so the
	// next process can reopen it. Nil leaves the share in memory only, which is
	// what every test builds.
	persistState func(persistedShareState) error
	// remember reports whether this install keeps paired phones across restarts.
	// Nil is the historical behaviour: reopening the share or ending the process
	// unpairs every device, which is what a directly built share gets.
	remember func() bool
}

// remembers reports whether paired phones outlive the door that paired them.
func (s *DeviceShare) remembers() bool {
	return s.remember != nil && s.remember()
}

// shareDoor is one address a share answers on, as a page reached through it
// names it.
type shareDoor struct {
	ip     string
	origin string
}

// shareListener is one open share: every door it answers on. A phone on this
// network dials lan; a reverse proxy on this machine dials proxy, which is
// loopback and is zero when nothing stands in front.
type shareListener struct {
	lan shareDoor
	// proxy is the door a reverse proxy on this machine dials. Open beside the
	// phone's rather than instead of it, because the two never dial the same
	// address: choosing one used to darken the other.
	proxy shareDoor
	// publicOrigin is the proxy's name for this machine, when one was named:
	// the gates answer for it beside their own origins, and a pairing link for
	// the proxy channel points at it.
	publicOrigin string
	stop         context.CancelFunc
	done         chan struct{}
}

// hasProxy reports whether a proxy door is open beside the phone's.
func (l *shareListener) hasProxy() bool { return l.proxy.origin != "" }

// pairOrigin is where a pairing link points: the phone's own door for the local
// channel, and the proxy's public name for the proxy channel — a phone that
// reached the share that way needs a code it can spend there. The second answer
// says whether the share has the door that channel names.
func (l *shareListener) pairOrigin(channel OfferChannel) (string, bool) {
	if channel == OfferProxy {
		if !l.hasProxy() {
			return "", false
		}
		return l.publicOrigin, true
	}
	return l.lan.origin, true
}

// OfferChannel names which door a pairing link points at.
type OfferChannel string

const (
	// OfferLAN is the address a phone on this network reaches the window at.
	OfferLAN OfferChannel = "lan"
	// OfferProxy is the reverse proxy's name for this machine.
	OfferProxy OfferChannel = "proxy"
)

// ShareAddress is one address a share can listen on.
type ShareAddress struct {
	Interface string      `json:"interface"`
	IP        string      `json:"ip"`
	Kind      AddressKind `json:"kind"`
}

// AddressKind says what reaches an address, read from the interface itself.
type AddressKind string

const (
	// AddressLAN is a broadcast-capable adapter with a hardware address: Wi-Fi
	// or Ethernet, which a phone on the same network can reach.
	AddressLAN AddressKind = "lan"
	// AddressTailnet is a Tailscale address, reachable from anywhere on the
	// tailnet and encrypted on the way.
	AddressTailnet AddressKind = "tailnet"
	// AddressVirtual is anything else: a VPN or proxy tunnel, a VM switch.
	// Listed, because it may be what someone wants, but never the default.
	AddressVirtual AddressKind = "virtual"
	// AddressLoopback is 127.0.0.1. No phone reaches it, but a proxy or a
	// tunnel running on this machine hands requests to it, and it is the one
	// address that survives this machine moving between networks. A door a
	// proxy stands in front of should open here rather than on an address that
	// changes with the Wi-Fi, which is why it is listed at all.
	AddressLoopback AddressKind = "loopback"
)

var addressRank = map[AddressKind]int{AddressLAN: 0, AddressTailnet: 1, AddressVirtual: 2, AddressLoopback: 3}

// ShareStatus is the whole state a window draws its sharing panel from.
type ShareStatus struct {
	Open bool `json:"open"`
	Port int  `json:"port,omitempty"`
	// Origin is the address a phone on this network types in. Kept as the one
	// answer for callers that draw a single door.
	Origin string `json:"origin,omitempty"`
	// ProxyOrigin is the address the proxy channel answers at, which is the
	// proxy's configured name. Empty until a proxy is named, and empty while the
	// saved name has not reached an open door yet — AppliedPublicOrigin says the
	// latter.
	ProxyOrigin  string `json:"proxyOrigin,omitempty"`
	PublicOrigin string `json:"publicOrigin,omitempty"`
	// AppliedPublicOrigin is the name the open door's gate was built with. It
	// differs from PublicOrigin after a change that has not been applied yet,
	// which is what lets the panel say "next time the door opens" without
	// showing a stale value in the field the person just typed into.
	AppliedPublicOrigin string                `json:"appliedPublicOrigin,omitempty"`
	Addresses           []ShareAddress        `json:"addresses"`
	Devices             []DeviceView          `json:"devices"`
	CloudDevices        []CloudControllerView `json:"cloudDevices"`
	CloudRemote         CloudRemoteStatus     `json:"cloudRemote"`
	OfferExpires        *time.Time            `json:"offerExpires,omitempty"`
}

// CloudRemoteStatus is this Studio's own reachability through the encrypted
// Internet relay. The device identity routes a connection; it is not a
// credential, and the account service still verifies ownership before access.
type CloudRemoteStatus struct {
	DeviceID string `json:"deviceId,omitempty"`
	Name     string `json:"name,omitempty"`
	Online   bool   `json:"online"`
	Error    string `json:"error,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

type CloudShareOffer struct {
	URL string `json:"url"`
	QR  string `json:"qr"`
}

// ShareOffer is a pairing code as a device receives it: a link that carries the
// code in its fragment, and that link drawn as a QR code. Channel says which
// door the link points at, so a window drawing both can tell them apart.
type ShareOffer struct {
	Channel OfferChannel `json:"channel"`
	URL     string       `json:"url"`
	QR      string       `json:"qr"`
	Expires time.Time    `json:"expires"`
}

// NewDeviceShare returns a closed share serving page to devices.
func NewDeviceShare(page fs.FS) *DeviceShare {
	registry := NewDeviceRegistry()
	// Devices paired before a restart are adopted here, and every later change
	// writes them back: a phone that scanned once keeps its cookie across
	// restarts, until the share is closed or that device is removed.
	if trust := deviceTrustPath(); trust != "" {
		// Adopted only when the switch is on at startup; the hook stays wired
		// either way and reads the setting when it runs. Off forgets: an empty
		// set removes the file.
		if rememberPairedDevices() {
			registry.Restore(loadDeviceTrust(trust))
		}
		registry.persist = func(devices []persistedDevice) {
			if !rememberPairedDevices() {
				devices = nil
			}
			_ = saveDeviceTrust(trust, devices)
		}
	}
	return &DeviceShare{registry: registry, cloud: newCloudPresence(), page: page, addresses: PrivateAddresses, persistPort: persistSharePort, remember: rememberPairedDevices}
}

// Attach names the handler devices reach. The hub is built after the share it
// registers routes for, so this closes that loop before anything opens.
func (s *DeviceShare) Attach(h http.Handler) {
	s.mu.Lock()
	s.handler = h
	s.mu.Unlock()
}

// Open listens on ip, one of the addresses Status lists, on the configured port
// or one the system picks. A share already open stops listening first; the phones
// already paired stay paired, so reopening — after a restart, say — does not ask
// for a new code.
func (s *DeviceShare) Open(ip string) (ShareStatus, error) {
	if !slices.ContainsFunc(s.addresses(), func(a ShareAddress) bool { return a.IP == ip }) {
		return s.Status(), ErrShareAddress
	}
	s.turn.Lock()
	defer s.turn.Unlock()
	// An install that does not remember paired devices gets the share it always
	// had: opening it again is a fresh door, and the phones of the old one go
	// with it.
	if s.remembers() {
		s.stopListeningLocked()
	} else {
		s.closeLocked()
	}
	s.mu.Lock()
	handler := s.handler
	s.mu.Unlock()
	if handler == nil {
		return s.Status(), ErrShareUnattached
	}
	port := s.listenPort()
	publicOrigin := s.publicOriginName()
	ln, err := net.Listen("tcp", net.JoinHostPort(ip, port))
	if err != nil {
		if addrInUse(err) {
			return s.Status(), fmt.Errorf("%w: %w", ErrSharePortInUse, err)
		}
		return s.Status(), err
	}
	lan := shareDoor{ip: ip, origin: "http://" + ln.Addr().String()}
	// The proxy's door opens beside the phone's, never instead of it: the two
	// dial different addresses, so a machine that has both was only ever able to
	// offer one of them at a time. A proxy in front of this machine dials
	// loopback on the port the phone's door ended up on.
	var proxy shareDoor
	var proxyLn net.Listener
	if publicOrigin != "" {
		if ip == loopbackIP {
			// Loopback is the only address here — this machine has no adapter a
			// phone can reach, or the caller chose it. One socket then answers
			// for both, which is what the proxy needs anyway.
			proxy = shareDoor{ip: loopbackIP, origin: lan.origin}
		} else if _, actualPort, splitErr := net.SplitHostPort(ln.Addr().String()); splitErr == nil {
			if pln, listenErr := net.Listen("tcp", net.JoinHostPort(loopbackIP, actualPort)); listenErr == nil {
				proxyLn = pln
				proxy = shareDoor{ip: loopbackIP, origin: "http://" + pln.Addr().String()}
			} else {
				// The phone's door is up and is what the person asked for; the
				// proxy's is the extra, so it is said and not fatal.
				slog.Warn("serve: the phone share opened, but the proxy's door stayed shut", "addr", net.JoinHostPort(loopbackIP, actualPort), "err", listenErr)
			}
		}
	}
	ctx, stop := context.WithCancel(context.Background())
	live := &shareListener{lan: lan, proxy: proxy, publicOrigin: publicOrigin, stop: stop, done: make(chan struct{})}
	s.mu.Lock()
	s.live = live
	s.mu.Unlock()
	// Recorded only after the listener is real: the next process should reopen an
	// address that worked, never one that failed to bind.
	s.recordState(true, ip)
	// One gate per door: the gate settles which name a request arrived under
	// before anything else, and each door answers to its own address first.
	doors := []struct {
		ln     net.Listener
		origin string
	}{{ln, lan.origin}}
	if proxyLn != nil {
		doors = append(doors, struct {
			ln     net.Listener
			origin string
		}{proxyLn, proxy.origin})
	}
	var running sync.WaitGroup
	for _, d := range doors {
		gate := NewDeviceGate(handler, DeviceGateOptions{Registry: s.registry, Origin: d.origin, PublicOrigin: publicOrigin, Page: s.page, Machine: machineName()})
		running.Add(1)
		go func(ln net.Listener, gate http.Handler, origin string) {
			defer running.Done()
			if err := runGracefulListener(ctx, ln, gate); err != nil {
				slog.Warn("serve: device share stopped", "origin", origin, "err", err)
			}
		}(d.ln, gate, d.origin)
	}
	go func() {
		running.Wait()
		close(live.done)
	}()
	return s.Status(), nil
}

// Reopen reopens the share where it last listened. When that address is gone —
// another network, another adapter — it falls back to the first address this
// machine now offers, because a share that cannot reopen where it was is still
// better off open than silently shut. Phones paired on the old origin have to
// scan again in that case; one that kept its address does not.
//
// A machine with a reverse proxy opens on loopback instead, and that wins even
// over a remembered address that still answers: the proxy runs here and dials
// the door from here, and loopback is the one address this machine keeps when it
// joins another network. Remembering the old Wi-Fi address would re-bind the
// door to a number that is about to be someone else's — the failure this rules
// out. With no proxy configured, the remembered-or-first rule stands, because
// then a phone really does dial the LAN address.
func (s *DeviceShare) Reopen(address string) (ShareStatus, error) {
	list := s.addresses()
	// The remembered address when it is still offered and a phone could dial it.
	// Loopback is never that: it is the proxy's door, and Open opens that one
	// beside whichever address this is, so reopening there would leave the
	// phone's own channel dark.
	if strings.TrimSpace(address) != "" && isPhoneAddress(list, address) {
		if st, err := s.Open(address); err == nil {
			return st, nil
		}
	}
	if len(list) == 0 {
		return s.Status(), ErrShareAddress
	}
	if a, ok := phoneAddress(list); ok {
		return s.Open(a.IP)
	}
	return s.Open(list[0].IP)
}

// isPhoneAddress reports whether ip is one the list offers as a phone's door
// rather than the proxy's.
func isPhoneAddress(list []ShareAddress, ip string) bool {
	for _, a := range list {
		if a.IP == ip {
			return a.Kind != AddressLoopback
		}
	}
	return false
}

// RestoreState adopts what the previous process remembered — whether the share
// was open, and where — and wires the hook that records every later change. A
// share with no state file starts closed, which is the shipping default.
func (s *DeviceShare) RestoreState() persistedShareState {
	path := shareStatePath()
	if path == "" {
		return persistedShareState{}
	}
	s.mu.Lock()
	// The hook reads the setting when it runs, so the panel switch takes
	// effect without a restart; off forgets, and removing the file is what
	// forgetting records.
	s.persistState = func(st persistedShareState) error {
		if !rememberPairedDevices() {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
			return nil
		}
		return saveShareState(path, st)
	}
	s.mu.Unlock()
	if !rememberPairedDevices() {
		return persistedShareState{}
	}
	return loadShareState(path)
}

// recordState hands the current state to the hook, outside the lock so a disk
// write never holds up a request. The hook itself is read under the lock — it is
// set once, but the race detector cannot know that.
func (s *DeviceShare) recordState(open bool, address string) {
	s.mu.Lock()
	persist := s.persistState
	s.mu.Unlock()
	if persist != nil {
		if err := persist(persistedShareState{Open: open, Address: address}); err != nil {
			slog.Warn("serve: phone-access state was not recorded", "err", err)
		}
	}
}

// Close stops listening and unpairs every device — the user closing the share.
func (s *DeviceShare) Close() {
	s.turn.Lock()
	defer s.turn.Unlock()
	s.closeLocked()
}

// Shutdown stops listening when the process is going away. An install that
// remembers paired devices keeps them, so the next process adopts the same phones
// rather than ask for a new code; one that does not ends up as Close, which is
// what shipped.
func (s *DeviceShare) Shutdown() {
	if !s.remembers() {
		s.Close()
		return
	}
	s.turn.Lock()
	defer s.turn.Unlock()
	s.stopListeningLocked()
}

func (s *DeviceShare) closeLocked() {
	s.stopListeningLocked()
	s.registry.RevokeAll()
	s.recordState(false, "")
}

func (s *DeviceShare) stopListeningLocked() {
	s.mu.Lock()
	live := s.live
	s.live = nil
	s.mu.Unlock()
	if live != nil {
		live.stop()
		<-live.done
	}
}

// ErrShareChannel is a pairing code asked of a door this share does not have:
// the proxy's, on a machine with no proxy named.
var ErrShareChannel = errors.New("this share has no door by that name")

// Offer mints a pairing code for the open share, pointing at the door a channel
// names. The code is one-shot either way, so a window drawing both channels
// asks for one per channel and the one not on screen is spent unseen.
func (s *DeviceShare) Offer(channel OfferChannel) (ShareOffer, error) {
	s.mu.Lock()
	live := s.live
	s.mu.Unlock()
	if live == nil {
		return ShareOffer{}, ErrShareClosed
	}
	base, ok := live.pairOrigin(channel)
	if !ok {
		return ShareOffer{}, ErrShareChannel
	}
	code, expires := s.registry.Offer()
	link := base + "/#pair=" + code
	svg, err := QRSVG(link)
	if err != nil {
		s.registry.Withdraw()
		return ShareOffer{}, err
	}
	return ShareOffer{Channel: channel, URL: link, QR: svg, Expires: expires}, nil
}

// Revoke unpairs one LAN device or disconnects one authenticated Internet
// controller. Both are host-only actions exposed by the same device list.
func (s *DeviceShare) Revoke(id string) bool {
	if s.registry.Revoke(id) {
		return true
	}
	s.mu.Lock()
	disconnect := s.cloudDisconnect
	s.mu.Unlock()
	return s.cloud.contains(id) && disconnect != nil && disconnect(id) == nil
}

func (s *DeviceShare) setCloudDisconnect(disconnect func(string) error) {
	s.mu.Lock()
	s.cloudDisconnect = disconnect
	s.mu.Unlock()
}

func (s *DeviceShare) setCloudStatus(status func() CloudRemoteStatus) {
	s.mu.Lock()
	s.cloudStatus = status
	s.mu.Unlock()
}

// CloudOffer draws a public, account-gated link for this Studio. The link
// deliberately carries no token: a phone must sign in as the same owner, and
// the platform checks that the target is currently online before connecting.
func (s *DeviceShare) CloudOffer() (CloudShareOffer, error) {
	s.mu.Lock()
	status := s.cloudStatus
	s.mu.Unlock()
	if status == nil {
		return CloudShareOffer{}, errors.New("Internet remote access is not ready")
	}
	current := status()
	if !current.Online || strings.TrimSpace(current.DeviceID) == "" {
		return CloudShareOffer{}, errors.New("this Studio is not online for Internet remote access")
	}
	link := "https://reasonix.io/remote/?device=" + url.QueryEscape(current.DeviceID)
	svg, err := QRSVG(link)
	if err != nil {
		return CloudShareOffer{}, err
	}
	return CloudShareOffer{URL: link, QR: svg}, nil
}

// Status reports what is open, what could be, and who is paired.
func (s *DeviceShare) Status() ShareStatus {
	s.mu.Lock()
	live := s.live
	cloudStatus := s.cloudStatus
	port := s.port
	savedOrigin := s.publicOrigin
	appliedOrigin := ""
	lanOrigin, proxyOrigin := "", ""
	if live != nil {
		// The open door's own reading: the name its gate was built with, which
		// a setting changed since has not reached yet.
		appliedOrigin = live.publicOrigin
		lanOrigin = live.lan.origin
		// The address a phone types through the proxy channel is the proxy's
		// public name, not the loopback socket behind it: the socket is what the
		// proxy dials, never what a phone does.
		if live.hasProxy() {
			proxyOrigin = live.publicOrigin
		}
	}
	s.mu.Unlock()
	st := ShareStatus{Port: port, PublicOrigin: savedOrigin, ProxyOrigin: proxyOrigin, AppliedPublicOrigin: appliedOrigin, Addresses: s.addresses(), Devices: s.registry.Devices(), CloudDevices: s.cloud.views()}
	if cloudStatus != nil {
		st.CloudRemote = cloudStatus()
	}
	if live != nil {
		st.Open, st.Origin = true, lanOrigin
	}
	if exp, ok := s.registry.OfferExpires(); ok {
		st.OfferExpires = &exp
	}
	return st
}

// machineName is what a device is told it is driving: this computer's name,
// or a plain word where the system will not say.
func machineName() string {
	if name, err := os.Hostname(); err == nil && strings.TrimSpace(name) != "" {
		return name
	}
	return "this computer"
}

// OffInternet reports whether plain HTTP to ip stays off the public internet:
// loopback, a private range, or a tailnet, whose traffic is already encrypted.
// Only there may a credential ride an unencrypted link.
func OffInternet(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsLoopback() || ip.IsPrivate() || tailnetPrefix.Contains(ip)
}

// PrivateAddresses is every private IPv4 address on an up interface, the ones
// a phone is likeliest to reach first: the first entry is the default.
//
// Loopback is listed after every reachable address, because a phone cannot dial
// it — but a proxy or a tunnel on this machine hands requests to it, and it is
// the only address that survives this machine changing networks. A door a proxy
// stands in front of opens there instead; see proxyAddress.
func PrivateAddresses() []ShareAddress {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	out := []ShareAddress{}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		if iface.Flags&net.FlagLoopback != 0 {
			// One entry, whatever the loopback interface is called: 127.0.0.1
			// is the name every proxy defaults its upstream to.
			out = append(out, ShareAddress{Interface: iface.Name, IP: "127.0.0.1", Kind: AddressLoopback})
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			pfx, err := netip.ParsePrefix(a.String())
			if err != nil {
				continue
			}
			ip := pfx.Addr().Unmap()
			if !ip.Is4() {
				continue
			}
			kind := AddressVirtual
			switch {
			case tailnetPrefix.Contains(ip):
				kind = AddressTailnet
			case !ip.IsPrivate():
				continue
			case len(iface.HardwareAddr) > 0 && iface.Flags&net.FlagBroadcast != 0:
				kind = AddressLAN
			}
			out = append(out, ShareAddress{Interface: iface.Name, IP: ip.String(), Kind: kind})
		}
	}
	slices.SortStableFunc(out, func(a, b ShareAddress) int { return addressRank[a.Kind] - addressRank[b.Kind] })
	return out
}

// proxyAddress picks the address a share should open on when a reverse proxy
// answers for this machine. Loopback is the answer: the proxy runs here and
// dials the door from here, and unlike the Wi-Fi address it does not change when
// the laptop joins another network — which is the whole reason a proxy is
// configured. When no loopback entry is offered, the usual list stands.
func proxyAddress(list []ShareAddress) (ShareAddress, bool) {
	for _, a := range list {
		if a.Kind == AddressLoopback {
			return a, true
		}
	}
	return ShareAddress{}, false
}

// phoneAddress picks the address a phone on this network can actually dial: the
// first entry that is not loopback. Loopback is where the proxy dials from, and
// no phone reaches it, so a share opened there is a door only this machine's own
// tunnel can use.
func phoneAddress(list []ShareAddress) (ShareAddress, bool) {
	for _, a := range list {
		if a.Kind != AddressLoopback {
			return a, true
		}
	}
	return ShareAddress{}, false
}
