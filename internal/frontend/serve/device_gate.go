package serve

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
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
			refuse(w, http.StatusForbidden, codeDeviceHost, "this listener does not answer for that host", nil)
			return
		}
		if !deviceOriginAllowed(r, door.origin) {
			refuse(w, http.StatusForbidden, codeDeviceOrigin, "that origin may not reach this listener", nil)
			return
		}
		if r.URL.Path == PairPath {
			pairDevice(w, r, reg, door.secure)
			return
		}
		if c, err := r.Cookie(DeviceCookie); err == nil {
			if id, ok := reg.Authenticate(c.Value); ok {
				serveDevice(w, r, next, reg, id, opts.Machine, door.secure)
				return
			}
		}
		if devicePublicPath(r, opts.Page) {
			// Still device reach: the shell a stranger loads must not come back
			// holding anything the window's grants would add to it.
			next.ServeHTTP(w, r.WithContext(withDeviceReach(r.Context(), "", 0)))
			return
		}
		refuse(w, http.StatusUnauthorized, codeDeviceUnauthorized, "this device is not paired", nil)
	})
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
	return append(doors, public), true
}

// deviceOriginAllowed splits the rule by what the request can do. A read may
// arrive without an origin — a top-level navigation sends none — but anything
// that changes state must name this door rather than lean on the cookie. The
// name is compared the same way the Host was, so a browser that omits the
// default port and one that spells it both name the door they came through.
func deviceOriginAllowed(r *http.Request, want string) bool {
	sent := r.Header.Get("Origin")
	if sent == "" {
		return r.Method == http.MethodGet || r.Method == http.MethodHead
	}
	u, err := url.Parse(sent)
	if err != nil || u.Host == "" {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	authority, ok := deviceAuthority(u.Host, scheme)
	if !ok {
		return false
	}
	return scheme+"://"+authority == want
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
// URL, so it never reaches a request line, a log or a referrer.
func pairDevice(w http.ResponseWriter, r *http.Request, reg *DeviceRegistry, secure bool) {
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
	credential, view, err := reg.Redeem(body.Code, r.UserAgent())
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
