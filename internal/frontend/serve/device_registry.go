package serve

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	// pairingTTL bounds how long a displayed code is worth anything: long
	// enough to find a phone, short enough that a photo of the screen is stale.
	pairingTTL = 5 * time.Minute
	// maxPendingCodes caps how many unspent codes one registry keeps. A window
	// mints one per card opening and per channel switch, so a long-running
	// process would otherwise pile them up; the oldest go first.
	maxPendingCodes = 8
	// deviceNameMax caps the label a device is listed under.
	deviceNameMax = 80
)

// ErrPairingInvalid is every way a code can fail to pair: unknown, used,
// expired or superseded. The caller learns nothing about which.
var ErrPairingInvalid = errors.New("pairing code is not valid")

// DeviceRegistry holds which devices may reach a kernel and the pairing codes
// that can add another. Only digests are kept: a registry dumped from memory
// hands out no credential. A host that gives it a persist hook survives a
// restart with its devices paired; without one it lives for the process.
type DeviceRegistry struct {
	mu  sync.Mutex
	now func() time.Time
	// pending is every code worth something, oldest first. A window may hold more than one
	// — the QR symbol and the link copied beside it are separate one-shot credentials — and
	// each is spent on its own.
	pending []pairingOffer
	devices map[string]*pairedDevice
	// rev counts every change to the paired set. A snapshot taken before a
	// later change carries a stale rev and is dropped before it is written,
	// so a Revoke cannot be overwritten by an older Redeem's write.
	rev uint64
	// persistMu serializes the writes that survive the rev check.
	persistMu sync.Mutex
	// persist writes the paired set after a change. Called outside the lock, and
	// nil for a registry that is only ever in memory.
	persist func([]persistedDevice)
}

// pairingOffer is one code a device can pair with. A zero digest is no offer.
type pairingOffer struct {
	digest  [sha256.Size]byte
	expires time.Time
	// screen marks the code drawn as a symbol. There is at most one, because a window shows
	// one picture at a time; codes without it are handed out beside the picture and live and
	// die on their own.
	screen bool
}

type pairedDevice struct {
	id     string
	name   string
	digest [sha256.Size]byte
	paired time.Time
	seen   time.Time
	// door is the door this device last reached the share through: the LAN address or the
	// proxy's name. Recorded at pairing and refreshed on every authenticated request, so a
	// phone that changes how it reaches the machine says so.
	door OfferChannel
	// streams are the event streams this device holds open. Each can be cut,
	// because a credential checked when a stream opened says nothing about
	// whether the device is still paired an hour into it.
	streams map[*deviceStream]struct{}
}

type deviceStream struct{ cancel context.CancelFunc }

// DeviceView is a paired device as the host lists it.
type DeviceView struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	PairedAt time.Time `json:"pairedAt"`
	LastSeen time.Time `json:"lastSeen"`
	// Online is whether the device holds an event stream open right now: a
	// page on screen, not a page that was last opened some time ago.
	Online bool `json:"online"`
	// Door is how this device last reached the share: the address a phone on this
	// network dials, or the proxy's name. A window says which, because "the same
	// Wi-Fi" was a guess the host never checked.
	Door OfferChannel `json:"door"`
}

// NewDeviceRegistry returns an empty registry with no code on offer.
func NewDeviceRegistry() *DeviceRegistry {
	return newDeviceRegistryAt(time.Now)
}

func newDeviceRegistryAt(now func() time.Time) *DeviceRegistry {
	return &DeviceRegistry{now: now, devices: map[string]*pairedDevice{}}
}

// Offer mints the code the window draws as a symbol, replacing the one drawn
// before it: a window shows one picture at a time. The codes it handed out
// beside that picture — a link for someone who cannot scan — are left alone, so
// copying one never cancels the symbol still on screen.
func (d *DeviceRegistry) Offer() (code string, expires time.Time) {
	return d.mint(true)
}

// OfferLink mints a code to ride a link the window hands out beside its symbol.
// It lives on its own: it does not replace the code on screen, and spending it
// leaves that one worth scanning.
func (d *DeviceRegistry) OfferLink() (code string, expires time.Time) {
	return d.mint(false)
}

func (d *DeviceRegistry) mint(screen bool) (code string, expires time.Time) {
	code = randomSecret()
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	d.pruneLocked(now)
	if screen {
		d.pending = slices.DeleteFunc(d.pending, func(o pairingOffer) bool { return o.screen })
	}
	expires = now.Add(pairingTTL)
	d.pending = append(d.pending, pairingOffer{digest: sha256.Sum256([]byte(code)), expires: expires, screen: screen})
	// Oldest go first past what a window could show: a long-running process mints one per
	// card opening, and none outlives pairingTTL. The symbol just minted is newest, so the
	// cap never takes it.
	if over := len(d.pending) - maxPendingCodes; over > 0 {
		d.pending = append([]pairingOffer(nil), d.pending[over:]...)
	}
	return code, expires
}

// WithdrawCode takes one code off offer, leaving the rest alone. It is what a
// caller that failed to draw a symbol undoes: the code it just minted and could
// not hand out is spent, and the codes already on screen stay live.
func (d *DeviceRegistry) WithdrawCode(code string) {
	sum := sha256.Sum256([]byte(code))
	d.mu.Lock()
	d.dropDigestLocked(sum)
	d.mu.Unlock()
}

// OfferExpires reports when the code drawn on screen lapses, if one is. Only
// that code counts: a link handed out beside it lives longer or shorter on its
// own, and a window asking whether to keep showing a symbol must not be told
// "yes" because some link nobody is looking at is still unspent.
func (d *DeviceRegistry) OfferExpires() (time.Time, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	d.pruneLocked(now)
	for i := len(d.pending) - 1; i >= 0; i-- {
		if d.pending[i].screen {
			return d.pending[i].expires, true
		}
	}
	return time.Time{}, false
}

// pruneLocked drops the codes whose time is up. A lapsed code is indistinguishable
// from one never minted, which is what ErrPairingInvalid already says.
func (d *DeviceRegistry) pruneLocked(now time.Time) {
	if len(d.pending) == 0 {
		return
	}
	live := d.pending[:0]
	for _, offer := range d.pending {
		if now.Before(offer.expires) {
			live = append(live, offer)
		}
	}
	d.pending = live
}

// dropDigestLocked removes one code by its digest, if it is there at all.
func (d *DeviceRegistry) dropDigestLocked(sum [sha256.Size]byte) {
	for i, offer := range d.pending {
		if subtle.ConstantTimeCompare(sum[:], offer.digest[:]) == 1 {
			d.pending = append(d.pending[:i:i], d.pending[i+1:]...)
			return
		}
	}
}

// holdsLocked reports whether one of the live codes hashes to sum.
func (d *DeviceRegistry) holdsLocked(sum [sha256.Size]byte) bool {
	for _, offer := range d.pending {
		if subtle.ConstantTimeCompare(sum[:], offer.digest[:]) == 1 {
			return true
		}
	}
	return false
}

// Redeem spends one code for a device credential. A code pairs once: whoever presents
// it first is the device, and that code is gone. Codes offered beside it are untouched —
// a QR symbol and a copied link carry different codes, and spending one leaves the other
// worth scanning. The door the request arrived through is kept with the device, so a
// window can say how that phone reaches this machine instead of guessing.
func (d *DeviceRegistry) Redeem(code, name string, door OfferChannel) (credential string, view DeviceView, err error) {
	sum := sha256.Sum256([]byte(code))
	d.mu.Lock()
	now := d.now()
	d.pruneLocked(now)
	if code == "" || !d.holdsLocked(sum) {
		d.mu.Unlock()
		return "", DeviceView{}, ErrPairingInvalid
	}
	d.dropDigestLocked(sum)
	credential = randomSecret()
	dev := &pairedDevice{
		id:      deviceID(),
		name:    deviceLabel(name),
		digest:  sha256.Sum256([]byte(credential)),
		paired:  now,
		seen:    now,
		door:    door,
		streams: map[*deviceStream]struct{}{},
	}
	d.devices[dev.id] = dev
	d.rev++
	saved := d.snapshotLocked()
	rev := d.rev
	d.mu.Unlock()
	d.flush(saved, rev)
	return credential, dev.view(), nil
}

// Authenticate names the device a credential belongs to, and records that it
// was seen and which door it came through. The door is refreshed here rather
// than fixed at pairing: a phone that paired over Wi-Fi and later reaches this
// machine through the proxy is on the proxy now, and saying otherwise would put
// a claim on screen that nothing keeps true.
func (d *DeviceRegistry) Authenticate(credential string, door OfferChannel) (string, bool) {
	if credential == "" {
		return "", false
	}
	sum := sha256.Sum256([]byte(credential))
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, dev := range d.devices {
		if subtle.ConstantTimeCompare(sum[:], dev.digest[:]) == 1 {
			dev.seen = d.now()
			if door != "" {
				dev.door = door
			}
			return dev.id, true
		}
	}
	return "", false
}

// Devices lists what is paired, earliest first.
func (d *DeviceRegistry) Devices() []DeviceView {
	d.mu.Lock()
	out := make([]DeviceView, 0, len(d.devices))
	for _, dev := range d.devices {
		out = append(out, dev.view())
	}
	d.mu.Unlock()
	slices.SortFunc(out, func(a, b DeviceView) int {
		if c := a.PairedAt.Compare(b.PairedAt); c != 0 {
			return c
		}
		return strings.Compare(a.ID, b.ID)
	})
	return out
}

// Revoke unpairs one device. Its next request is refused and every stream it
// holds open is cut now.
func (d *DeviceRegistry) Revoke(id string) bool {
	d.mu.Lock()
	dev, ok := d.devices[id]
	if !ok {
		d.mu.Unlock()
		return false
	}
	delete(d.devices, id)
	d.rev++
	saved := d.snapshotLocked()
	rev := d.rev
	dev.cut()
	d.mu.Unlock()
	d.flush(saved, rev)
	return true
}

// RevokeAll unpairs every device, cuts their streams and withdraws every code
// on offer.
func (d *DeviceRegistry) RevokeAll() {
	d.mu.Lock()
	for _, dev := range d.devices {
		dev.cut()
	}
	d.devices = map[string]*pairedDevice{}
	d.pending = nil
	d.rev++
	rev := d.rev
	d.mu.Unlock()
	d.flush(nil, rev)
}

// holdStream registers a stream the device opened and derives the context it
// runs under, which unpairing the device cancels. The returned func ends the
// hold; a device already unpaired gets a context that is done.
func (d *DeviceRegistry) holdStream(ctx context.Context, id string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(ctx)
	d.mu.Lock()
	defer d.mu.Unlock()
	dev, ok := d.devices[id]
	if !ok {
		cancel()
		return ctx, func() {}
	}
	s := &deviceStream{cancel: cancel}
	dev.streams[s] = struct{}{}
	return ctx, func() {
		d.mu.Lock()
		delete(dev.streams, s)
		d.mu.Unlock()
		cancel()
	}
}

// Self is the device as it sees itself: its view and its place in the list
// the host draws, so both name it the same.
func (d *DeviceRegistry) Self(id string) (DeviceView, int, bool) {
	for i, v := range d.Devices() {
		if v.ID == id {
			return v, i + 1, true
		}
	}
	return DeviceView{}, 0, false
}

func (p *pairedDevice) cut() {
	for s := range p.streams {
		s.cancel()
	}
}

func (p *pairedDevice) view() DeviceView {
	// A device saved before the door was recorded reads as the local one: those phones
	// paired over Wi-Fi, the only door a share had then. It corrects itself on that phone's
	// next request, which records the door it actually came through.
	door := p.door
	if door == "" {
		door = OfferLAN
	}
	return DeviceView{ID: p.id, Name: p.name, PairedAt: p.paired, LastSeen: p.seen, Online: len(p.streams) > 0, Door: door}
}

// deviceLabel is display text only; nothing decides on it.
func deviceLabel(name string) string {
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > deviceNameMax {
		name = string(r[:deviceNameMax])
	}
	return name
}

func randomSecret() string {
	b := make([]byte, tokenByteLen)
	if _, err := rand.Read(b); err != nil {
		panic("serve/device: crypto/rand.Read failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func deviceID() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		panic("serve/device: crypto/rand.Read failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}
