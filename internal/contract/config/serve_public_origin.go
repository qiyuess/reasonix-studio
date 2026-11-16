package config

import (
	"errors"
	"net"
	"net/url"
	"strings"
)

// ErrPublicOriginInvalid marks a [serve] public_origin this config will not
// accept: one http(s) origin, nothing after it.
var ErrPublicOriginInvalid = errors.New("public_origin must be an http:// or https:// address with no path")

// NormalizePublicOrigin reads the reverse proxy's name: scheme, host, and a
// port only when it differs from the scheme's own. An empty value is not an
// error — it is what "no proxy in front of this machine" looks like. The
// default port is dropped so that a name and its ":443" spelling are one door,
// because the Host header may arrive either way.
func NormalizePublicOrigin(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil {
		return "", ErrPublicOriginInvalid
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "" || port == defaultPort(u.Scheme) {
		if strings.Contains(host, ":") {
			// An IPv6 literal keeps its brackets once the port is gone.
			host = "[" + host + "]"
		}
		return u.Scheme + "://" + host, nil
	}
	return u.Scheme + "://" + net.JoinHostPort(host, port), nil
}

// defaultPort is the port a scheme supplies when an address omits one.
func defaultPort(scheme string) string {
	if scheme == "https" {
		return "443"
	}
	return "80"
}

// PublicOrigin is the reverse proxy's name for this machine, or empty when
// nothing stands in front of it. A hand-written value outside the accepted
// shape reads as empty: an unusable name must not become an open door.
func (c *Config) PublicOrigin() string {
	if c == nil {
		return ""
	}
	origin, err := NormalizePublicOrigin(c.Serve.PublicOrigin)
	if err != nil {
		return ""
	}
	return origin
}

// SetPublicOrigin validates and stores the reverse proxy's name; "" clears it.
func (c *Config) SetPublicOrigin(raw string) error {
	origin, err := NormalizePublicOrigin(raw)
	if err != nil {
		return err
	}
	c.Serve.PublicOrigin = origin
	return nil
}
