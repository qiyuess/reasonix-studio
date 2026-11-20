package theme

import (
	"os"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
)

// The id reaches this from a URL path, so an id that walks out of the pack
// directory has to be refused before it becomes a filename — both against the
// installed packs and against the flat names the shipped ones use.
func TestAssetRefusesAnIDThatEscapes(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	for _, id := range []string{"..", "../..", "a/b", `a\b`, "", "  "} {
		if _, _, err := Asset(id, assetBackground); err == nil {
			t.Fatalf("Asset(%q) resolved, want a rejection", id)
		}
	}
}

func TestAssetRefusesAnUnknownKind(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	if _, _, err := Asset("official-clear-blue", Kind("../theme.json")); err == nil {
		t.Fatal("an unknown asset kind resolved")
	}
	if _, ok := KindOf("manifest"); ok {
		t.Fatal("KindOf accepted a kind that is not an image")
	}
}

// An installed pack serves the images it carries. The shipped themes are all
// token-only — foundation palettes with no artwork — so this builds the pack it
// needs rather than reading one off the embedded set.
func TestInstalledPackServesItsImages(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	writePack(t, Dir(), "artwork", `{"schemaVersion":1,"name":"Artwork",
	  "background":{"image":"background.webp","focusX":0.5,"focusY":0.5},
	  "tokens":{"light":{"bg":"#FFFFFF"},"dark":{"bg":"#000000"}}}`)
	dir := Dir()
	png := []byte("\x89PNG\r\n\x1a\n mine")
	if err := os.WriteFile(filepath.Join(dir, "artwork", "background.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	raw, ctype, err := Asset("artwork", assetBackground)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(png) || ctype != "image/png" {
		t.Fatalf("asset = %d bytes %q, want the installed png", len(raw), ctype)
	}
}

// A pack that ships no image still describes how it wants one placed, so a
// user dropping their own picture in gets that placement rather than a
// centred default.
func TestBackgroundPlacementSurvivesAMissingImage(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	writePack(t, Dir(), "placed", `{"schemaVersion":1,"name":"Placed",
	  "background":{"image":"background.webp","focusX":0.8,"focusY":0.3,"safeArea":"left","homeOpacity":0.9,"taskOpacity":0.15},
	  "tokens":{"light":{"bg":"#FFFFFF"},"dark":{"bg":"#000000"}}}`)

	pack, err := Load("placed")
	if err != nil {
		t.Fatal(err)
	}
	if pack.Background == nil {
		t.Fatal("placement was dropped with the missing image")
	}
	if pack.Background.Image {
		t.Fatal("Image is true without a file")
	}
	if pack.Background.FocusX != 0.8 || pack.Background.SafeArea != "left" || pack.Background.TaskOpacity != 0.15 {
		t.Fatalf("placement = %+v", pack.Background)
	}
}

// Out-of-range numbers are clamped rather than rejected: a pack is cosmetic,
// and an opacity of 4 should read as opaque, not fail to load.
func TestBackgroundNumbersAreClamped(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	writePack(t, Dir(), "wild", `{"schemaVersion":1,"name":"Wild",
	  "background":{"focusX":9,"focusY":-3,"homeOpacity":4,"taskOpacity":-1,"safeArea":"sideways"},
	  "tokens":{"light":{"bg":"#FFFFFF"},"dark":{"bg":"#000000"}}}`)

	pack, err := Load("wild")
	if err != nil {
		t.Fatal(err)
	}
	b := pack.Background
	if b.FocusX != 1 || b.FocusY != 0 || b.HomeOpacity != 1 || b.TaskOpacity != 0 {
		t.Fatalf("clamping = %+v", b)
	}
	if b.SafeArea != "" {
		t.Fatalf("safeArea = %q, want an unknown value dropped", b.SafeArea)
	}
}
