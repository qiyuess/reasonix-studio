package config

import "testing"

// A relay forwards someone else's models under its own name, so nothing here
// labels them. EffectiveVision answers no — the right default for deciding
// whether to send pixels — but the user has to be told which no it is, or the
// composer states a limitation of Claude that was never established.
func TestVisionDeclaredSeparatesNoFromNobodySaid(t *testing.T) {
	relay := &ProviderEntry{Name: "relay", Kind: "openai", BaseURL: "https://relay.example.com/v1", Model: "claude-sonnet-4-5"}
	if EffectiveVision(relay) {
		t.Fatal("an unlabelled relay model must not be sent images by default")
	}
	if VisionDeclared(relay) {
		t.Fatal("nobody labelled this model, so the panel must not report a settled answer")
	}

	ticked := &ProviderEntry{Name: "relay", Kind: "openai", BaseURL: "https://relay.example.com/v1",
		Model: "claude-sonnet-4-5", Models: []string{"claude-sonnet-4-5"}, VisionModels: []string{"claude-sonnet-4-5"}}
	if !EffectiveVision(ticked) || !VisionDeclared(ticked) {
		t.Fatal("ticking the model in the panel is what settles it, and it did not")
	}

	// A saved panel writes the list it was handed, empty included. An explicit
	// empty list is the choice "nothing here reads images", not a silence.
	saved := &ProviderEntry{Name: "relay", Kind: "openai", BaseURL: "https://relay.example.com/v1",
		Model: "claude-sonnet-4-5", Models: []string{"claude-sonnet-4-5"}, VisionModels: []string{}}
	if EffectiveVision(saved) {
		t.Fatal("an empty saved list must not send pixels")
	}
	if !VisionDeclared(saved) {
		t.Fatal("an empty saved list answers the question, so the panel must not call it undeclared")
	}

	// A list that omits the model answers for it too: the row left unticked
	// reads as text-only, not as unlabelled.
	omitted := &ProviderEntry{Name: "relay", Kind: "openai", BaseURL: "https://relay.example.com/v1",
		Model: "claude-haiku-4-5", Models: []string{"claude-sonnet-4-5", "claude-haiku-4-5"}, VisionModels: []string{"claude-sonnet-4-5"}}
	if EffectiveVision(omitted) {
		t.Fatal("a list omitting this model must not send pixels for it")
	}
	if !VisionDeclared(omitted) {
		t.Fatal("a list omitting this model settles it as text-only, not undeclared")
	}

	// A hand-written config may set the provider-wide flag beside a list. The
	// flag outranks it (edit_test.go holds that choice), and VisionDeclared
	// still calls the pair answered rather than a silence.
	flagged := &ProviderEntry{Name: "relay", Kind: "openai", BaseURL: "https://relay.example.com/v1",
		Model: "claude-haiku-4-5", Models: []string{"claude-sonnet-4-5", "claude-haiku-4-5"}, Vision: true,
		VisionModels: []string{"claude-sonnet-4-5"}}
	if !EffectiveVision(flagged) {
		t.Fatal("the provider-wide flag outranks a written list that omits this model")
	}
	if !VisionDeclared(flagged) {
		t.Fatal("flag and list together are still an answer, not a silence")
	}
	noFlag := &ProviderEntry{Name: "relay", Kind: "openai", BaseURL: "https://relay.example.com/v1",
		Model: "claude-haiku-4-5", Models: []string{"claude-sonnet-4-5", "claude-haiku-4-5"},
		VisionModels: []string{"claude-sonnet-4-5"}}
	if EffectiveVision(noFlag) {
		t.Fatal("without the flag, a list that omits this model keeps it text-only")
	}

	// An endpoint the kernel refuses images for has been answered, by the kernel.
	deepseek := &ProviderEntry{Name: "deepseek", Kind: "openai", BaseURL: "https://api.deepseek.com", Model: "deepseek-v4"}
	if EffectiveVision(deepseek) || !VisionDeclared(deepseek) {
		t.Fatal("the kernel's own refusal is a settled answer, not a silence")
	}
}

// Two absent lists must not merge into an empty declaration: the merge
// behind a legacy migration is where that could silently happen.
func TestMergingTwoAbsentVisionListsStaysSilent(t *testing.T) {
	entry := &ProviderEntry{Name: "deepseek", Kind: "openai", BaseURL: "https://api.deepseek.com", Model: "deepseek-v4"}
	old := &ProviderEntry{Name: "deepseek-old"}
	mergeLegacyDeepSeekModelConfiguration(entry, old)
	if entry.VisionModels != nil {
		t.Fatalf("two absent vision lists merged into %#v, want nil", entry.VisionModels)
	}
	mergeLegacyDeepSeekModelConfiguration(entry, &ProviderEntry{Name: "old", VisionModels: []string{"deepseek-v4-flash"}})
	if entry.VisionModels == nil || len(entry.VisionModels) != 1 {
		t.Fatalf("a present list must still arrive: %#v", entry.VisionModels)
	}
}

// One DeepSeek endpoint now serves a model that reads images beside models that
// reject them, so the kernel's refusal is the model's and not the host's. The
// panel has to say so per row: a connection-wide answer speaks for models it was
// never asked about, and it would lock the one model that works.
func TestDeepSeekVisionIsAnsweredPerModel(t *testing.T) {
	entry := func(model string) *ProviderEntry {
		return &ProviderEntry{
			Name: "deepseek", Kind: "openai", BaseURL: "https://api.deepseek.com", Model: model,
			Models: []string{model}, VisionModels: []string{model},
		}
	}

	for _, model := range []string{DeepSeekFlashModel, "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"} {
		seeing := entry(model)
		if !CanConfigureVision(seeing) {
			t.Fatalf("%s reads images; it must be configurable", model)
		}
		if !EffectiveVision(seeing) {
			t.Fatalf("ticking %s in the panel must settle it, as it does anywhere else", model)
		}
	}

	// Pro answers an image with 200 and no sight of it rather than refusing, so
	// the dead switch is the only thing standing between a user and a picture
	// that was charged for, sent, and never seen.
	if CanConfigureVision(entry(deepSeekProModel)) {
		t.Fatalf("%s takes text only; ticking it must stay a dead switch", deepSeekProModel)
	}

	// The vendor's list is the declaration. A model id containing "vision" is a
	// word, and matching it would enable pixels for an endpoint that rejects them.
	if CanConfigureVision(entry("deepseek-v5-vision")) {
		t.Fatal("a name is not a capability declaration")
	}

	// A gateway that reimplements the wire is still the user's call to make.
	relay := &ProviderEntry{
		Name: "relay", Kind: "openai", BaseURL: "https://relay.example.com/v1",
		Model: "deepseek-v4-pro", Models: []string{"deepseek-v4-pro"}, VisionModels: []string{"deepseek-v4-pro"},
	}
	if !CanConfigureVision(relay) {
		t.Fatal("a custom gateway may implement its own multimodal translation")
	}
}
