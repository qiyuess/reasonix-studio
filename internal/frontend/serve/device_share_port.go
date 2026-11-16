package serve

import (
	"errors"
	"os"
	"strconv"

	"reasonix/internal/contract/config"
)

// ErrSharePortInUse is a configured share port another process already holds.
var ErrSharePortInUse = errors.New("the share port is already in use")

// RestorePort sets the port from the user config at startup. An out-of-range
// value reads as unset, as Config.SharePort does.
func (s *DeviceShare) RestorePort(port int) {
	if config.ValidateSharePort(port) != nil {
		port = 0
	}
	s.mu.Lock()
	s.port = port
	s.mu.Unlock()
}

// SetPort saves the port to the user config and uses it from the next Open;
// zero goes back to a system-picked port. Nothing changes when saving fails.
func (s *DeviceShare) SetPort(port int) error {
	if err := config.ValidateSharePort(port); err != nil {
		return err
	}
	if err := s.persistPort(port); err != nil {
		return err
	}
	s.RestorePort(port)
	return nil
}

func persistSharePort(port int) error {
	unlock := config.LockUserConfigEdits()
	defer unlock()
	path := config.UserConfigPath()
	cfg := config.LoadForEdit(path)
	if err := cfg.SetSharePort(port); err != nil {
		return err
	}
	return cfg.SaveTo(path)
}

// SetRemember saves [serve] remember_paired_devices to the user config. The
// persist hooks read the key when they run, so the switch takes effect
// without a restart; turning it off also forgets on the spot: everything
// paired is revoked now (the trust file goes with that write) and the state
// file is removed.
func (s *DeviceShare) SetRemember(on bool) error {
	unlock := config.LockUserConfigEdits()
	path := config.UserConfigPath()
	cfg := config.LoadForEdit(path)
	cfg.SetRememberPairedDevices(on)
	if err := cfg.SaveTo(path); err != nil {
		unlock()
		return err
	}
	unlock()
	if !on {
		s.registry.RevokeAll()
		if p := shareStatePath(); p != "" {
			if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}

func (s *DeviceShare) listenPort() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strconv.Itoa(s.port)
}

// publicOriginName is the reverse proxy's name this share answers for, read
// under the same lock as the port so an Open never mixes two settings.
func (s *DeviceShare) publicOriginName() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.publicOrigin
}

// RestorePublicOrigin sets the configured proxy name at startup. A value that
// does not parse as an origin reads as none, the same way Config.PublicOrigin
// reads a hand-written one: a name the gate cannot compare must not be a door.
func (s *DeviceShare) RestorePublicOrigin(origin string) {
	if canonical, err := config.NormalizePublicOrigin(origin); err == nil {
		origin = canonical
	} else {
		origin = ""
	}
	s.mu.Lock()
	s.publicOrigin = origin
	s.mu.Unlock()
}

// SetPublicOrigin saves [serve] public_origin to the user config and applies it
// from the next Open. An open share keeps its gate, so a change lands when the
// share is next opened — which is also when phones re-pair against the new name.
func (s *DeviceShare) SetPublicOrigin(raw string) error {
	unlock := config.LockUserConfigEdits()
	defer unlock()
	path := config.UserConfigPath()
	cfg := config.LoadForEdit(path)
	if err := cfg.SetPublicOrigin(raw); err != nil {
		return err
	}
	if err := cfg.SaveTo(path); err != nil {
		return err
	}
	s.RestorePublicOrigin(cfg.PublicOrigin())
	return nil
}
