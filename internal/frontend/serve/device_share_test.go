package serve

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"reasonix/internal/base/testenv"
)

func TestPairingCodePairsOnce(t *testing.T) {
	reg := NewDeviceRegistry()
	code, _ := reg.Offer()
	cred, view, err := reg.Redeem(code, "Mozilla/5.0 (iPhone)", OfferLAN)
	if err != nil {
		t.Fatalf("first redeem: %v", err)
	}
	if id, ok := reg.Authenticate(cred, OfferLAN); !ok || id != view.ID {
		t.Fatalf("Authenticate = %q %v, want %q", id, ok, view.ID)
	}
	if _, _, err := reg.Redeem(code, "second", OfferLAN); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("second redeem err = %v, want ErrPairingInvalid", err)
	}
	if _, ok := reg.OfferExpires(); ok {
		t.Fatal("a spent code is still on offer")
	}
}

func TestPairingCodeLapses(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	reg := newDeviceRegistryAt(func() time.Time { return now })
	code, _ := reg.Offer()
	now = now.Add(pairingTTL)
	if _, _, err := reg.Redeem(code, "", OfferLAN); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("redeem at expiry err = %v, want ErrPairingInvalid", err)
	}
}

// The code drawn on screen and the code riding a copied link are two
// credentials. Minting the link's must not retire the symbol's — that is what
// made pressing "copy the link" cancel the picture beside it — and spending
// either leaves the other worth using.
func TestALinkCodeDoesNotRetireTheCodeOnScreen(t *testing.T) {
	reg := NewDeviceRegistry()
	screen, _ := reg.Offer()
	copied, _ := reg.OfferLink()
	if screen == copied {
		t.Fatal("the link was minted with the code already on screen")
	}
	if _, _, err := reg.Redeem(screen, "", OfferLAN); err != nil {
		t.Fatalf("the code on screen: %v", err)
	}
	if _, _, err := reg.Redeem(copied, "", OfferLAN); err != nil {
		t.Fatalf("the copied code, after the symbol's was spent: %v", err)
	}
}

// Whichever of the two is spent first, the other still pairs: the test above
// fixes one order, and a window hands them out in the other one too.
func TestEitherTheScreenOrTheCopiedCodePairsFirst(t *testing.T) {
	reg := NewDeviceRegistry()
	screen, _ := reg.Offer()
	copied, _ := reg.OfferLink()
	if _, _, err := reg.Redeem(copied, "", OfferLAN); err != nil {
		t.Fatalf("the copied code: %v", err)
	}
	if _, _, err := reg.Redeem(screen, "", OfferLAN); err != nil {
		t.Fatalf("the screen's code, after the copied one was spent: %v", err)
	}
}

// A window shows one symbol at a time, so a new one replaces the last: the
// picture that is no longer on screen must not still pair a phone.
func TestANewSymbolRetiresTheOneItReplaced(t *testing.T) {
	reg := NewDeviceRegistry()
	first, _ := reg.Offer()
	second, _ := reg.Offer()
	if _, _, err := reg.Redeem(first, "", OfferLAN); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("the replaced symbol err = %v, want ErrPairingInvalid", err)
	}
	if _, _, err := reg.Redeem(second, "", OfferLAN); err != nil {
		t.Fatalf("the symbol now on screen: %v", err)
	}
}

// One code pairs once even when others are on offer beside it: a spent code is
// not revived by the presence of a live one.
func TestASpentCodeStaysSpentBesideALiveOne(t *testing.T) {
	reg := NewDeviceRegistry()
	spent, _ := reg.Offer()
	if _, _, err := reg.Redeem(spent, "", OfferLAN); err != nil {
		t.Fatalf("first redeem: %v", err)
	}
	// A live code offered afterwards changes nothing about the spent one.
	reg.OfferLink()
	if _, _, err := reg.Redeem(spent, "", OfferLAN); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("re-redeeming a spent code = %v, want ErrPairingInvalid", err)
	}
}

// OfferExpires answers about the symbol on screen alone: a window reads it to
// decide whether the picture is still worth showing, and a link still unspent
// somewhere is not a picture anybody is looking at.
func TestTheSymbolsExpiryIsWhatTheWindowIsTold(t *testing.T) {
	reg := NewDeviceRegistry()
	screen, _ := reg.Offer()
	if _, ok := reg.OfferExpires(); !ok {
		t.Fatal("a symbol just minted is not reported as on offer")
	}
	reg.OfferLink()
	if _, ok := reg.OfferExpires(); !ok {
		t.Fatal("a link beside the symbol hid the symbol")
	}
	if _, _, err := reg.Redeem(screen, "", OfferLAN); err != nil {
		t.Fatalf("the code on screen: %v", err)
	}
	if _, ok := reg.OfferExpires(); ok {
		t.Fatal("a spent symbol is still reported as on offer because a link outlived it")
	}
}

// WithdrawCode spends one code and leaves its neighbours alone: it is what a
// caller that could not draw a symbol undoes.
func TestWithdrawCodeSpendsOnlyThatCode(t *testing.T) {
	reg := NewDeviceRegistry()
	kept, _ := reg.Offer()
	dropped, _ := reg.OfferLink()
	reg.WithdrawCode(dropped)
	if _, _, err := reg.Redeem(dropped, "", OfferLAN); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("withdrawn code err = %v, want ErrPairingInvalid", err)
	}
	if _, _, err := reg.Redeem(kept, "", OfferLAN); err != nil {
		t.Fatalf("code that was not withdrawn: %v", err)
	}
}

// The codes are capped so a process left running cannot pile them up, and the
// ones dropped are the oldest: a link just handed out still works.
func TestOnlyTheOldestCodesAreDroppedAtTheCap(t *testing.T) {
	reg := NewDeviceRegistry()
	first, _ := reg.OfferLink()
	var last string
	for i := 0; i < maxPendingCodes; i++ {
		last, _ = reg.OfferLink()
	}
	if _, _, err := reg.Redeem(first, "", OfferLAN); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("the oldest code err = %v, want ErrPairingInvalid", err)
	}
	if _, _, err := reg.Redeem(last, "", OfferLAN); err != nil {
		t.Fatalf("the newest code: %v", err)
	}
}

func TestShareRefusesAnAddressItDoesNotList(t *testing.T) {
	share := NewDeviceShare(nil)
	share.addresses = func() []ShareAddress { return []ShareAddress{{Interface: "lo", IP: "127.0.0.1", Kind: AddressLAN}} }
	share.Attach(http.NotFoundHandler())
	for _, ip := range []string{"0.0.0.0", "8.8.8.8", ""} {
		if _, err := share.Open(ip); !errors.Is(err, ErrShareAddress) {
			t.Fatalf("Open(%q) err = %v, want ErrShareAddress", ip, err)
		}
	}
}

// rigLAN is the private address a test share binds. The product never offers
// loopback as a phone's door — a proxy on this machine dials it, a phone does
// not — so a rig that opened there would be a topology no machine has, and the
// rules that depend on that distinction would go untested.
const rigLAN = "127.0.0.2"

// shareRig is a window's hub with the share open on a private address, which
// stands in for the adapter address a real share binds.
type shareRig struct {
	hub    *Hub
	share  *DeviceShare
	window *httptest.Server
	origin string
}

func newShareRig(t *testing.T) *shareRig {
	t.Helper()
	return newProxiedShareRig(t, "")
}

// newProxiedShareRig opens the share the way a reverse proxy in front of it
// would find it: the proxy's name is restored before Open, so the gate and the
// pairing link are built with it, exactly as startup does.
func newProxiedShareRig(t *testing.T, public string) *shareRig {
	t.Helper()
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	page := fstest.MapFS{
		"index.html":      {Data: []byte("<title>studio</title>")},
		"assets/app-1.js": {Data: []byte("console.log(1)")},
	}
	share := NewDeviceShare(page)
	share.RestorePublicOrigin(public)
	// 127.0.0.2 stands in for the private address a real share binds: the product
	// never offers loopback as a phone's door, so a rig that did would be a
	// topology no machine has — and it would hide the rules that depend on that.
	share.addresses = func() []ShareAddress {
		return []ShareAddress{{Interface: "en0", IP: rigLAN, Kind: AddressLAN}}
	}
	h := NewHub(HubOptions{Page: page, Share: share, Grant: func(s *Server) { s.AllowProviderEdit() }})
	hubRuntime(t, h, testenv.TempDir(t))
	share.Attach(h.Handler())
	window := httptest.NewServer(operatorHandler(h))
	t.Cleanup(func() {
		window.Close()
		share.Close()
		h.Shutdown()
	})
	st, err := share.Open(rigLAN)
	if err != nil {
		t.Fatalf("open share: %v", err)
	}
	return &shareRig{hub: h, share: share, window: window, origin: st.Origin}
}

// pair scans a fresh code the way the page does and returns the device cookie.
func (r *shareRig) pair(t *testing.T) *http.Cookie {
	t.Helper()
	offer, err := r.share.Offer(OfferLAN)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	code := offer.URL[strings.Index(offer.URL, "#pair=")+len("#pair="):]
	resp := r.device(t, http.MethodPost, PairPath, `{"code":"`+code+`"}`, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("pair = %d", resp.StatusCode)
	}
	for _, c := range resp.Cookies() {
		if c.Name == DeviceCookie {
			if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
				t.Fatalf("device cookie = %+v, want HttpOnly and SameSite=Strict", c)
			}
			return c
		}
	}
	t.Fatal("pairing set no device cookie")
	return nil
}

func (r *shareRig) device(t *testing.T, method, path, body string, cookie *http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, r.origin+path, strings.NewReader(body))
	if method != http.MethodGet {
		req.Header.Set("Origin", r.origin)
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func deviceRefusal(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	var body Reason
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return body.Code
}

func TestAnUnpairedDeviceGetsThePageButNotTheKernel(t *testing.T) {
	rig := newShareRig(t)
	for _, path := range []string{"/", "/assets/app-1.js"} {
		resp := rig.device(t, http.MethodGet, path, "", nil)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s unpaired = %d, want the page", path, resp.StatusCode)
		}
	}
	for _, path := range []string{"/runtimes", "/events", "/history", "/tree"} {
		resp := rig.device(t, http.MethodGet, path, "", nil)
		if code := deviceRefusal(t, resp); resp.StatusCode != http.StatusUnauthorized || code != codeDeviceUnauthorized {
			t.Fatalf("GET %s unpaired = %d %q, want 401 %s", path, resp.StatusCode, code, codeDeviceUnauthorized)
		}
	}
}

func TestAPairedDeviceDrivesTheWindowsPanes(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)
	resp := rig.device(t, http.MethodGet, "/runtimes", "", cookie)
	var views []RuntimeView
	_ = json.NewDecoder(resp.Body).Decode(&views)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || len(views) != 1 {
		t.Fatalf("GET /runtimes paired = %d %+v, want the window's pane", resp.StatusCode, views)
	}
	if devs := rig.share.Status().Devices; len(devs) != 1 {
		t.Fatalf("Status().Devices = %+v, want the one paired device", devs)
	}
}

// A device holds what a networked serve client holds. The window's grants are
// its decision about the person at it, and the share must not carry them over.
func TestAPairedDeviceHoldsNoneOfTheWindowsGrants(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)

	win, err := http.Get(rig.window.URL + "/config/problem")
	if err != nil {
		t.Fatal(err)
	}
	win.Body.Close()
	if win.StatusCode != http.StatusOK {
		t.Fatalf("window GET /config/problem = %d, want the grant to hold", win.StatusCode)
	}
	resp := rig.device(t, http.MethodGet, "/config/problem", "", cookie)
	if code := deviceRefusal(t, resp); resp.StatusCode != http.StatusForbidden || code != "config.editing_disabled" {
		t.Fatalf("device GET /config/problem = %d %q, want the grant withheld", resp.StatusCode, code)
	}
}

func TestAPairedDeviceCannotReachTheWindowsOwnRoutes(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)
	for _, c := range []struct{ method, path string }{
		{http.MethodPost, "/share/offer"},
		{http.MethodPost, "/share/cloud-offer"},
		{http.MethodGet, "/share"},
		{http.MethodGet, "/host/capabilities"},
		{http.MethodPost, "/host/pick-folder"},
		{http.MethodGet, "/host/workspaces/locate?root=%2Ftmp"},
		{http.MethodGet, "/remotes"},
		{http.MethodGet, "/studio/logs"},
	} {
		resp := rig.device(t, c.method, c.path, "{}", cookie)
		if code := deviceRefusal(t, resp); resp.StatusCode != http.StatusNotFound || code != codeDeviceHostOnly {
			t.Fatalf("%s %s from a device = %d %q, want %s", c.method, c.path, resp.StatusCode, code, codeDeviceHostOnly)
		}
	}
	resp := rig.device(t, http.MethodGet, "/provider-setup", "", cookie)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("device GET /provider-setup = %d, want 404", resp.StatusCode)
	}
}

func TestTheDeviceGateAnswersOnlyForItsOwnName(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)

	req, _ := http.NewRequest(http.MethodGet, rig.origin+"/runtimes", nil)
	req.Host = "attacker.example:80"
	req.AddCookie(cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if code := deviceRefusal(t, resp); code != codeDeviceHost {
		t.Fatalf("rebound host = %d %q, want %s", resp.StatusCode, code, codeDeviceHost)
	}

	req, _ = http.NewRequest(http.MethodPost, rig.origin+"/rt/1/cancel", bytes.NewReader([]byte("{}")))
	req.Header.Set("Origin", "http://attacker.example")
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if code := deviceRefusal(t, resp); code != codeDeviceOrigin {
		t.Fatalf("foreign origin = %d %q, want %s", resp.StatusCode, code, codeDeviceOrigin)
	}
}

func TestARevokedDeviceIsRefused(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)
	id := rig.share.Status().Devices[0].ID
	if !rig.share.Revoke(id) {
		t.Fatal("Revoke reported no such device")
	}
	resp := rig.device(t, http.MethodGet, "/runtimes", "", cookie)
	if code := deviceRefusal(t, resp); resp.StatusCode != http.StatusUnauthorized || code != codeDeviceUnauthorized {
		t.Fatalf("revoked device = %d %q, want 401", resp.StatusCode, code)
	}
}

func TestClosingTheShareUnpairsEveryDevice(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)
	rig.share.Close()
	st, err := rig.share.Open(rigLAN)
	if err != nil {
		t.Fatal(err)
	}
	rig.origin = st.Origin
	if len(st.Devices) != 0 {
		t.Fatalf("reopened share lists %+v, want no devices", st.Devices)
	}
	resp := rig.device(t, http.MethodGet, "/runtimes", "", cookie)
	if code := deviceRefusal(t, resp); resp.StatusCode != http.StatusUnauthorized || code != codeDeviceUnauthorized {
		t.Fatalf("device from before the close = %d %q, want 401", resp.StatusCode, code)
	}
}

func TestTheWindowDrivesTheShareOverItsRoutes(t *testing.T) {
	rig := newShareRig(t)
	resp, err := http.Post(rig.window.URL+"/share/offer", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	var offer ShareOffer
	_ = json.NewDecoder(resp.Body).Decode(&offer)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(offer.URL, rig.origin+"/#pair=") || !strings.HasPrefix(offer.QR, "<svg") {
		t.Fatalf("POST /share/offer = %d %+v, want a link on the share's origin and its QR", resp.StatusCode, offer)
	}
	resp, err = http.Post(rig.window.URL+"/share/close", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	resp, err = http.Post(rig.window.URL+"/share/offer", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	if code := deviceRefusal(t, resp); resp.StatusCode != http.StatusConflict || code != codeShareClosed {
		t.Fatalf("offer on a closed share = %d %q, want 409 %s", resp.StatusCode, code, codeShareClosed)
	}
}

func TestCloudOfferUsesOnlyTheAccountGatedDeviceIdentity(t *testing.T) {
	share := NewDeviceShare(nil)
	share.setCloudStatus(func() CloudRemoteStatus {
		return CloudRemoteStatus{DeviceID: "device/with space", Name: "Home Mac", Online: true}
	})
	offer, err := share.CloudOffer()
	if err != nil {
		t.Fatal(err)
	}
	if offer.URL != "https://reasonix.io/remote/?device=device%2Fwith+space" || !strings.HasPrefix(offer.QR, "<svg") {
		t.Fatalf("CloudOffer() = %+v, want the public account-gated route and its QR", offer)
	}
	if strings.Contains(offer.URL, "token") || strings.Contains(offer.URL, "credential") {
		t.Fatalf("CloudOffer() exposed a credential: %s", offer.URL)
	}
}

func TestCloudOfferRequiresAnOnlineStudio(t *testing.T) {
	share := NewDeviceShare(nil)
	share.setCloudStatus(func() CloudRemoteStatus {
		return CloudRemoteStatus{DeviceID: "offline", Online: false}
	})
	if _, err := share.CloudOffer(); err == nil {
		t.Fatal("CloudOffer() succeeded for an offline Studio")
	}
}

func TestTheWindowCanRequestACloudQR(t *testing.T) {
	rig := newShareRig(t)
	rig.hub.SetCloudRemoteStatus(func() CloudRemoteStatus {
		return CloudRemoteStatus{DeviceID: "abc123", Name: "Home Mac", Online: true}
	})
	resp, err := http.Post(rig.window.URL+"/share/cloud-offer", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var offer CloudShareOffer
	_ = json.NewDecoder(resp.Body).Decode(&offer)
	if resp.StatusCode != http.StatusOK || offer.URL != "https://reasonix.io/remote/?device=abc123" {
		t.Fatalf("POST /share/cloud-offer = %d %+v", resp.StatusCode, offer)
	}
}

func TestADeviceKnowsWhichMachineItDrives(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)
	resp := rig.device(t, http.MethodGet, DevicePath, "", cookie)
	var self DeviceSelf
	_ = json.NewDecoder(resp.Body).Decode(&self)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || self.Ordinal != 1 || self.Machine == "" {
		t.Fatalf("GET /device = %d %+v, want device 1 on a named machine", resp.StatusCode, self)
	}
	win, err := http.Get(rig.window.URL + DevicePath)
	if err != nil {
		t.Fatal(err)
	}
	if code := deviceRefusal(t, win); win.StatusCode != http.StatusNotFound || code != codeNotADevice {
		t.Fatalf("window GET /device = %d %q, want 404 %s", win.StatusCode, code, codeNotADevice)
	}
}

func TestADeviceUnpairsItself(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)
	resp := rig.device(t, http.MethodPost, DeviceLeavePath, "{}", cookie)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("POST /device/leave = %d, want 204", resp.StatusCode)
	}
	if devs := rig.share.Status().Devices; len(devs) != 0 {
		t.Fatalf("after leaving the window still lists %+v", devs)
	}
	again := rig.device(t, http.MethodGet, "/runtimes", "", cookie)
	if code := deviceRefusal(t, again); again.StatusCode != http.StatusUnauthorized || code != codeDeviceUnauthorized {
		t.Fatalf("a device that left = %d %q, want 401", again.StatusCode, code)
	}
}

// A credential checked when a stream opened says nothing about whether the
// device is still paired later, so unpairing has to end the stream itself.
func TestUnpairingCutsTheStreamADeviceHoldsOpen(t *testing.T) {
	rig := newShareRig(t)
	cookie := rig.pair(t)
	req, _ := http.NewRequest(http.MethodGet, rig.origin+"/events", nil)
	req.Header.Set("Accept", "text/event-stream")
	req.AddCookie(cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /events = %d", resp.StatusCode)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !rig.share.Status().Devices[0].Online {
		if time.Now().After(deadline) {
			t.Fatal("a device holding /events open is not listed online")
		}
		time.Sleep(10 * time.Millisecond)
	}
	ended := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		close(ended)
	}()
	rig.share.Revoke(rig.share.Status().Devices[0].ID)
	select {
	case <-ended:
	case <-time.After(3 * time.Second):
		t.Fatal("the stream outlived the device's pairing")
	}
}
