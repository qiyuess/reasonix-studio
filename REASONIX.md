# Reasonix project memory

This file is loaded into every session's system prompt (the cache-stable prefix),
so keep it concise and durable — it is the project's standing instructions to the
agent. It is the Reasonix analog of Claude Code's CLAUDE.md.

## Conventions

- Go kernel under `internal/`; each package owns one concern. A package's long
  explanation belongs in its `doc.go`, not spread across implementation files.
- One transport-agnostic `control.Controller` sits behind every frontend (chat
  TUI, HTTP/SSE serve, Electron desktop). Add behavior to the controller, not a
  frontend, so all three inherit it.
- Layering (enforced): utility packages import nothing under `reasonix/` except
  one another — that layer is closed, so a leaf reaching a leaf drags no graph
  along, while refusing it leaves one judgement copied into several of them; only
  the frontends `cli`, `serve`, `acp`, `boot` and the hosts `cmd/`, `desktop/`
  may import `control`; nothing below a frontend may import one. The declared
  sets live in `tools/repolint/layers.go`.
- Subagent delegation keeps five concepts apart: a profile says how a worker
  thinks, `TaskSpec` what this call wants, `CapabilityGrant` what it may touch,
  `ContextRequest` what it starts from, `SchedulerPolicy` when it runs. Put a
  field in whichever member decides its value — profiles carry ceilings, never
  per-call values. `internal/runtime/delegation/profile_boundary_test.go` enforces it.
- Cache-first: the system-prompt prefix (base prompt, tools, declared prefix
  configuration) must stay byte-stable across turns so DeepSeek's automatic
  prefix cache stays warm. Never mutate it mid-session — ride the turn tail
  instead (see `control.Compose`), under the rules in *Context projection*.
- Performance features land with an effect test at their final boundary
  (`internal/assembly/boot/effect_test.go` pattern): assert what actually reaches the
  provider request, frontend sink, or trajectory through the real `boot.Build`
  assembly. Component correctness is not system effectiveness.
- A mutex- or atomic-guarded struct is ratcheted on its **scalar** field count
  (`struct-state`), not its total: independent flags multiply into states no
  type records as legal. Fixing a boundary case by adding one more `bool` is
  the move this blocks — group by lifetime into a named sub-state instead
  (`agent.perTurnState` is the pattern), which costs one field and removes the
  whole product.
- The context window (projection, compaction, estimation) owns `windowState`;
  the loop reaches it via `a.window()`, it reaches the loop via `windowHost`.
  `window-state` fails any other read of `sess.win`.
- Judgements read structure, never wording: shell ASTs (`shellparse`), types,
  contracts, tool schemas. Phrase tables and message sniffing have been retired
  in batches (task-policy prose, the planner's approval phrases, the executor
  handoff tables) because each one misfires on real input, and a misfiring
  judgement inside a gate is worse than no gate. Security allow-lists are the
  exception and stay. Something that can only be built by matching words does
  not get built — say what is missing instead of guessing at it.
- The other half of that rule: an error a caller must tell apart **carries an
  identity** — a sentinel, a typed code — never a sentence. Only the producer
  knows a deadline expired rather than a socket closed, and a message is where
  that knowledge goes to die: the reader is left matching words, or with
  nothing. Across HTTP the identity is a dotted code through `refuse`;
  `refusal-path` fails a new `http.Error` in `internal/frontend/serve`, and the parity
  test fails a code the frontend cannot say. Inside Go it is `errors.Is` on a
  sentinel the wrapping preserves; `error-text` fails a new match against an
  error message, following it one hop into a local because storing the text
  first is what the direct form turns into.
- **Whoever first knows why an operation failed owns its class.** A transport
  status is not a domain identity, and a display string is not a classification;
  past that boundary a layer may project the class, never re-derive it. Both
  directions were live: `catalog.go` answered 400 for a name nobody declared and
  for a disk that would not write, so a failed store told the user their request
  was wrong; `ServerRow` decided a connection was an authorisation problem by
  matching `/401|403|unauthorized/` against prose an external MCP server wrote,
  which the host had sanitised and truncated on the way through. Domain,
  internal and dependency are three answers with three different things to do
  next, and a caller that cannot tell them apart reports the last two as the
  first.
- Failure attribution is host-owned state. When the host can determine why an
  operation failed or stopped — truncation, timeout, unavailable context,
  dependency skipping, policy refusal, output spill, argument parsing — that
  cause goes to the model. Surfacing only the downstream symptom leaves it to
  invent one, and the invented rule outlives the incident: a response cut at the
  output limit reaches the model as "invalid arguments", and the session learns
  to stop batching calls that were never the problem.
- A host-owned identity has to cross the model-visible boundary. Stable step
  ids, typed error codes, boundary causes — anything the host expects the model
  to cite must appear wherever that state is rendered for it. Telling the model
  in a schema to prefer X while every concrete rendering shows only Y trains it
  to use Y; `complete_step` said `step_id` PREFERRED while all four todo
  renderers printed bare ordinals. Canonical dynamic state still stays out of
  the cache-stable prefix — project the identities needed to act on it at the
  turn tail.
- A metric is its definition, not its name. Before a number becomes a finding,
  state what it counts, from which anchor, over which population, and what it
  excludes. Three readings in one study died in that gap: a command of unknown
  extent read as a proven write, the latest report's adjudication read as every
  report's, and a syntactically accepted call read as a closed one. Each time a
  convenient proxy had been left standing in for the state it was named after,
  and each time the mechanism story built on it was wrong. A number without
  those four lines is an observation, not a result.
- A constructed state is not a reachable one. Before a destructive test or a
  counterfactual is reported as a defect, say who in production produces that
  state, through which transitions, across which persistence boundary, under
  whose authority, and whether a real run has been seen reaching it. A test that
  assigns a private field proves the mechanism *given* the state and must be
  reported as exactly that: `a.projectChecks` is written once at boot and never
  again, so reassigning it stood in for a resume rather than demonstrating one,
  and the bypass built on it was never shown to be production-reachable.
  Severity is reachability times frequency times authority, not "can be
  bypassed".
- A wire type the desktop re-declares by hand is held to the kernel's by
  `wire-parity`, both directions: a field one side sends and the other cannot
  read fails, and so does one it reads that nothing sends. The two are compiled
  by different toolchains and meet only over JSON, so nothing else in the tree
  notices when one of them grows a field. The pairs are declared in
  `tools/repolint/wireparity.go`, never inferred — no spelling tells a mirrored
  contract from a struct that merely carries json tags.
- "Add behavior to the controller so every frontend inherits it" is held by
  `frontend-parity`: a capability one frontend already drives, a frontend whose
  declared port carries it, and no call, is a missing edge, and the ratchet
  counts edges. Which port each frontend drives is declared in
  `tools/repolint/frontendparity.go`; a deliberate exception goes in the scope
  table there with an issue and a reason, and costs what the edge cost, so the
  table cannot become where debt disappears. The matrix is read from
  `go/types` at one pinned build target, never from selector names — `Close`
  and `Status` are capabilities and also stdlib methods, and a name match
  records `os.File.Close` as a frontend driving `Lifecycle.Close`, a false
  "wired" that hides real debt. How a verb is spelled — `/branch`,
  `POST /branches` — is presentation and stays out of it.
- The desktop's presentation layer answers to canonical state and never
  redefines it. Six rules, each held by a gate rather than by memory:
  presentation reorders and reweights what the kernel owns but never restates
  it; **mount is not a motion cause** — a fact enters once, and replay or
  virtualization bringing its element back is not that fact happening again;
  a search alias buys discoverability and never becomes a thing's identity;
  when a setting takes effect is declared per block, from what its endpoint
  does, never inferred from wording or handler names; ordering panels by
  lifecycle moves them and must not remount them; and a control's identity
  survives a change of where it is drawn — the settings sheet and the composer
  render `chrome.preset` because that is one intent, not two.

## Comments

Default is none — the code is the truth. Write one only when the **why** is
non-obvious: a hidden constraint, a workaround anchored to something verifiable,
an invariant the type system cannot express, or an external-protocol quirk.

A comment states the constraint that holds now. It does not narrate how the code
got here: a reader who has never seen an earlier version must lose nothing, and
past tense about this code's own behaviour is the tell — an external protocol's
history is not. "Ids alone do not answer it" is the rule; "ids alone were the
wrong question, so the list went on reading as the model wrote it" is the
incident behind the rule, and the incident belongs in the commit message. This
outranks the surrounding style: much of the tree reads as prose and none of it
is the standard. No gate reads register — telling narrative from a statement of
constraint needs a phrase table, which is the one thing this repo does not
build — so this rule is held by review.

- **Stylesheets carry none.** A rule's selector and its declarations are the
  whole statement. What a `.css` comment would have said goes to whichever of
  two places can act on it: a constraint a component has to honour belongs in
  that component, and a decision about the medium itself — a measured colour, a
  layout mechanic, why the obvious rule is the wrong one — belongs in the
  stylesheet's companion document (`src/styles/TOKENS.md`, `LAYOUT.md`), which
  is read end to end rather than met 600 times as an aside.
- **English, always** — every comment, in every other language the tree is
  written in. A codebase whose commentary is half one language reads as two
  codebases, and the half a given reader cannot read is the half that rots.
- Declaration doc: ≤5 lines. Package comment: ≤8 lines, or ≤40 in a `doc.go`.
- Every other comment: ≤3 lines. Struct-field and trailing `//`: 1 line.
- Never: restatements of the code, phase/stage narrative, incident or
  conversation history, section banners, commented-out code, `@param` lists.
- `TODO(#nnn):` and `HACK(#nnn):` need the issue anchor. `FIXME` is banned.
- One responsibility per file; 800 lines is the ceiling. Test files are exempt:
  their length tracks how many cases they cover, not how many concerns they
  carry, so splitting one only scatters a subject's table across files.

`go run ./tools/repolint` enforces the budgets above against a ratchet baseline:
recorded debt is tolerated, anything new fails CI. Never widen the baseline to
land a change — fix the code. `-update` lowers budgets freely and refuses to
raise one without `-allow-widen`, so carrying debt through a rename or an
extraction is asked for in the command and justified in the PR. A clean run also
reports budget the tree stopped using: it is only reclaimed by an `-update`, and
until then it is room a file can grow back into.

## Context projection

Canonical dynamic state — the skill registry, the memory store — lives in its own
owner, and what the model sees is a projection of it onto each request. The
prefix was never where these belonged wrongly; freshness ownership was missing.

- **Prefix ownership.** Only declared prefix configuration may move the
  cache-stable prefix; ordinary memory writes, skill writes and runtime facts
  ride the turn. Pinned memory bodies are the one declared exception, because
  pinning is a request to pay one cold start.
- **Projection freshness.** When canonical state changes, the next eligible turn
  carries the new projection or can say why it is not owed. "Right after a fold,
  or in the next session" is not an answer.
- **Projection ownership.** Whoever owns a dynamic fact owns the invalidation
  that makes its projection owed again. A projection kept fresh because every
  writer remembered to announce itself is one forgotten call from stale —
  `skillSet.owedCatalog` asks the registry rather than waiting to be told.
- **Determinism.** The same canonical state and the same projection state
  produce byte-identical model-visible bytes.
- **Detection is semantic.** Freshness may not rest on writer notification, on
  mtime, or on which call path made the change. The registry answers from
  canonical state, so a switch flipped and a file edited past every API are the
  same question, and a change no projection renders is not a change.

`internal/assembly/boot/context_projection_test.go` holds all five at the provider
boundary, with the skills listing and the standing instructions as the two
worked examples. A block is settled only once the turn carrying it reaches the
runner: a turn blocked by a hook or refused by an extension after composing put
those bytes nowhere, and clearing the debt there would leave the model holding
state nobody sent it. A projection that has become empty is still owed once —
otherwise the block the model already has goes on reading as current.

## Memory

- Standing instructions are hierarchical: committed/shared `REASONIX.md`,
  `AGENTS.md`, and `CLAUDE.md`; personal `*.local.md` variants; matching files in
  ancestor directories; and user-global files under the memory state root
  (`REASONIX_STATE_HOME`, otherwise `REASONIX_HOME`, otherwise `~/.reasonix` on
  macOS/Linux or `%APPDATA%\reasonix` on Windows). All distinct supported files
  in a directory load; `AGENTS.md` is not merely a fallback.
- `@path` on its own line imports another file's contents.
- `#<note>` in chat quick-adds an always-on instruction. The `remember` tool
  instead saves a fallible background fact (frontmatter file + `MEMORY.md`
  index). Fact `type` classifies content; independent `scope` controls whether it
  is project-only (the default) or explicitly global.
- The saved-fact index stays out of the stable prefix and is reached through the
  `memory` tool; pinned bodies and global user/feedback bodies load into it, the
  latter as lower-priority compatibility guidance. The current turn receives a
  tail note.

## Notes

One tool call costs one model round trip, so calls that do not depend on each
other belong in the same round: several reads, edits to different files, a check
after the edit that enables it. Several edits to the *same* file are one
`multi_edit` — it applies them against each other in memory and rewrites the
file only if all of them land, so a failure midway leaves nothing half-edited.

## Vendor rates

Official list prices live in one place: `officialRates` in
`internal/contract/pricing/rates.go`, oldest generation first, the last being what a
model charges today. A price change is an **append, never an edit** — the
superseded rate is what lets an installed config be recognised as holding one
of ours and brought forward, instead of quoting a retired rate for the rest of
its life. `config` reads these through `pricing.CurrentRate` and
`SupersededRates` and restates none of them; a table written twice is one that
drifts, which is how a vendor's USD rate ended up published on one side only.

`make pricecheck` reads each vendor's own page and compares it against that
table, and reports how long ago a person last confirmed each one. It reaches
the network, so it stays out of `make lint` and out of CI: run it before
touching a rate and when a vendor announces a change. A page it cannot read
exits non-zero — unread is its own verdict and never counts as agreement.

## Curated presets

A preset changing shape reaches the installs that already have the old one
through `shippedPresets` in `internal/contract/config/preset_upgrade.go`: one declared
shape per generation, and one upgrade that brings a matching entry forward. The
guard is the whole shape — catalog, window, default — because an entry holding
what we shipped is ours to move and anything else its user curated.

A preset is also what settles which of its models read images. Probing an
address a preset covers answers from that declaration, because reading a name
misses every Kimi, Qwen, MiniMax and Claude model they declare and `deepseek-
flash` spells nothing at all; the spelling is the last resort for an address
nothing has declared, and stays a correctable suggestion rather than a claim.

Three distinctions are load-bearing, and each was a separate migration function
before they were written down. A window the shape did not name is the user's,
so only a shape identified by its window moves one. `vision_models` **narrows**,
so an upgrade marks only the models it adds and only where the preset says they
read images. And an explicitly empty list is a choice — nothing here reads
images — which is not the same as the nil that means nobody has said.

## Pre-push CI simulation

Run these **before every commit** to catch the fastest CI failures locally:

```bash
gofmt -w .                          # catches gofmt (saves ~13s CI)
go vet ./...                        # catches vet warnings (saves ~52s CI/lint)
make lint                           # golangci-lint at CI's pin + repolint
go test ./internal/tools/builtin/ ./internal/assembly/boot/  # catches tool/boot test breaks
```

`make lint` runs the two lint gates CI runs — `golangci-lint` at the version in
`.golangci-version` and repolint; `make lint-install` installs the linter. CI's
`lint` job also runs `go run ./tools/covergate` (`make coverage-gate`), which
`make lint` does not.

Do not skip the linter: a `modernize` finding never shows up in `go vet`, and
the CI round trip that catches it instead costs ten minutes.

**The targets are wrappers; the bodies are the commands.** The Windows/MSYS host
this tree is developed on has no GNU make or `golangci-lint` on `PATH`, so the
make lines above do not run there as written. Its equivalents, from the
repository root:

```bash
go run ./tools/repolint                 # make lint: the repolint half
CGO_ENABLED=0 go install "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(cat .golangci-version)"
golangci-lint run --timeout=5m ./...    # make lint: the linter half, after that install
go run ./tools/repolint -changed        # make check
```

The install needs an HTTPS proxy on that host — `proxy.golang.org` does not
answer a direct dial. It lands in `$(go env GOPATH)/bin`, which this host does
not put on `PATH`: add it there, or call the binary by that path.

A full repolint run reports every file over budget, including debt your change
never touched. To see only what your own edits owe:

```bash
make check
```

Repo-wide ceilings still report under a narrowed run, because a file can push
the tree past one without exceeding its own budget.

`make check` owns the evidence-bearing changed-file universe — everything the
worktree altered *and* everything it added that git has not been told about.
Never substitute a direct `go run ./tools/repolint` invocation for it when
recording verification evidence: the host recognizes a `make` target as a check
whose result it can read, while an arbitrary `go run ./tools/...` is a program
it has to assume writes, and the flags behind the target are its implementation
rather than the contract. Building that universe from `git diff` alone once let
a new file reach the gate unopened and be reported clean.

Where make is absent that evidence cannot be captured at all: record the direct
`go run` command and its output, and say it was not a `make` target.

On a clean worktree `-changed` narrows to nothing and reports the whole tree's
recorded debt — the same output as the full run, not a new failure.

## Import cycle rule

Before importing a new internal package from a non-test file, verify the target package's **test files** aren't already importing back to you:

```
# BAD: agent(_test.go) → tool/builtin(sessions.go) → agent  → setup failed
```

Use `go test ./path/to/target/` to detect cycles **before** pushing. A `[setup failed]` message means a cycle exists.

## PR hygiene

- **One force-push per round of review feedback.** Multiple force-pushes destroy review history and confuse reviewers.
- **Keep the PR diff minimal.** Only the files relevant to the PR's purpose — no stray changes from other branches.
- **Amend, don't add commits, for review feedback** — keeps the commit history clean.

## Change discipline

**Assess before editing.** For every change, humans and agents list callers,
consumers of the same state, sibling features, reload/replay/restart paths,
error and edge states, TUI/CLI and desktop equivalents, and wire mirrors.

A fix that breaks a neighbouring behaviour is a failed fix.

**Test the neighbourhood.** UI changes add or extend interaction tests for
adjacent functions of the same component or flow (composer: submit, clear,
queue, withdraw, restore, steer, failure, replay after reload) and run the whole
affected suite.

Write tests first; they must fail without the change.

**Fix at the owning layer.** Use the existing unified pattern: no special-case
flags, duplicated paths, or workarounds at the symptom site.

If the design is duplicated or wrong, make the smallest unifying change:
one path instead of two, deleting what becomes dead. Use current language and
framework idioms; do not add a new pattern where one exists.

**PR evidence.** Every PR description carries: Cause, Blast radius,
Neighbouring behaviours tested, and Why this layer.

## UI changes: see them in a browser, not through the kernel

A change that only touches `desktop/frontend-next` is verified by starting the
frontend and looking at it:

```
cd desktop/frontend-next && pnpm dev
```

That needs **no Go rebuild, no rebuilt kernel, and no packaged app**. With
`REASONIX_SERVE` unset, `vite.config.ts` boots the app on `MockPort`, so every
screen — workbench, settings, sidebar, panes — is reachable with no process
behind it. Rebuilding the kernel only to *look* at a stylesheet, a layout or a
component is the loop this rule removes.

Rebuild the backend only when the change actually crosses the wire: a new or
changed route, an SSE event, a `port.ts` method, or a Go type the frontend
reads. To click through against real data, point `REASONIX_SERVE` at a
`reasonix serve` that is **already running** — do not stand one up for the
occasion.

The gates do not move. `pnpm typecheck` and the affected interaction tests
still run before a change is called done; the browser is where the result is
seen, not what replaces them.

## Reasonix host checks

The paths below decide what the agent is allowed to do — a wrong change here
is not a bug in a feature, it is a hole in a boundary. Declaring them makes
every change under them demand `review` plus `security_review` before a turn
can finish. Sensitivity is declared, never inferred: the host does not read it
out of how a path is spelled, which cannot tell `internal/auth` from
`session_write_authority.go`, or a trace file from a data race.

- sensitive: internal/safety/permission/**
- sensitive: internal/safety/sandbox/**
- sensitive: internal/safety/shellsafe/**
- sensitive: internal/base/shellparse/**
- sensitive: internal/session/control/approval.go
- sensitive: internal/session/control/approval_bridge.go
- sensitive: internal/session/control/approval_orchestration.go
- sensitive: internal/model/providerbroker/**
- sensitive: internal/ext/installsource/**
- sensitive: internal/ext/plugin/**
- sensitive: internal/ext/pluginpkg/**
- sensitive: internal/base/netclient/**
- sensitive: internal/safety/redirectguard/**
- sensitive: internal/safety/endpointclient/**
- sensitive: internal/safety/egress/**
- sensitive: internal/platform/browser/**
- sensitive: internal/platform/computer/**
- sensitive: internal/platform/gitpush/**
- sensitive: internal/session/control/git_push.go
- sensitive: internal/frontend/serve/git_push.go
- sensitive: internal/frontend/serve/host_routes.go

One declaration, two effects: the same list is also the coverage gate's subject.
`make coverage-gate` holds each path to the coverage it already has, because
when this was written these paths sat *below* the tree's median rather than
above it — the code deciding what the agent may execute was its least-tested
part. Floors ratchet like repolint's budgets: raising one is free, lowering one
needs `-allow-drop` and a reason in the PR. Adding a `sensitive:` path gets both
effects; there is no second list to keep in sync.

## Trust domain

Three sets, kept apart because conflating them turns a performance number into a
security claim: **VerificationRelevant** (state that can change whether a
delivery claim holds), **Observable** (state the host can reconcile after an
action, so it can say what that action did), **HostProtected** (state a
capability/sandbox boundary makes unwritable). The invariant is
`Writable ∩ VerificationRelevant ⊆ Observable ∪ HostProtected`:

> Any state that can both be modified by an action and influence the delivery
> claim must either be observable by the host or protected from modification by
> host-enforced boundaries. An incomplete observation never establishes scope.

Effects and state answer different questions and never stand in for each other —
observation proves what an action did, verification proves what the resulting
state satisfies — which is why `unproven_mutation` is settled only by
observation, never by a check that ran afterwards.

What follows bounds Observable today. It is not a restatement of the invariant:
moving a number here must not move the promise.

- `scanWorkspace` walks the workspace and every granted extra root recursively,
  skips VCS store dirs, and is `complete` only below 50k files in total. Over that, or past a walk error, it
  establishes nothing and the mutation stays unproven.
- Symlinks are recorded by `Lstat`, so a write through one lands outside what
  the walk compares. Confining the resolved target is the sandbox's job.
- `internal/safety/sandbox` confines writes to the workspace, configured extras, temp
  and toolchain caches on macOS and Linux.
- On Windows a user-enabled write-restricted token bounds the *creation* of files
  (create, append, overwrite, `mkdir`, HKCU writes, global git config, writes through links).
- There, deleting or renaming away an existing file is not bounded, and with the
  setting off nothing the host enforces bounds `Writable`.
- The caches a command may write can be poisoned for the user's later unsandboxed
  builds, on every platform.
- The governed host authorities are a *named* set — ssh-agent, docker, podman.
  DBus, Wayland, X11, gpg-agent, keyrings and arbitrary sockets stay reachable,
  so the claim is "these endpoints are governed", never "host IPC is isolated".

`stateEpoch` tracks host-observed mutations, not an exact filesystem snapshot;
unobserved external writers are a gap shared by the whole verification model. Go
baseline test criteria use the toolchain's build overlay and therefore share
ordinary verification's epoch semantics; the overlay is not a general filesystem
view.

A captured criterion may be superseded only by authority outside
execution-mutable state; the current workspace, its tests, and the agent itself
cannot authorize supersession.

Two gaps follow and are open, not decided: a build that reads `.git` makes VCS
state VerificationRelevant while the scan skips it, and on Windows a symlink out
of the workspace is neither observed nor protected. Closing either means
widening observation or narrowing writability — never widening what a check is
taken to prove.

## Sandbox dimensions

`HostProtected` above is the delivery-level abstraction. Sandbox policy refines
it into three independent protection dimensions. Their separation is empirical:
measured bypasses showed that protection on one dimension cannot be assumed to
imply protection on another.

- **Integrity** — what host state may be mutated. Expressed by write roots.
- **Confidentiality** — what host information may be observed. Expressed by
  `ForbidReadRoots`.
- **Authority** — what host capabilities may be exercised *without* possessing
  their secrets. Expressed by `HostAuthorities`.

`ReadOnly` is therefore an Integrity property only; it makes no Confidentiality
or Authority claim.

Network transport and host authority are independent even when a backend
primitive conflates them: on macOS, `(deny network*)` also cut ssh-agent, so one
flag could not express "no internet, still sign".

Filesystem visibility is not authority: denying `file-read*` on a socket did not
stop a connect. Possession is not authority: the key can be unreadable while an
agent still signs with it.

A protection claim exists only where a backend has a demonstrated enforcement
primitive for that dimension. Unsupported dimensions stay explicitly unsupported,
because a claim that outruns its enforcement is worse than an absent one: it is
believed.

Windows enforces Integrity on file creation only, when the user turns it on.
Deletion and rename, Confidentiality and Authority (the named pipes of ssh-agent
and docker, COM and RPC services) are not enforced there.

**Known unmeasured surface — macOS host-mediated delegation:** Apple Events and
Mach-service lookup are not denied by the current allow-default profile. Prior
`osascript` and `launchctl submit` probes were inconclusive; no delegation
effect has been demonstrated. This surface is outside the currently governed
host-authority endpoint set.

## This repository: it picks up where upstream stopped

**Upstream stopped maintaining Studio at `studio-v2.61.0`** (commit `cd20bb50b`,
tagged 2026-11-11). This repository continues from exactly there. There is no
merge to follow, no release tag to track, and no upstream side to defer to: what
is here is what this project maintains.

### The shape of the history

The base is `72d7bc882` `chore: import upstream studio-v2.61.0` — that
release's tree, entire. Its tree hash is `79fc400ec`, which is
`cd20bb50b^{tree}`. Everything above it is this project's own work;
`git log --oneline 72d7bc882..HEAD` lists it.

The base is one tree rather than one commit's ancestry on purpose: the fork this
replaced merged twenty upstream release tags across 13000 commits, and none of
that says anything about what this project maintains. A base that is a single
tree is a base anyone can diff against — `git diff 72d7bc882 HEAD` is the whole
of what this project has done.

**Nothing is ever merged from `upstream` again.** If a future change is wanted
from a later upstream commit, it is read, understood and written here on its own
merit; it is not merged, and its authorship is not inherited.

### Branches

- `studio-dev` is the development branch and the checked-out line. It holds
  the whole tree — kernel, `desktop/` and `mobile/` — because a branch is a
  line of commits, not a directory.
- `studio` mirrors `origin/studio`, the release line. Do not develop on it.
- `reasonix-Android` was the old local name for the development line. It was
  renamed to `studio-dev` on 2026-11-24 because the name read as mobile-only
  while the branch carried every later kernel and desktop commit. Do not
  recreate it.
- Publishing pushes the development line onto the release line:
  `git -c http.proxy=http://127.0.0.1:7890 push origin studio-dev:studio`.
  The proxy is this workstation's; read the unpushed count from
  `git rev-list --count origin/studio..HEAD` instead of trusting a number
  written here.
- `origin/reasonix-Android` is the phone client's last release ref, not the
  development branch; it may trail `studio-dev`. The phone ships with the
  `studio-v*` release, so its tag is the repository owner's call.

### What this repository carries on top of 2.61.0

Three customisations predate the handover, and they stay. Everything else the
old fork ever carried had already gone back to upstream's shape before 2.61.0.

| Kept | Where |
| --- | --- |
| The quiet boot screen | `desktop/frontend-next/src/boot/intro.ts`, `index.html` |
| Black-tile / white-glyph icons | `desktop/electron/assets/icon.svg`, `public/icons/icon.svg` |
| The 2.58 workbench layout, not 2.61's | `studio.css`, `app.css`, `WorkbenchPanel.tsx`, `useTabClose.ts` |

The third is a regression repair, and it is a **layout revert**, not a patch.
Upstream 2.61 turned the workbench body into two side-by-side columns
(canvas | tree) in the dock as well as at full width, so opening the explorer
always leaves a second, empty column standing: with nothing picked it is a blank
panel, and with a file picked the tree eats a fixed column of a docked workbench
too narrow to afford one. Two later attempts to soften it — dropping the "Pick a
file on the left" prompt (`1223ca7`) and giving the list the whole body while
nothing was open (`79835f3`) — both left 2.61's structure in place, so the
empty column kept coming back in some state.

This repository therefore restores 2.58's shape: the canvas is the body and the
tree is a `clamp(190px, 25%, 300px)` column **on the right**, and in the dock the
two take turns in one column (`[data-files]` hides the canvas) so a file picked
from the list steps the list aside and closing that file brings it back
(`fromExplorer` in `useTabClose.ts`). The resizable tree column
(`ExplorerResize.tsx`, `--wb-tree-w`) went with 2.61's structure and is not
carried.

The 2.61 features that are not layout are kept: element picking still passes
`editPage` to the browser panels, and display math keeps its symmetric padding.

### Void: every other customisation

Listed so nobody re-adds one believing it was lost. All of these belong to the
base now, and stay the base's:

- **The icon column's default** — `navRailMode` returned `"off"` in the old
  fork's build; the base returns `"on"`. The base's stands.
- **The session filters' inset** — the measured `0 3.95px 8px -8.5px` alignment
  is gone; the base's `margin: 0 0 8px` stands.
- **Project rows** — the traced ZCode folder outline is gone; the base's
  `<StudioIcon name="folder" />` stands.
- **The wordmark lockup** — the 2.40.0 stacked lockup (21px indent, `.21em`) is
  gone; the base's single-row flex with its outlined `studio` badge stands,
  guarded by `styles/brand-badge.test.ts`.
- **Sidebar head and foot** — no-new-session-button, no-search-entry, the three
  centred footer icons and the hidden 连接与机器 row are all gone. Sidebar head
  and foot are the base's.
- **The cancelled-job ordering repair** in `internal/tools/jobs/run.go` — dropped
  at 2.58.0. A cancelled turn waits for the interrupted job's cleanup before the
  queue dispatches, so "立即发送" waits for the running action, as the base does.

Nothing on that list returns without replacing this section outright.

### Gates before a push

1. If `pnpm-lock.yaml` moved, `pnpm install` **before** running any gate —
   otherwise a missing module reads as a code failure. Cost one round already.
2. `pnpm typecheck`, `pnpm test`, `pnpm build`, `go build ./...`.
3. Package with the version this repository's own tag states (see below), and
   push both the commit and the tag.
4. The bundle must carry the CUA driver — see below. A bundle without it is not
   a release.

### The packaged bundle ships the CUA driver

`cua-driver` is what lets the agent see the screen and move the pointer on this
machine. It is a pinned third-party binary, not something this tree compiles:
`desktop/electron/packaging/install-cua-driver.js` fetches the artifact named in
`internal/platform/computer/cua-driver.lock.json`, checks its SHA-256, and
unpacks it to `desktop/electron/bin/`. `build:host` runs that step before the
kernel build, and `desktop/electron/electron-builder.yml` lists `cua-driver` /
`cua-driver.exe` in `extraResources`.

**Nothing fails loudly when it is missing.** `desktop/electron/src/main.js`
guards the launch with `existsSync`, `electron-builder` quietly skips a filtered
name that is not on disk, and the installer still builds and still runs — the
app simply cannot see the screen, and the capability disappears with no error
anywhere. The download is the step that times out (a GitHub release, 120s);
skipping it and building the kernel by hand produces exactly that silent
bundle. So do not skip it: re-run
`node desktop/electron/packaging/install-cua-driver.js` until it lands, then let
`build:host` finish normally.

Check the packed output, not the configuration. `desktop/electron/electron-builder.yml`
writes to `../../dist` relative to itself, so a packaged Windows bundle lands in
`studio/dist/win-unpacked` — run this from `studio/`:

    ls dist/*/resources/bin/   # cua-driver(.exe) beside reasonix-studio-host(.exe)

### What goes wrong when a customisation is dropped

Deleting a customisation is not just deleting its markup. Three things have to
move with it, or the tree ends up worse than before:

- **Fork-only stylesheets that override by load order.** `railfoot.css` did
  this: loaded after `studio.css`, its `.railfoot { justify-content: center }`
  would have flattened the labelled column even after the footer went back to
  the base markup. It was deleted with the customisation.
- **Fork-only tests that pin the dropped value.** `brand-lockup.test.ts` asserted
  the 2.40.0 grid and the 21px indent; it was deleted, and `brand-badge.test.ts`
  took its place.
- **Tests rewritten** to match an old shape — `navrail`, `files-navigation`,
  `session-new`, `sidebar-machines`, `Account`. Each was restored with
  `git show <commit>:<path>`, not hand-edited.

Also check for `LOCAL FORK:` comments that outlive their customisation; a comment
pointing at a deleted stylesheet is worse than no comment. After the two kept
customisations, `grep -rn "LOCAL FORK" desktop/frontend-next/src/` returns
**nothing** — neither kept item needs a marker, because neither departs from the
base markup.

Done once, before the handover, when six customisations became two.

## The icon

**Every icon this repository ships is black-on-white** — tile pure `#000000`,
glyph pure `#ffffff`, built the way `zai-org/ZCode`'s mark is. The shape is the
project's own R and whale; only the colours differ. Any new place that needs
the mark derives from these sources rather than drawing its own.

Two source SVGs. **No icon file is ever hand-edited** — the rasterised ones are
outputs, and each script overwrites them on its next run:

| What | Source | Regenerate with |
| --- | --- | --- |
| Desktop, taskbar, installer, tray | `desktop/electron/assets/icon.svg` | `cd desktop/electron && node packaging/icons.js` |
| Web and PWA | `desktop/frontend-next/public/icons/icon.svg` | `cd desktop/frontend-next && node tools/icons.mjs` |

The first script is the base's: it writes `icon.png`, `icon.ico` (8 sizes),
`icon.icns` (10 slots) and `tray*.png` (7 scales). The second is this
repository's own — the base kept those four PNGs by hand, so `tools/icons.mjs`
was added to give them the same one-source treatment.

Changing the icon means editing the source SVG, running its script, and
**repackaging**: an installer built before that still carries the old icon.

## Version numbers: this repository's own, from 2.70.0

**A build's version is this repository's, not upstream's, and it starts above
2.61.0.** The first tag here is `studio-v2.70.0`. The jump is deliberate: a
version at or below `2.61.0` sorts behind the release the in-app updater still
offers, so the app would invite a person to "update" into the official 2.61.0
build and throw away everything above the base.

The version is injected, never committed: `REASONIX_VERSION` for the kernel and
`-c.extraMetadata.version` for the bundle, so no tracked file carries it and
`package.json` stays at `0.0.0`. Package with the tag's own number —
`studio-v2.70.0` → `2.70.0`.

Releases go up in `2.70.x` for fixes and `2.7x.0` for features. There is no
`-fork` suffix, no `+build` metadata and no `.1` tail: one number, one tag, one
build, so `git describe --tags` names exactly what a person is running.

**参照 ZCode 时只看项目副本**：需要读它的样式或组件结构时，先克隆一份到
`tmp/zcode-repo`（`cd tmp && git clone --depth 1 https://github.com/zai-org/ZCode.git zcode-repo`），
用完可以整目录删掉。这个副本不随仓库保留：它只是参考资料，不是本仓库的一部分。
不要翻本机安装目录里的 `app.asar`——那是打包产物，只有压缩后的代码，读不出源码意图，
也查不到设计令牌与组件结构；需要「按 ZCode 的样式做」时，依据必须来自这份克隆。
