package serve

// OpenRequest creates a fresh runtime or focuses the owner of SessionPath.
type OpenRequest struct {
	AgentComposition string `json:"agentComposition,omitempty"`
	Root             string `json:"root"`
	SessionPath      string `json:"sessionPath"`
	Model            string `json:"model"`
	// NoProject asks for a pane belonging to no project: the app's own folder.
	// Separate from an empty Root, which is a question the hub answers by
	// guessing (the first pane's folder) — the guess a new task must not inherit.
	NoProject bool `json:"noProject,omitempty"`
}

type RuntimeView struct {
	AgentComposition *compositionSummary `json:"agentComposition,omitempty"`
	ID               string              `json:"id"`
	Base             string              `json:"base"`
	Root             string              `json:"root"`
	Name             string              `json:"name"`
	SessionPath      string              `json:"sessionPath,omitempty"`
	Host             string              `json:"host,omitempty"`
	ReadOnly         bool                `json:"readOnly,omitempty"`
	// NoProject marks a pane belonging to no project: the app's own folder. The
	// next 新建会话 may reuse it for that reason alone — an empty pane inside
	// someone's project is somewhere else.
	NoProject bool `json:"noProject,omitempty"`
}
