package config

import (
	"errors"
	"testing"
)

// The proxy's name is compared, not stored: every spelling of one door folds to
// the one the gate will see in a Host header.
func TestNormalizePublicOriginKeepsOneSpellingPerDoor(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"   ", ""},
		{"https://agent.example.com", "https://agent.example.com"},
		{"https://agent.example.com/", "https://agent.example.com"},
		{"https://Agent.Example.COM", "https://agent.example.com"},
		{"https://agent.example.com:443", "https://agent.example.com"},
		{"http://agent.example.com:80", "http://agent.example.com"},
		{"https://agent.example.com:8443", "https://agent.example.com:8443"},
		{"http://192.168.1.20:41234", "http://192.168.1.20:41234"},
		{"  https://agent.example.com  ", "https://agent.example.com"},
	}
	for _, c := range cases {
		got, err := NormalizePublicOrigin(c.in)
		if err != nil || got != c.want {
			t.Fatalf("NormalizePublicOrigin(%q) = %q, %v, want %q", c.in, got, err, c.want)
		}
	}
}

func TestNormalizePublicOriginRefusesWhatIsNotOneOrigin(t *testing.T) {
	for _, bad := range []string{
		"agent.example.com",                 // no scheme
		"https://",                          // no name
		"https://agent.example.com/api",     // a path is not a door
		"https://agent.example.com?x=1",     // nor is a query
		"ftp://agent.example.com",           // not reachable by a phone
		"https://someone@agent.example.com", // a name is not a place to put a user
	} {
		if _, err := NormalizePublicOrigin(bad); !errors.Is(err, ErrPublicOriginInvalid) {
			t.Fatalf("NormalizePublicOrigin(%q) = %v, want ErrPublicOriginInvalid", bad, err)
		}
	}
}

// A hand-written value the gate cannot read must not become a door: the accessor
// reads it as "no proxy", which is the shut reading.
func TestPublicOriginAccessorReadsAHandWrittenMistakeAsNone(t *testing.T) {
	c := &Config{Serve: ServeConfig{PublicOrigin: "https://agent.example.com/api"}}
	if got := c.PublicOrigin(); got != "" {
		t.Fatalf("PublicOrigin with a path = %q, want empty", got)
	}
	var nilCfg *Config
	if got := nilCfg.PublicOrigin(); got != "" {
		t.Fatalf("PublicOrigin on nil = %q, want empty", got)
	}
}

func TestSetPublicOriginStoresTheNormalisedNameAndClears(t *testing.T) {
	c := &Config{}
	if err := c.SetPublicOrigin("https://agent.example.com:443"); err != nil {
		t.Fatal(err)
	}
	if c.Serve.PublicOrigin != "https://agent.example.com" {
		t.Fatalf("stored %q", c.Serve.PublicOrigin)
	}
	if err := c.SetPublicOrigin(""); err != nil || c.PublicOrigin() != "" {
		t.Fatalf("clearing left %q, %v", c.Serve.PublicOrigin, err)
	}
}

func TestASetPublicOriginSurvivesASave(t *testing.T) {
	isolateUserConfigHome(t)
	path := UserConfigPath()
	c := LoadForEdit(path)
	if err := c.SetPublicOrigin("https://agent.example.com"); err != nil {
		t.Fatal(err)
	}
	if err := c.SaveTo(path); err != nil {
		t.Fatal(err)
	}
	reloaded := LoadForEdit(path)
	if got := reloaded.PublicOrigin(); got != "https://agent.example.com" {
		t.Fatalf("reloaded public origin = %q", got)
	}
}

// Naming a reverse proxy is naming who may reach this machine, so a cloned repo may
// not choose it: an untrusted checkout that named its own proxy would open a door the
// person never asked for. The whole [serve] table is the user's — holdUserGlobals
// restores it over the project merge, like share_port and remember_paired_devices — so
// a project's value is dropped before the narrowing pass sees it, with no per-key refusal.
func TestAProjectFileCannotNameTheReverseProxy(t *testing.T) {
	for _, tc := range []struct {
		name, user, project, want string
	}{
		{"a project alone names nothing", "", `[serve]
public_origin = "https://evil.example.com"
`, ""},
		{"a project cannot replace the user's name", `[serve]
public_origin = "https://agent.example.com"
`, `[serve]
public_origin = "https://evil.example.com"
`, "https://agent.example.com"},
		{"a project cannot clear the user's name", `[serve]
public_origin = "https://agent.example.com"
`, `[serve]
public_origin = ""
`, "https://agent.example.com"},
		{"the user's own name is kept", `[serve]
public_origin = "https://agent.example.com"
`, "", "https://agent.example.com"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, _ := loadScoped(t, tc.user, tc.project)
			if got := cfg.PublicOrigin(); got != tc.want {
				t.Fatalf("public origin = %q, want %q", got, tc.want)
			}
			// The dropped value is silent by design here, so the assertion that
			// matters is that nothing the project wrote survived under any key.
			if got := cfg.Serve.PublicOrigin; got != tc.want {
				t.Fatalf("stored Serve.PublicOrigin = %q, want %q", got, tc.want)
			}
		})
	}
}
