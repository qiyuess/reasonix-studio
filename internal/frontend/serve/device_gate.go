package serve

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
)

const (
	// DeviceCookie carries a paired device's credential.
	DeviceCookie = "reasonix_device"
	// PairPath is where a device trades a pairing code for its credential.
	PairPath = "/pair"
	// DevicePath is where a paired device asks what it is and what it reaches.
	DevicePath = "/device"
	// DeviceLeavePath is where a device unpairs itself.
	DeviceLeavePath = "/device/leave"

	codeDeviceHost         = "device.host_rejected"
	codeDeviceOrigin       = "device.origin_rejected"
	codeDeviceUnauthorized = "device.unauthorized"
	codeDevicePairing      = "device.pairing_invalid"
	codeDeviceMisconfig    = "device.misconfigured"
	codeNotADevice         = "device.not_a_device"

	deviceCookieMaxAge = 30 * 24 * 60 * 60
)

// DeviceGateOptions is the policy of one listener devices reach.
type DeviceGateOptions struct {
	Registry *DeviceRegistry
	// Origin is what this listener answers for, scheme and authority only:
	// http://192.168.1.20:41234. Requests addressed to any other name are
	// refused, which is what stops a rebinding page from borrowing the socket.
	Origin string
	// PublicOrigin is the name a reverse proxy answers for this machine. A
	// phone reaching the door through that proxy is addressed to its name, not
	// to Origin, so the name is admitted; empty means no proxy stands in front.
	PublicOrigin string
	// Page is the built frontend. Its files are public here, because a device
	// that has not paired yet needs the page to pair from.
	Page fs.FS
	// Machine names the computer the device reaches, for the device to show.
	Machine string
}

// deviceDoor is one name this gate answers for: the scheme it is reached by,
// the origin as a phone spells it, and the authority a request carries.
type deviceDoor struct {
	scheme    string
	origin    string
	authority string
	// secure is whether this door is reached over TLS, which is what a
	// credential minted here should be marked with.
	secure bool
	// proxy marks the door a reverse proxy answers for, rather than the name
	// this listener bound. Only a proxy in front rewrites the Host it forwards,
	// so only this door may be named by an Origin while the Host names another.
	proxy bool
}

// deviceDoors is every name this gate answers for. The zero case is the
// listener's own name alone, which is how a share with no proxy behaves.
type deviceDoors []deviceDoor

// match names the door a request was addressed to, by the Host it carries.
// A door is never widened to a name nobody configured: an unmatched Host is
// what a rebinding page sends.
func (ds deviceDoors) match(host string) (deviceDoor, bool) {
	for _, d := range ds {
		if a, ok := deviceAuthority(host, d.scheme); ok && a == d.authority {
			return d, true
		}
	}
	return deviceDoor{}, false
}

// DeviceSelf is a paired device's answer about itself: which of the host's
// devices it is, by the ordinal the host lists it under, and which machine
// it is driving.
type DeviceSelf struct {
	ID      string `json:"id"`
	Ordinal int    `json:"ordinal"`
	Machine string `json:"machine"`
}

// NewDeviceGate guards a kernel reached by paired devices. Every request must
// be addressed to one of the gate's doors — the listener's own Origin, or the
// PublicOrigin a proxy answers for it — and a state change must name that same
// door as its origin. Past the page and PairPath a credential is required, and
// what passes is marked as device reach, so the window's grants stay shut.
func NewDeviceGate(next http.Handler, opts DeviceGateOptions) http.Handler {
	doors, ok := deviceDoorsOf(opts)
	if !ok || opts.Registry == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			refuse(w, http.StatusInternalServerError, codeDeviceMisconfig, "this gate was built without an origin and a registry", nil)
		})
	}
	reg := opts.Registry
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		door, ok := doors.match(r.Host)
		if !ok {
			// A phone that cannot pair leaves nothing in the access log — this listener is not
			// behind it — so a refusal says here which of the three rules fired. Otherwise the
			// only symptom is "it does not work", and the three have nothing in common.
			slog.Warn("serve/device: a request named a host this listener does not answer for",
				"host", r.Host, "path", r.URL.Path, "doors", doors.names())
			refuse(w, http.StatusForbidden, codeDeviceHost, "this listener does not answer for that host", nil)
			return
		}
		origin, ok := deviceOriginDoor(r, door, doors)
		if !ok {
			slog.Warn("serve/device: a request named an origin no door answers for",
				"host", r.Host, "origin", r.Header.Get("Origin"), "method", r.Method,
				"path", r.URL.Path, "door", door.origin)
			refuse(w, http.StatusForbidden, codeDeviceOrigin, "that origin may not reach this listener", nil)
			return
		}
		if r.URL.Path == PairPath {
			pairDevice(w, r, reg, origin.secure, origin.pairChannel())
			return
		}
		credential, carried := "", false
		if c, err := r.Cookie(DeviceCookie); err == nil {
			credential, carried = c.Value, true
			if id, ok := reg.Authenticate(credential, origin.pairChannel()); ok {
				serveDevice(w, r, next, reg, id, opts.Machine, origin.secure)
				return
			}
		}
		if devicePublicPath(r, opts.Page) {
			// A page's own files (fonts, manifest) carry no credential, so public paths pass here
			// before the refusals and the warning log stays about phones that cannot get in. Still
			// device reach: the shell a stranger loads gets no window grants.
			next.ServeHTTP(w, r.WithContext(withDeviceReach(r.Context(), "", 0)))
			return
		}
		if carried {
			// A credential arrived and matched nothing: it was revoked, spent by
			// a restart that does not remember devices, or minted by another
			// process. Never the value itself — that is the credential.
			slog.Warn("serve/device: a presented credential matched no paired device",
				"door", origin.pairChannel(), "path", r.URL.Path, "paired", len(reg.Devices()))
		} else {
			// No credential at all. The phone reached the door but brought
			// nothing to it, which is a cookie the app never sent — a different
			// problem from one the kernel refused.
			slog.Warn("serve/device: a request carried no device credential",
				"door", origin.pairChannel(), "path", r.URL.Path, "host", r.Host)
		}
		refuse(w, http.StatusUnauthorized, codeDeviceUnauthorized, "this device is not paired", nil)
	})
}

// names spells the doors this gate answers for, for a refusal that has to say
// what it would have accepted.
func (ds deviceDoors) names() []string {
	out := make([]string, 0, len(ds))
	for _, d := range ds {
		out = append(out, d.origin)
	}
	return out
}

// deviceDoorsOf reads the names one gate answers for. The listener's own origin
// is required — a gate with no door would refuse everything anyway — and the
// reverse proxy's name is admitted beside it when one was named. A name that
// does not parse is refused rather than ignored: a gate asked to answer for a
// name it cannot read is misconfigured, not unproxied.
func deviceDoorsOf(opts DeviceGateOptions) (deviceDoors, bool) {
	own, ok := deviceOrigin(opts.Origin)
	if !ok {
		return nil, false
	}
	doors := deviceDoors{own}
	if strings.TrimSpace(opts.PublicOrigin) == "" {
		return doors, true
	}
	public, ok := deviceOrigin(opts.PublicOrigin)
	if !ok {
		return nil, false
	}
	public.proxy = true
	return append(doors, public), true
}

// deviceOriginDoor reports the door a state change named. A read may arrive without an
// Origin, but a state change must name a door this machine answers for rather than lean
// on the cookie; the name is compared as the Host was. A proxy's name is accepted even
// when the Host differs, because only a proxy rewrites it; the LAN door is still refused
// from behind that name. The door returns so a TLS proxy's credential can be marked Secure.
func deviceOriginDoor(r *http.Request, door deviceDoor, doors deviceDoors) (deviceDoor, bool) {
	sent := r.Header.Get("Origin")
	if sent == "" {
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			return door, true
		}
		return deviceDoor{}, false
	}
	u, err := url.Parse(sent)
	if err != nil || u.Host == "" {
		return deviceDoor{}, false
	}
	scheme := strings.ToLower(u.Scheme)
	authority, ok := deviceAuthority(u.Host, scheme)
	if !ok {
		return deviceDoor{}, false
	}
	named := scheme + "://" + authority
	if named == door.origin {
		return door, true
	}
	for _, d := range doors {
		if d.proxy && named == d.origin {
			return d, true
		}
	}
	// A proxy terminates TLS and may rewrite the Origin's authority with the Host, keeping
	// the page's scheme. That is admitted only when the authority is the Host's, the scheme
	// only tightens, a proxy exists, and the ports are the same socket — nothing else.
	doorPort, doorPortOK := deviceExplicitPort(door.authority, door.scheme)
	originPort, originPortOK := deviceExplicitPort(authority, scheme)
	if scheme == "https" && !door.secure && authority == door.authority && anyProxyDoor(doors) &&
		doorPortOK && originPortOK && doorPort == originPort {
		// The same door, reached over TLS: it is the proxy that terminated it, so
		// this counts as the proxy's channel however the Host was spelled.
		return deviceDoor{scheme: scheme, origin: named, authority: authority, secure: true, proxy: true}, true
	}
	return deviceDoor{}, false
}

// deviceExplicitPort reads the port a folded authority really dials, spelling
// the scheme's own when the name leaves it off. Two authorities folded by
// different schemes still name the same socket only when this agrees, which is
// what stops http://host:80 and https://host:443 being read as one door.
func deviceExplicitPort(authority, scheme string) (string, bool) {
	if _, port, err := net.SplitHostPort(authority); err == nil && port != "" {
		return port, true
	}
	switch strings.ToLower(scheme) {
	case "http":
		return "80", true
	case "https":
		return "443", true
	}
	return "", false
}

// pairChannel says how a request that arrived through this door reached the
// machine: the address a phone on this network dials, or the proxy in front.
// The proxy's own name and the door a proxy rewrote both count as the proxy.
func (d deviceDoor) pairChannel() OfferChannel {
	if d.proxy {
		return OfferProxy
	}
	return OfferLAN
}

// anyProxyDoor reports whether a proxy answers for this gate. Only then can a
// request arrive over TLS while the listener behind it is plain HTTP.
func anyProxyDoor(doors deviceDoors) bool {
	for _, d := range doors {
		if d.proxy {
			return true
		}
	}
	return false
}

// serveDevice answers a paired device: its own two routes here, everything
// else through next under device reach. An event stream runs under a context
// unpairing cancels, so a device dropped mid-stream stops receiving at once.
func serveDevice(w http.ResponseWriter, r *http.Request, next http.Handler, reg *DeviceRegistry, id, machine string, secure bool) {
	switch {
	case r.URL.Path == DevicePath && r.Method == http.MethodGet:
		w.Header().Set("Cache-Control", "no-store")
		_, ordinal, _ := reg.Self(id)
		writeJSON(w, DeviceSelf{ID: id, Ordinal: ordinal, Machine: machine})
		return
	case r.URL.Path == DeviceLeavePath && r.Method == http.MethodPost:
		reg.Revoke(id)
		// codeql[go/cookie-secure-not-set] Secure follows the origin's scheme; a LAN listener is plain HTTP.
		http.SetCookie(w, &http.Cookie{Name: DeviceCookie, Value: "", Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode, MaxAge: -1})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if hostOnlyRoute(r.Method, r.URL.Path) {
		refuse(w, http.StatusNotFound, codeDeviceHostOnly, "a paired device cannot use this", nil)
		return
	}
	_, ordinal, _ := reg.Self(id)
	ctx := withDeviceReach(r.Context(), id, ordinal)
	if r.Method == http.MethodGet && strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		var release func()
		ctx, release = reg.holdStream(ctx, id)
		defer release()
	}
	next.ServeHTTP(w, r.WithContext(ctx))
}

// notADevice answers the device routes for whoever reached the kernel through
// the host's own boundary: the window, or a browser on a networked serve. A
// page reads the 404 as "this is not a paired device".
func notADevice(w http.ResponseWriter, _ *http.Request) {
	refuse(w, http.StatusNotFound, codeNotADevice, "this client is not a paired device", nil)
}

// devicePublicPath is what an unpaired device may load: the page's own files
// and the shell entry points it routes itself. Nothing that answers from the
// kernel's state.
func devicePublicPath(r *http.Request, page fs.FS) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if tokenBootstrapPublicPath(r) {
		return true
	}
	if page == nil {
		return false
	}
	name := strings.Trim(r.URL.Path, "/")
	if name == "" || !fs.ValidPath(name) {
		return false
	}
	st, err := fs.Stat(page, name)
	return err == nil && !st.IsDir()
}

// pairDevice spends a pairing code. The code rides a JSON body rather than the
// URL, so it never reaches a request line, a log or a referrer. The door it
// arrived through is kept with the device so a window can say how that phone
// reaches this machine.
func pairDevice(w http.ResponseWriter, r *http.Request, reg *DeviceRegistry, secure bool, door OfferChannel) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		refuse(w, http.StatusMethodNotAllowed, "request.method_not_allowed", "that method is not accepted here", nil)
		return
	}
	if !jsonContentType(r) {
		refuse(w, http.StatusUnsupportedMediaType, "request.bad_content_type", "the body must be application/json", nil)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var body struct {
		Code string `json:"code"`
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&body); err != nil {
		badBody(w)
		return
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		badBody(w)
		return
	}
	credential, view, err := reg.Redeem(body.Code, r.UserAgent(), door)
	if err != nil {
		refuse(w, http.StatusForbidden, codeDevicePairing, "that pairing code is not valid; show a new one and scan again", nil)
		return
	}
	// codeql[go/cookie-secure-not-set] Secure follows the origin's scheme; a LAN listener is plain HTTP.
	http.SetCookie(w, &http.Cookie{
		Name:     DeviceCookie,
		Value:    credential,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   deviceCookieMaxAge,
	})
	writeJSON(w, view)
}

func jsonContentType(r *http.Request) bool {
	ct := r.Header.Get("Content-Type")
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	return strings.EqualFold(strings.TrimSpace(ct), "application/json")
}

// deviceOrigin reads an origin a device gate may answer for: http or https,
// an authority, and nothing after it. The port may be left off — a reverse
// proxy answers on 443 or 80 and its name rarely spells it — and is folded
// away when it only repeats the scheme's own, so one door has one spelling.
func deviceOrigin(raw string) (deviceDoor, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return deviceDoor{}, false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil {
		return deviceDoor{}, false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return deviceDoor{}, false
	}
	authority, ok := deviceAuthority(u.Host, scheme)
	if !ok {
		return deviceDoor{}, false
	}
	return deviceDoor{scheme: scheme, origin: scheme + "://" + authority, authority: authority, secure: scheme == "https"}, true
}

// deviceAuthority is how one name is compared: lower case, no port when the
// port is the scheme's own, and the port kept when it is not. Applying it to
// both the configured door and the request's Host is what makes
// https://agent.example.com and https://agent.example.com:443 the same door,
// and 192.168.1.20:41234 a different one from 192.168.1.20:41235.
func deviceAuthority(host, scheme string) (string, bool) {
	scheme = strings.ToLower(scheme)
	ownPort := "80"
	if scheme == "https" {
		ownPort = "443"
	} else if scheme != "http" {
		return "", false
	}
	if host == "" {
		return "", false
	}
	u, err := url.Parse("//" + host)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	name := strings.ToLower(u.Hostname())
	if name == "" {
		return "", false
	}
	port := u.Port()
	if port == "" || port == ownPort {
		if strings.Contains(name, ":") {
			// An IPv6 literal keeps its brackets once the port is gone.
			return "[" + name + "]", true
		}
		return name, true
	}
	return net.JoinHostPort(name, port), true
}
