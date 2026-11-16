package serve

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"reasonix/internal/contract/config"
)

const (
	codeShareAddress      = "share.address_rejected"
	codeShareChannel      = "share.channel_unknown"
	codeShareClosed       = "share.closed"
	codeShareCloud        = "share.cloud_unavailable"
	codeShareListen       = "share.listen_failed"
	codeSharePortInUse    = "share.port_in_use"
	codeSharePortRange    = "share.port_out_of_range"
	codeSharePortSave     = "share.port_save_failed"
	codeShareOriginSave   = "share.public_origin_save_failed"
	codeShareRememberSave = "share.remember_save_failed"
	codeShareUnknown      = "share.device_unknown"
)

// registerShareRoutes is registered only where a window holds a share, and
// only on the host's side of hostOnly: a paired device cannot mint a code that
// pairs another, nor unpair the window's other devices.
func (h *Hub) registerShareRoutes(mux *http.ServeMux) {
	if h.opts.Share == nil {
		return
	}
	mux.HandleFunc("GET /share", h.shareStatus)
	mux.HandleFunc("POST /share/open", h.shareOpen)
	mux.HandleFunc("POST /share/port", h.shareSetPort)
	mux.HandleFunc("POST /share/public-origin", h.shareSetPublicOrigin)
	mux.HandleFunc("POST /share/close", h.shareClose)
	mux.HandleFunc("POST /share/offer", h.shareOffer)
	mux.HandleFunc("POST /share/cloud-offer", h.shareCloudOffer)
	mux.HandleFunc("POST /share/revoke", h.shareRevoke)
	mux.HandleFunc("GET /share/remember", h.shareRememberGet)
	mux.HandleFunc("POST /share/remember", h.shareRememberSave)
	h.registerPhoneRoutes(mux)
}

func (h *Hub) shareCloudOffer(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	offer, err := h.opts.Share.CloudOffer()
	if err != nil {
		refuse(w, http.StatusConflict, codeShareCloud, err.Error(), nil)
		return
	}
	writeJSON(w, offer)
}

func (h *Hub) shareStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, h.opts.Share.Status())
}

func (h *Hub) shareOpen(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IP string `json:"ip"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.IP == "" {
		missingField(w, "ip")
		return
	}
	st, err := h.opts.Share.Open(body.IP)
	switch {
	case errors.Is(err, ErrShareAddress):
		refuse(w, http.StatusBadRequest, codeShareAddress, err.Error(), map[string]any{"ip": body.IP})
	case errors.Is(err, ErrSharePortInUse):
		refuse(w, http.StatusConflict, codeSharePortInUse, err.Error(), map[string]any{"ip": body.IP, "port": h.opts.Share.Status().Port})
	case err != nil:
		// The socket is ours to open, so a failure is this machine's, not the
		// request's: a port taken, a firewall, an address that went away.
		refuse(w, http.StatusInternalServerError, codeShareListen, err.Error(), map[string]any{"ip": body.IP, "error": err.Error()})
	default:
		writeJSON(w, st)
	}
}

func (h *Hub) shareSetPort(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Port *int `json:"port"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil || body.Port == nil {
		missingField(w, "port")
		return
	}
	switch err := h.opts.Share.SetPort(*body.Port); {
	case errors.Is(err, config.ErrSharePortOutOfRange):
		refuse(w, http.StatusBadRequest, codeSharePortRange, err.Error(), map[string]any{"min": config.MinSharePort, "max": config.MaxSharePort})
	case err != nil:
		saveFailed(w, http.StatusInternalServerError, codeSharePortSave, err)
	default:
		writeJSON(w, h.opts.Share.Status())
	}
}

func (h *Hub) shareSetPublicOrigin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Origin *string `json:"origin"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil || body.Origin == nil {
		missingField(w, "origin")
		return
	}
	switch err := h.opts.Share.SetPublicOrigin(*body.Origin); {
	case errors.Is(err, config.ErrPublicOriginInvalid):
		// The address is the user's to get wrong: say so as a refusal of the
		// value rather than a failure of this machine. The wording reads
		// `{error}`, so the sentence has to travel with the refusal.
		refuse(w, http.StatusBadRequest, codeShareOriginSave, err.Error(), map[string]any{"error": err.Error()})
	case err != nil:
		saveFailed(w, http.StatusInternalServerError, codeShareOriginSave, err)
	default:
		writeJSON(w, h.opts.Share.Status())
	}
}

func (h *Hub) shareRememberGet(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, struct {
		Remember bool `json:"remember"`
	}{Remember: rememberPairedDevices()})
}

func (h *Hub) shareRememberSave(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Remember *bool `json:"remember"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil || body.Remember == nil {
		missingField(w, "remember")
		return
	}
	switch err := h.opts.Share.SetRemember(*body.Remember); {
	case err != nil:
		saveFailed(w, http.StatusInternalServerError, codeShareRememberSave, err)
	default:
		writeJSON(w, struct {
			Remember bool `json:"remember"`
		}{Remember: *body.Remember})
	}
}

func (h *Hub) shareClose(w http.ResponseWriter, _ *http.Request) {
	h.opts.Share.Close()
	writeJSON(w, h.opts.Share.Status())
}

// shareOffer mints a pairing code for one door. The channel names which: a
// window drawing both the local and the proxy channel asks per channel, and the
// default is the local one so a caller that predates the choice keeps working.
func (h *Hub) shareOffer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	channel := OfferLAN
	var body struct {
		Channel string `json:"channel"`
	}
	if r.ContentLength > 0 {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
			badBody(w)
			return
		}
	}
	switch OfferChannel(strings.TrimSpace(body.Channel)) {
	case "", OfferLAN:
		channel = OfferLAN
	case OfferProxy:
		channel = OfferProxy
	default:
		refuse(w, http.StatusBadRequest, codeShareChannel, "that channel is not one this share has", map[string]any{"channel": body.Channel})
		return
	}
	offer, err := h.opts.Share.Offer(channel)
	switch {
	case errors.Is(err, ErrShareClosed):
		refuse(w, http.StatusConflict, codeShareClosed, err.Error(), nil)
	case errors.Is(err, ErrShareChannel):
		refuse(w, http.StatusConflict, codeShareChannel, err.Error(), nil)
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err)
	default:
		writeJSON(w, offer)
	}
}

func (h *Hub) shareRevoke(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID == "" {
		missingField(w, "id")
		return
	}
	if !h.opts.Share.Revoke(body.ID) {
		refuse(w, http.StatusNotFound, codeShareUnknown, "no device is paired under that id", map[string]any{"id": body.ID})
		return
	}
	writeJSON(w, h.opts.Share.Status())
}
