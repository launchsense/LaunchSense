package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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
	root, err := os.Getwd()
	if err != nil {
		return "", err
	}
	run := s.review
	if run == nil {
		run = runNodeReview
	}
	return run(root)
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
