package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type toolCall struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type accountFunc func() (Account, error)
type privateFunc func(owner, name string) (bool, error)

type reviewFunc func(root string) (string, error)

type server struct {
	apiURL  string
	account accountFunc
	private privateFunc
	client  *http.Client
	review  reviewFunc
}

func newServer() *server {
	apiURL := os.Getenv("LAUNCHSENSE_API_URL")
	if apiURL == "" {
		apiURL = "https://harmless-chihuahua-667.convex.site"
	}
	return &server{
		apiURL:  strings.TrimRight(apiURL, "/"),
		account: localAccount,
		private: lookupRepo,
		client:  http.DefaultClient,
	}
}

func (s *server) serve(in io.Reader, out io.Writer) error {
	reader := bufio.NewReader(in)
	for {
		body, err := readFrame(reader)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		var req rpcRequest
		if err := json.Unmarshal(body, &req); err != nil {
			continue
		}
		if len(req.ID) == 0 || string(req.ID) == "null" {
			continue
		}
		result, rpcErr := s.handle(req)
		if err := writeResult(out, req.ID, result, rpcErr); err != nil {
			return err
		}
	}
}

func (s *server) handle(req rpcRequest) (any, *rpcError) {
	switch req.Method {
	case "initialize":
		return map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]string{"name": "launchsense", "version": "0.1.0"},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": toolDefs()}, nil
	case "tools/call":
		var call toolCall
		if err := json.Unmarshal(req.Params, &call); err != nil {
			return nil, &rpcError{Code: -32602, Message: "Invalid tool call."}
		}
		text, err := s.callTool(call)
		if err != nil {
			return toolText(err.Error(), true), nil
		}
		return toolText(text, false), nil
	default:
		return nil, &rpcError{Code: -32601, Message: "Method not found."}
	}
}

func toolDefs() []map[string]any {
	return []map[string]any{
		{
			"name":        "launchsense_scan_public",
			"description": "Points at the website paste. This tool does not download GitHub.",
			"inputSchema": objectSchema(map[string]any{
				"repoUrl": map[string]any{"type": "string", "description": "https://github.com/owner/repo"},
			}, "repoUrl"),
		},
		{
			"name":        "launchsense_report",
			"description": "Read a LaunchSense report by scan id.",
			"inputSchema": objectSchema(map[string]any{
				"scanId": map[string]any{"type": "string"},
			}, "scanId"),
		},
		{
			"name":        "launchsense_github",
			"description": "See if gh is logged in on this machine, and which repo is open. Does not send a token anywhere.",
			"inputSchema": objectSchema(map[string]any{}, ""),
		},
		{
			"name":        "launchsense_scan_repo",
			"description": "Review the files already on this machine. Does not download GitHub. Alpha has no login.",
			"inputSchema": objectSchema(map[string]any{
				"repoUrl": map[string]any{"type": "string", "description": "Optional. Defaults to the repo gh sees as current."},
			}, ""),
		},
	}
}

func objectSchema(props map[string]any, required string) map[string]any {
	schema := map[string]any{"type": "object", "properties": props}
	if required != "" {
		schema["required"] = []string{required}
	}
	return schema
}

func (s *server) callTool(call toolCall) (string, error) {
	switch call.Name {
	case "launchsense_scan_public":
		return "The public paste is the website. This tool reviews the files on this machine and does not download GitHub.", nil
	case "launchsense_report":
		var args struct {
			ScanID string `json:"scanId"`
		}
		if err := json.Unmarshal(call.Arguments, &args); err != nil || strings.TrimSpace(args.ScanID) == "" {
			return "", fmt.Errorf("scanId is required")
		}
		raw, err := s.postJSON("/api/mcp/report", map[string]string{"scanId": args.ScanID})
		if err != nil {
			return "", err
		}
		return string(raw), nil
	case "launchsense_github":
		return s.githubStatus()
	case "launchsense_scan_repo":
		var args struct {
			RepoURL string `json:"repoUrl"`
		}
		_ = json.Unmarshal(call.Arguments, &args)
		return s.scanRepo(strings.TrimSpace(args.RepoURL))
	default:
		return "", fmt.Errorf("unknown tool %s", call.Name)
	}
}

func (s *server) githubStatus() (string, error) {
	account, err := s.account()
	if err != nil {
		return "", err
	}
	return accountText(account), nil
}

func accountText(account Account) string {
	if !account.LoggedIn {
		return "gh is not logged in on this machine.\nRun: gh auth login\nThen ask again. The website Sign in button is not this login."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Logged in to GitHub as %s.\n", account.Login)
	if account.Repo() == "" {
		b.WriteString("No current repo. Pass a github.com URL, or run this inside a checkout.\n")
	} else if account.Private {
		fmt.Fprintf(&b, "Current repo %s is private. The local review can read a checkout on this machine. It does not send a token.\n", account.Repo())
	} else {
		fmt.Fprintf(&b, "Current repo %s is public.\n", account.Repo())
	}
	b.WriteString("The local review reads files on this machine. It does not download GitHub. Alpha has no login.")
	return b.String()
}

func (s *server) scanRepo(string) (string, error) {
	root, err := reviewRoot()
	if err != nil {
		return "", err
	}
	run := s.review
	if run == nil {
		run = runNodeReview
	}
	// A root that is not a checkout is announced before the report, and the same
	// line goes on an error, so a review of the wrong folder is never a quiet
	// confident answer.
	note := reviewRootNote(root)
	text, err := run(root)
	if err != nil {
		if note == "" {
			return "", err
		}
		return "", fmt.Errorf("%s\n%w", note, err)
	}
	if note == "" {
		return text, nil
	}
	return note + "\n" + text, nil
}

// reviewRoot is the checkout the local server reads. The installer starts this
// server with cwd = <checkout>/mcp, so the process folder is the mcp module and
// reviewing it would read a handful of Go files instead of the checkout.
// LAUNCHSENSE_ROOT names the checkout and the installer sets it. It must be an
// absolute path: resolving a relative one against the process folder is how the
// mcp module folder passes as a checkout, so it is refused instead. Without the
// variable: a process folder that is this repository's Go module means the
// checkout is its parent, then the same test on the executable folder (a built
// binary that sits in mcp/), then the process folder as it was before.
func reviewRoot() (string, error) {
	if named := strings.TrimSpace(os.Getenv("LAUNCHSENSE_ROOT")); named != "" {
		if !filepath.IsAbs(named) {
			return "", fmt.Errorf(
				"LAUNCHSENSE_ROOT must be an absolute path, got %q. A relative path is resolved against the folder the server was started in, which is this server's own mcp module, so the review would read that folder instead of the checkout. Set LAUNCHSENSE_ROOT to the absolute checkout root, for example /home/you/launchsense",
				named,
			)
		}
		root, err := filepath.Abs(named)
		if err != nil {
			return "", fmt.Errorf("LAUNCHSENSE_ROOT cannot be resolved: %w", err)
		}
		info, err := os.Stat(root)
		if err != nil {
			return "", fmt.Errorf("LAUNCHSENSE_ROOT is not readable: %w", err)
		}
		if !info.IsDir() {
			return "", fmt.Errorf("LAUNCHSENSE_ROOT is not a folder")
		}
		return root, nil
	}
	if cwd, err := os.Getwd(); err == nil {
		if checkout := checkoutAbove(cwd); checkout != "" {
			return checkout, nil
		}
	}
	if exe, err := os.Executable(); err == nil {
		folder := filepath.Dir(exe)
		if checkout := checkoutAbove(folder); checkout != "" {
			return checkout, nil
		}
		return folder, nil
	}
	return os.Getwd()
}

// looksLikeCheckout reports whether root holds a LaunchSense checkout. The Go
// module lives in mcp/, so a checkout has mcp/review-entry.ts and mcp/go.mod.
// The markers are a shape check, not a proof: they exist so an honest checkout
// is quiet and an unfamiliar folder is named.
func looksLikeCheckout(root string) bool {
	for _, marker := range []string{
		filepath.Join(root, "mcp", "review-entry.ts"),
		filepath.Join(root, "mcp", "go.mod"),
		filepath.Join(root, "go.mod"),
	} {
		if _, err := os.Stat(marker); err == nil {
			return true
		}
	}
	return false
}

// reviewRootNote names the folder the review read when that folder is not a
// checkout. A wrong root is otherwise invisible: the report is a confident
// review of whatever that folder held, and the reader never learns which folder
// it was. A checkout gets no line, so the normal case stays quiet.
func reviewRootNote(root string) string {
	if looksLikeCheckout(root) {
		return ""
	}
	return fmt.Sprintf(
		"Reviewed folder: %s\nThat folder is what the review read. It has no mcp/review-entry.ts and no go.mod, so it is not a LaunchSense checkout. If this is the wrong folder, set LAUNCHSENSE_ROOT to the absolute checkout root and ask again.",
		root,
	)
}

// checkoutAbove returns the checkout that owns folder, or "" when folder is not
// this repository's Go module. The go.mod is what marks the module folder, so a
// folder that only shares its name does not count, and a checkout at the file
// system root has no parent to name.
func checkoutAbove(folder string) string {
	manifest, err := os.ReadFile(filepath.Join(folder, "go.mod"))
	if err != nil {
		return ""
	}
	if !strings.Contains(string(manifest), "module launchsense/mcp") {
		return ""
	}
	parent := filepath.Dir(folder)
	if parent == folder {
		return ""
	}
	return parent
}

func resolveRepo(repoURL string, account Account) (string, string, error) {
	if repoURL == "" {
		if account.Repo() == "" {
			return "", "", fmt.Errorf("no repo URL, and gh has no current repo")
		}
		return account.Owner, account.Name, nil
	}
	owner, name, ok := parseGitHubURL(repoURL)
	if !ok {
		return "", "", fmt.Errorf("repoUrl must look like https://github.com/owner/repo")
	}
	return owner, name, nil
}

func parseGitHubURL(raw string) (string, string, bool) {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "https://")
	trimmed = strings.TrimPrefix(trimmed, "http://")
	trimmed = strings.TrimPrefix(trimmed, "github.com/")
	trimmed = strings.Trim(trimmed, "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	name := strings.TrimSuffix(parts[1], ".git")
	return parts[0], name, true
}

func (s *server) postJSON(path string, body any) ([]byte, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, s.apiURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("LaunchSense API error %d", res.StatusCode)
	}
	return data, nil
}

func toolText(text string, isError bool) map[string]any {
	return map[string]any{
		"content": []map[string]string{{"type": "text", "text": text}},
		"isError": isError,
	}
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func writeResult(out io.Writer, id json.RawMessage, result any, rpcErr *rpcError) error {
	msg := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(id)}
	if rpcErr != nil {
		msg["error"] = rpcErr
	} else {
		msg["result"] = result
	}
	body, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "Content-Length: %d\r\n\r\n%s", len(body), body)
	return err
}

func readFrame(r *bufio.Reader) ([]byte, error) {
	length := -1
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(line), "content-length:") {
			fmt.Sscanf(strings.TrimSpace(line[len("content-length:"):]), "%d", &length)
		}
	}
	if length < 0 {
		return nil, fmt.Errorf("missing Content-Length")
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}
