package main

import (
	"gopkg.in/yaml.v3"
	"strings"
	"testing"
)

func stepNamed(t *testing.T, job *yaml.Node, name string) *yaml.Node {
	t.Helper()
	steps := mappingValue(job, "steps")
	for _, step := range steps.Content {
		if mappingScalar(step, "name") == name {
			return step
		}
	}
	t.Fatalf("no step %q", name)
	return nil
}

func TestStudioReleaseDecidesLatestFromTheFlagsScript(t *testing.T) {
	root := parseWorkflowFile(t, "../../.github/workflows/release-studio.yml")
	publish := mappingValue(jobsOf(t, root), "publish")
	step := stepNamed(t, publish, "Publish GitHub release")
	run := mappingScalar(step, "run")
	env := mappingValue(step, "env")
	if got := mappingScalar(env, "CANDIDATE"); got != "${{ needs.resolve.outputs.candidate }}" {
		t.Fatalf("CANDIDATE = %q, want the resolve job's grammar-derived output", got)
	}
	if !strings.Contains(run, `scripts/studio-release-flags.sh "$TAG" "$CANDIDATE"`) {
		t.Fatal("the release flags do not come from scripts/studio-release-flags.sh")
	}
	for _, flag := range []string{"--prerelease", "--latest"} {
		if strings.Contains(run, flag) {
			t.Errorf("the publish step spells %s itself; the decision belongs to the flags script", flag)
		}
	}
	if strings.Contains(run, "gh release edit") && strings.Contains(run[strings.Index(run, "gh release edit"):], "--latest") {
		t.Error("an existing release must not have its latest flag edited")
	}
}

func TestStudioGitHubReleaseCarriesNoRootManifest(t *testing.T) {
	root := parseWorkflowFile(t, "../../.github/workflows/release-studio.yml")
	publish := mappingValue(jobsOf(t, root), "publish")
	run := mappingScalar(stepNamed(t, publish, "Publish GitHub release"), "run")
	// The release page carries only what a person downloads. The manifest and
	// the signatures are published to the site instead, so the asset list skips
	// both by name rather than by a pattern that could miss one.
	if !strings.Contains(run, "latest.json|*.minisig) continue ;;") {
		t.Fatal("the publish step does not filter latest.json and the signatures out of the uploaded assets")
	}
	for line := range strings.SplitSeq(run, "\n") {
		if strings.Contains(line, "gh release") && strings.Contains(line, "dist/") {
			t.Errorf("gh uploads the dist glob, root latest.json included: %s", strings.TrimSpace(line))
		}
	}
	if !strings.Contains(run, `"${assets[@]}"`) {
		t.Fatal("the release is not created from the filtered asset list")
	}
	// What the release drops, the site has to carry: a client reads the manifest
	// and the signature from there, so both must be written by the same run.
	site := mappingScalar(stepNamed(t, publish, "Publish the update catalog"), "run")
	if !strings.Contains(site, `cp dist/latest.json "$site/$TAG/latest.json"`) {
		t.Error("the site does not receive the per-tag manifest")
	}
	if !strings.Contains(site, `cp dist/*.minisig "$site/$TAG/"`) {
		t.Error("the site does not receive the signatures the manifest names")
	}
}
