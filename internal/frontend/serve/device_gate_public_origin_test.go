package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// publicGate builds a gate that answers for a LAN listener and a proxy name,
// with one phone already paired, so every case below is about which door a
// request came through rather than about pairing.
func publicGate(t *testing.T, public string) (http.Handler, *http.Cookie, *int) {
	t.Helper()
	reg := NewDeviceRegistry()
	code, _ := reg.Offer()
	cred, _, err := reg.Redeem(code, "phone")
	if err != nil {
		t.Fatal(err)
	}
	reached := 0
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { reached++ })
	gate := NewDeviceGate(next, DeviceGateOptions{
		Registry:     reg,
		Origin:       "http://192.168.1.5:9000",
		PublicOrigin: public,
	})
	return gate, &http.Cookie{Name: DeviceCookie, Value: cred}, &reached
}

func callGate(gate http.Handler, host, origin, path string, c *http.Cookie) (int, Reason) {
	req := httptest.NewRequest(http.MethodPost, "http://"+host+path, strings.NewReader(`{}`))
	req.Host = host
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if c != nil {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	gate.ServeHTTP(rec, req)
	var reason Reason
	_ = json.NewDecoder(rec.Body).Decode(&reason)
	return rec.Code, reason
}

func TestTheProxyNameIsAdmittedBesideTheListenersOwn(t *testing.T) {
	gate, cookie, reached := publicGate(t, "https://agent.example.com")
	code, reason := callGate(gate, "agent.example.com", "https://agent.example.com", "/sessions", cookie)
	if code != http.StatusOK || *reached != 1 {
		t.Fatalf("through the proxy = %d %s, reached %d, want 200", code, reason.Code, *reached)
	}
	// The LAN door keeps working: naming a proxy adds a door, it does not move one.
	code, reason = callGate(gate, "192.168.1.5:9000", "http://192.168.1.5:9000", "/sessions", cookie)
	if code != http.StatusOK || *reached != 2 {
		t.Fatalf("through the LAN = %d %s, reached %d, want 200", code, reason.Code, *reached)
	}
}

// A browser may spell the proxy's default port or leave it out; both name the
// same door, and the gate must agree with the browser about which door that is.
func TestTheProxyDoorIsTheSameWithOrWithoutItsDefaultPort(t *testing.T) {
	gate, cookie, _ := publicGate(t, "https://agent.example.com")
	for _, c := range []struct{ host, origin string }{
		{"agent.example.com", "https://agent.example.com"},
		{"agent.example.com:443", "https://agent.example.com:443"},
		{"agent.example.com", "https://agent.example.com:443"},
		{"agent.example.com:443", "https://agent.example.com"},
		{"AGENT.Example.COM", "https://agent.example.com"},
	} {
		code, reason := callGate(gate, c.host, c.origin, "/sessions", cookie)
		if code != http.StatusOK {
			t.Fatalf("Host %q Origin %q = %d %s, want 200", c.host, c.origin, code, reason.Code)
		}
	}
}

func TestTheProxyNameDoesNotWidenTheGate(t *testing.T) {
	gate, cookie, reached := publicGate(t, "https://agent.example.com")
	for _, c := range []struct{ name, host, origin, want string }{
		{"another name", "evil.example.com", "https://evil.example.com", codeDeviceHost},
		{"the proxy's name, another origin", "agent.example.com", "https://evil.example.com", codeDeviceOrigin},
		{"the proxy's name, the LAN origin", "agent.example.com", "http://192.168.1.5:9000", codeDeviceOrigin},
		{"another port on the proxy", "agent.example.com:8443", "https://agent.example.com:8443", codeDeviceHost},
		{"the proxy's name over plain http", "agent.example.com", "http://agent.example.com", codeDeviceOrigin},
	} {
		code, reason := callGate(gate, c.host, c.origin, "/sessions", cookie)
		if code != http.StatusForbidden || reason.Code != c.want {
			t.Fatalf("%s: %d %s, want 403 %s", c.name, code, reason.Code, c.want)
		}
	}
	if *reached != 0 {
		t.Fatalf("a refused request reached the kernel %d times", *reached)
	}
}

// The proxy answers over TLS, so a credential minted through it is marked Secure
// even though the listener behind it is plain HTTP.
func TestACredentialMintedThroughTheProxyIsSecure(t *testing.T) {
	for _, c := range []struct {
		name, public, host, origin string
		wantSecure                 bool
	}{
		{"through the proxy", "https://agent.example.com", "agent.example.com", "https://agent.example.com", true},
		{"through the LAN", "https://agent.example.com", "192.168.1.5:9000", "http://192.168.1.5:9000", false},
	} {
		reg := NewDeviceRegistry()
		code, _ := reg.Offer()
		gate := NewDeviceGate(http.NotFoundHandler(), DeviceGateOptions{
			Registry:     reg,
			Origin:       "http://192.168.1.5:9000",
			PublicOrigin: c.public,
		})
		req := httptest.NewRequest(http.MethodPost, "http://"+c.host+PairPath, strings.NewReader(`{"code":"`+code+`"}`))
		req.Host = c.host
		req.Header.Set("Origin", c.origin)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		gate.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: pair = %d", c.name, rec.Code)
		}
		var secure *bool
		for _, ck := range rec.Result().Cookies() {
			if ck.Name == DeviceCookie {
				v := ck.Secure
				secure = &v
			}
		}
		if secure == nil || *secure != c.wantSecure {
			t.Fatalf("%s: cookie secure = %v, want %v", c.name, secure, c.wantSecure)
		}
	}
}

// A proxy name that does not parse is a misconfigured gate, not an unproxied
// one: refusing everything is the safe reading of a name that cannot be compared.
func TestAnUnreadableProxyNameRefusesTheWholeGate(t *testing.T) {
	reg := NewDeviceRegistry()
	gate := NewDeviceGate(http.NotFoundHandler(), DeviceGateOptions{
		Registry:     reg,
		Origin:       "http://192.168.1.5:9000",
		PublicOrigin: "agent.example.com",
	})
	code, reason := callGate(gate, "192.168.1.5:9000", "http://192.168.1.5:9000", "/sessions", nil)
	if code != http.StatusInternalServerError || reason.Code != codeDeviceMisconfig {
		t.Fatalf("with an unreadable proxy name = %d %s, want 500 %s", code, reason.Code, codeDeviceMisconfig)
	}
}

// With no proxy named the gate behaves as it always did: the listener's own door
// and nothing else.
func TestNoProxyNameMeansOnlyTheListenersOwnDoor(t *testing.T) {
	gate, cookie, _ := publicGate(t, "")
	if code, reason := callGate(gate, "192.168.1.5:9000", "http://192.168.1.5:9000", "/sessions", cookie); code != http.StatusOK {
		t.Fatalf("the LAN door = %d %s", code, reason.Code)
	}
	if code, reason := callGate(gate, "agent.example.com", "https://agent.example.com", "/sessions", cookie); code != http.StatusForbidden || reason.Code != codeDeviceHost {
		t.Fatalf("a name nobody configured = %d %s, want 403 %s", code, reason.Code, codeDeviceHost)
	}
}

// A tunnel in front of this machine forwards under the address it dials, not
// under the name the phone typed: the Host arrives as 127.0.0.1:10086 while the
// page the phone loaded still knows itself by the proxy's name. Demanding the two
// name the same door refused every state change a phone made through such a
// tunnel — pairing included — so the proxy's name is admitted beside whichever
// door the Host matched.
func TestTheProxyNameIsAdmittedWhenTheHostWasRewritten(t *testing.T) {
	gate, cookie, reached := publicGate(t, "https://agent.example.com")
	// The listener's own door, reached through a tunnel that rewrote the Host.
	want := []struct{ name, host string }{
		{"the listener's own address", "192.168.1.5:9000"},
		{"loopback, as a tunnel dials it", "127.0.0.1:10086"},
	}
	for _, c := range want {
		// The second case needs a door for that address; add it as the listener.
		g, ck, r := gate, cookie, reached
		if c.host == "127.0.0.1:10086" {
			reg := NewDeviceRegistry()
			code, _ := reg.Offer()
			cred, _, err := reg.Redeem(code, "phone")
			if err != nil {
				t.Fatal(err)
			}
			n := 0
			g = NewDeviceGate(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { n++ }), DeviceGateOptions{
				Registry:     reg,
				Origin:       "http://127.0.0.1:10086",
				PublicOrigin: "https://agent.example.com",
			})
			ck, r = &http.Cookie{Name: DeviceCookie, Value: cred}, &n
		}
		code, reason := callGate(g, c.host, "https://agent.example.com", "/sessions", ck)
		if code != http.StatusOK || *r != 1 {
			t.Fatalf("%s: %d %s, reached %d, want 200", c.name, code, reason.Code, *r)
		}
	}
}

// Some proxies rewrite the authority an Origin names as well as the Host: both
// become the address the proxy dials, while the scheme the page was served with
// is kept. A phone on https://agent.example.com then arrives addressed to the
// LAN door and naming https://192.168.1.5:9000 — the door the Host matched,
// tightened to TLS. Refusing that refused every state change a phone made
// through such a proxy, pairing included.
func TestTheProxyNameIsAdmittedWhenTheOriginWasRewrittenToo(t *testing.T) {
	gate, cookie, reached := publicGate(t, "https://agent.example.com")
	code, reason := callGate(gate, "192.168.1.5:9000", "https://192.168.1.5:9000", "/sessions", cookie)
	if code != http.StatusOK || *reached != 1 {
		t.Fatalf("through the rewriting proxy = %d %s, reached %d, want 200", code, reason.Code, *reached)
	}
}

// Tightening an origin to TLS is only readable when a proxy is in front to have
// terminated it. Without one, https:// to a plain listener is a page from
// somewhere else, and it stays refused.
func TestATightenedOriginNeedsAProxyInFront(t *testing.T) {
	gate, cookie, reached := publicGate(t, "")
	code, reason := callGate(gate, "192.168.1.5:9000", "https://192.168.1.5:9000", "/sessions", cookie)
	if code != http.StatusForbidden || reason.Code != codeDeviceOrigin {
		t.Fatalf("a tightened origin with no proxy = %d %s, want 403 %s", code, reason.Code, codeDeviceOrigin)
	}
	if *reached != 0 {
		t.Fatalf("a refused request reached the kernel %d times", *reached)
	}
}

// Tightening keeps the authority the Host matched: it is not a licence to name
// some other host over TLS.
func TestATightenedOriginCannotNameAnotherHost(t *testing.T) {
	gate, cookie, reached := publicGate(t, "https://agent.example.com")
	code, reason := callGate(gate, "192.168.1.5:9000", "https://evil.example.com", "/sessions", cookie)
	if code != http.StatusForbidden || reason.Code != codeDeviceOrigin {
		t.Fatalf("another host over TLS = %d %s, want 403 %s", code, reason.Code, codeDeviceOrigin)
	}
	if *reached != 0 {
		t.Fatalf("a refused request reached the kernel %d times", *reached)
	}
}
