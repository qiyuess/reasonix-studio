package serve

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// pageGate builds a gate with a built page behind it and nothing paired, so a
// request can arrive the way a browser's own subresource fetch does: no
// credential, because there is no cookie to carry one.
func pageGate(t *testing.T) http.Handler {
	t.Helper()
	page := fstest.MapFS{
		"index.html":                 {Data: []byte("<!doctype html><title>studio</title>")},
		"fonts/inter-studio-400.ttf": {Data: []byte("font")},
		"manifest.webmanifest":       {Data: []byte("{}")},
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})
	return NewDeviceGate(next, DeviceGateOptions{
		Registry: NewDeviceRegistry(),
		Origin:   "http://192.168.1.5:9000",
		Page:     page,
	})
}

func getGate(gate http.Handler, host, path string, c *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "http://"+host+path, nil)
	req.Host = host
	if c != nil {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	gate.ServeHTTP(rec, req)
	return rec
}

// A font or a manifest is fetched on a request of its own, and that request
// never carries the credential the page around it did. Serving those is a load
// working as designed, so it must not read as a phone that cannot get in.
func TestPageFilesLoadWithoutAWordAboutCredentials(t *testing.T) {
	for _, path := range []string{"/fonts/inter-studio-400.ttf", "/manifest.webmanifest", "/index.html"} {
		gate := pageGate(t)
		logged := captureInfoLog(t)
		rec := getGate(gate, "192.168.1.5:9000", path, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s unpaired = %d, want the page's own file", path, rec.Code)
		}
		if got := logged.String(); strings.Contains(got, "serve/device:") {
			t.Fatalf("GET %s logged a refusal it did not make:\n%s", path, got)
		}
	}
}

// The same silence holds when the browser did send a credential that no longer
// matches: a stale cookie is not a reason to warn about every font as well.
func TestPageFilesLoadQuietlyEvenWithAStaleCredential(t *testing.T) {
	gate := pageGate(t)
	logged := captureInfoLog(t)
	stale := &http.Cookie{Name: DeviceCookie, Value: "spent-by-an-earlier-run"}
	rec := getGate(gate, "192.168.1.5:9000", "/fonts/inter-studio-400.ttf", stale)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET the font with a stale credential = %d, want 200", rec.Code)
	}
	if got := logged.String(); strings.Contains(got, "serve/device:") {
		t.Fatalf("a stale credential on a public file logged a refusal:\n%s", got)
	}
}

// What the warning is actually for: a request that the kernel then refuses.
// Losing it would leave a phone that cannot get in with no trace at all.
func TestAnUnpairedRequestToTheKernelStillWarnsAndRefuses(t *testing.T) {
	gate := pageGate(t)
	logged := captureInfoLog(t)
	rec := getGate(gate, "192.168.1.5:9000", "/runtimes", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /runtimes unpaired = %d, want 401", rec.Code)
	}
	if got := logged.String(); !strings.Contains(got, "serve/device: a request carried no device credential") {
		t.Fatalf("an unpaired request to the kernel must say so, got:\n%s", got)
	}
}
