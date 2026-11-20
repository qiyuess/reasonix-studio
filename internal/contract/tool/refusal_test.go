package tool

import (
	"encoding/json"
	"testing"
)

func TestARefusalRendersTheSettingThatWouldLiftIt(t *testing.T) {
	r := Refusal{Code: "tools.disabled", Message: "That tool is off in this session.", Remedy: &Remedy{Op: RemedyPropose, Setting: "tools.disabled", Value: json.RawMessage(`[]`)}}
	want := "That tool is off in this session. (refusal: tools.disabled) (fix: tool:setting op=propose id=tools.disabled value=[])"
	if got := r.String(); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestARemedyThatOnlyOpensCarriesNoValue(t *testing.T) {
	r := Refusal{Code: "x.y", Remedy: &Remedy{Op: RemedyOpen, Setting: "permissions.mode", Value: json.RawMessage(`"yolo"`)}}
	if got, want := r.String(), "(refusal: x.y) (fix: tool:setting op=open id=permissions.mode)"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestARefusalWithoutARemedyReadsAsBefore(t *testing.T) {
	if got := (Refusal{Code: "a.b", Message: "no"}).String(); got != "no (refusal: a.b)" {
		t.Fatalf("got %q", got)
	}
}
