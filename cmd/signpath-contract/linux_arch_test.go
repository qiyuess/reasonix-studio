package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
)

// This line publishes Windows and the phone app. The Linux legs are gone from
// the build matrix rather than skipped, so the guard is the other way round: a
// Linux leg that reappeared would ship a package nothing signs, verifies or
// publishes, and the acceptance steps that used to gate it are gone with it.
func TestReleaseBuildsNoLinuxLeg(t *testing.T) {
	root := parseWorkflowFile(t, "../../.github/workflows/release-studio.yml")
	jobs := jobsOf(t, root)
	entries := mappingValue(mappingValue(mappingValue(mappingValue(jobs, "build"), "strategy"), "matrix"), "include")
	for _, entry := range entries.Content {
		if platform := mappingScalar(entry, "platform"); strings.HasPrefix(platform, "linux/") {
			t.Errorf("the build matrix still carries %q", platform)
		}
		if artifact := mappingScalar(entry, "artifact"); strings.Contains(artifact, "linux") {
			t.Errorf("the build matrix still produces %q", artifact)
		}
	}
	build := mappingValue(jobs, "build")
	for _, name := range []string{
		"Install Linux packaging deps",
		"Use a native fpm on ARM64 Linux",
		"Stage the Linux package payload",
		"Verify both Linux package formats",
		"Accept the installed Linux package",
		"Verify the AppImage",
	} {
		if nodeContains(build, name) {
			t.Errorf("the build job still runs %q", name)
		}
	}
	for _, step := range mappingValue(mappingValue(jobs, "publish"), "steps").Content {
		if name := mappingScalar(mappingValue(step, "with"), "name"); strings.Contains(name, "linux") {
			t.Errorf("publish still downloads the Linux artifact %q", name)
		}
	}
}

func TestLinuxCIPackageMatrixPreservesUpstreamScope(t *testing.T) {
	root := parseWorkflowFile(t, "../../.github/workflows/studio.yml")
	job := mappingValue(jobsOf(t, root), "scope")
	run := ""
	for _, step := range mappingValue(job, "steps").Content {
		if mappingScalar(step, "id") == "pick" {
			run = mappingScalar(step, "run")
		}
	}
	if run == "" {
		t.Fatal("no executable CI matrix selector")
	}
	for _, tc := range []struct {
		event, file string
		arm64       bool
	}{
		{"push", "docs/test.md", true},
		{"pull_request", "docs/test.md", false},
		{"pull_request", "scripts/linux-install-smoke.sh", true},
		{"pull_request", "scripts/verify-linux-package.sh", true},
		{"pull_request", "scripts/verify-studio-artifacts.sh", true},
		{"pull_request", "desktop/cmd/update-helper/main_linux.go", true},
		{"pull_request", "desktop/electron/test/unit.mjs", true},
	} {
		t.Run(tc.event+"/"+tc.file, func(t *testing.T) {
			dir := testenv.TempDir(t)
			// A shell function owns command lookup on every host, including Git
			// Bash on Windows; a PATH shim can resolve the runner's real git.
			git := "git() { case \"$*\" in 'diff -z --name-only --no-renames fixture HEAD') printf '%s\\0' \"$MATRIX_TEST_FILE\" ;; 'diff --name-only --no-renames fixture HEAD') printf '%s\\n' \"$MATRIX_TEST_FILE\" ;; *) return 1 ;; esac; };\n"
			output := filepath.Join(dir, "output")
			cmd := exec.Command("bash", "-c", "set -euo pipefail\n"+git+run)
			cmd.Dir = "../.."
			cmd.Env = append(os.Environ(), "EVENT="+tc.event, "MATRIX_TEST_FILE="+tc.file, "BASE_SHA=fixture", "GITHUB_OUTPUT="+output)
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("matrix selector: %v: %s", err, out)
			}
			body, err := os.ReadFile(output)
			if err != nil {
				t.Fatal(err)
			}
			var matrix struct {
				Include []map[string]string `json:"include"`
			}
			for line := range strings.SplitSeq(string(body), "\n") {
				if value, ok := strings.CutPrefix(line, "matrix="); ok {
					if err := json.Unmarshal([]byte(value), &matrix); err != nil {
						t.Fatal(err)
					}
				}
			}
			seen := map[string]string{}
			for _, leg := range matrix.Include {
				if leg["platform"] == "linux" {
					seen[leg["arch"]] = leg["os"]
				}
			}
			if seen["amd64"] != "ubuntu-22.04" || (seen["arm64"] == "ubuntu-22.04-arm") != tc.arm64 {
				t.Fatalf("Linux CI matrix = %v; selector output: %s", seen, out)
			}
		})
	}
}
