package serve

import (
	"net/http"
	"strings"
	"testing"
)

// proxyName is the reverse proxy this file puts in front of the share: one
// https name, which is what a real deployment configures.
const proxyName = "https://agent.example.com"

// deviceAt is a request through the door a phone would use, so a case can name
// the proxy's Host and Origin instead of the listener's own.
func (r *shareRig) deviceAt(t *testing.T, method, path, body, host, origin string, cookie *http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, r.origin+path, strings.NewReader(body))
	req.Host = host
	if method != http.MethodGet {
		req.Header.Set("Origin", origin)
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

// pairThroughProxy spends a fresh code the way a phone outside this network does:
// through the proxy's name, which is the only door it can reach.
func (r *shareRig) pairThroughProxy(t *testing.T) *http.Cookie {
	t.Helper()
	offer, err := r.share.Offer(OfferProxy)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	code := offer.URL[strings.Index(offer.URL, "#pair=")+len("#pair="):]
	resp := r.deviceAt(t, http.MethodPost, PairPath, `{"code":"`+code+`"}`, "agent.example.com", proxyName, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("pair through the proxy = %d", resp.StatusCode)
	}
	for _, c := range resp.Cookies() {
		if c.Name == DeviceCookie {
			return c
		}
	}
	t.Fatal("pairing through the proxy set no device cookie")
	return nil
}

// The pairing link has to point where the phone actually reaches this machine. A
// code minted for the private address cannot be spent from outside the network,
// so naming a proxy moves the link and leaves the listener where it is.
func TestThePairingLinkPointsAtTheProxyWhenOneIsNamed(t *testing.T) {
	rig := newProxiedShareRig(t, proxyName)
	offer, err := rig.share.Offer(OfferProxy)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(offer.URL, proxyName+"/#pair=") {
		t.Fatalf("offer URL = %q, want it under the proxy's name", offer.URL)
	}
	if strings.Contains(offer.URL, rig.origin) {
		t.Fatalf("offer URL = %q still names the private listener", offer.URL)
	}
}

// The setting must reach the gate the open door is built with, not only the
// status a panel reads: a phone that pairs through the proxy name drives the
// window, and the credential it gets is marked Secure because the proxy is TLS.
func TestAPhonePairsThroughTheProxyNameAndDrivesTheWindow(t *testing.T) {
	rig := newProxiedShareRig(t, proxyName)
	cookie := rig.pairThroughProxy(t)
	if !cookie.Secure {
		t.Fatal("a credential minted through the TLS proxy was not marked Secure")
	}
	resp := rig.deviceAt(t, http.MethodGet, "/runtimes", "", "agent.example.com", proxyName, cookie)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /runtimes through the proxy = %d, want the window's panes", resp.StatusCode)
	}
	// Naming a proxy adds a door; it does not close the one a phone on the same
	// network already uses.
	resp = rig.device(t, http.MethodGet, "/runtimes", "", cookie)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /runtimes over the LAN = %d, want the LAN door to still work", resp.StatusCode)
	}
}

// A changed setting lands when the door next opens. Until then the open gate
// keeps answering for the name it was built with, and the two values let the
// panel explain the wait instead of guessing from the device count.
func TestAChangedProxyNameWaitsForTheNextOpen(t *testing.T) {
	rig := newShareRig(t)
	if got := rig.share.Status().PublicOrigin; got != "" {
		t.Fatalf("PublicOrigin before any change = %q, want empty", got)
	}
	rig.share.RestorePublicOrigin(proxyName)
	st := rig.share.Status()
	if st.PublicOrigin != proxyName {
		t.Fatalf("saved PublicOrigin = %q, want %q", st.PublicOrigin, proxyName)
	}
	if st.AppliedPublicOrigin != "" {
		t.Fatalf("AppliedPublicOrigin = %q, want the open door's own (none)", st.AppliedPublicOrigin)
	}
	// A phone that paired over the LAN must keep working after the setting
	// changes, because the gate it paired against has not moved yet.
	cookie := rig.pair(t)
	if resp := rig.device(t, http.MethodGet, "/runtimes", "", cookie); resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("GET /runtimes after an unapplied change = %d, want the standing gate", resp.StatusCode)
	}
	if _, err := rig.share.Open(rigLAN); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	rig.origin = rig.share.Status().Origin
	if got := rig.share.Status().AppliedPublicOrigin; got != proxyName {
		t.Fatalf("AppliedPublicOrigin after reopen = %q, want %q", got, proxyName)
	}
}

// A hand-written value that does not parse is a name the gate cannot compare, so
// restoring it reads as no proxy at all: the shut reading of a broken setting.
func TestAnUnreadableProxyNameRestoredAtStartupReadsAsNone(t *testing.T) {
	rig := newShareRig(t)
	rig.share.RestorePublicOrigin("agent.example.com")
	if got := rig.share.Status().PublicOrigin; got != "" {
		t.Fatalf("PublicOrigin from an unparseable value = %q, want empty", got)
	}
	if got := rig.share.Status().AppliedPublicOrigin; got != "" {
		t.Fatalf("AppliedPublicOrigin = %q, want empty", got)
	}
	// And the standing door is unaffected: the LAN still reaches the kernel.
	cookie := rig.pair(t)
	if resp := rig.device(t, http.MethodGet, "/runtimes", "", cookie); resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("GET /runtimes = %d, want the LAN door", resp.StatusCode)
	}
}
