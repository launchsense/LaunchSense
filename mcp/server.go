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
	"sort"
	"strings"
	"sync"
	"time"
)

// maxMessageBytes bounds one JSON-RPC message. The MCP stdio transport frames a
// message as one line of JSON with no length header, so the line itself is the
// only bound on memory. 4 MiB is far above any initialize or tools/call this
// server sends or receives. A longer line is refused before its bytes are kept,
// and the rest of it is drained so the next message still starts on a newline.
const maxMessageBytes = 4 << 20

// maxReportBytes bounds one report body from the API. A body that reaches this
// limit is reported as a partial answer, never returned as a whole report.
const maxReportBytes = 1 << 20

// apiTimeout bounds one call to the LaunchSense API. review-entry.ts gives its
// own fetch the same 8 seconds. The stdio loop answers one message at a time, so
// an endpoint that accepts and never answers would otherwise take ping down
// with it.
const apiTimeout = 8 * time.Second

// rpcRequest is the JSON-RPC envelope plus the request itself. jsonrpc and id are
// kept as raw JSON on purpose: an envelope has to be inspected before any method
// runs, and decoding "2.0" straight into a string loses the difference between a
// correct envelope and one carrying a number.
type rpcRequest struct {
	JSONRPC json.RawMessage `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type toolCall struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type accountFunc func() (Account, error)

type reviewFunc func(root string) (string, error)

// supportedProtocolVersions is the set this server negotiates. It is the same
// four the hosted surface serves (convex/mcpHttp.ts), so one client library
// works against both.
var supportedProtocolVersions = []string{"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}

// defaultProtocolVersion is answered when the client asks for nothing, or for
// something this server does not implement. A client that asked for a version
// this server does not have is answered with one it does, rather than refused:
// the client's own choice is not the only way to find out what is on offer.
const defaultProtocolVersion = "2025-03-26"

type server struct {
	apiURL  string
	account accountFunc
	client  *http.Client
	review  reviewFunc
	// errOut carries one line per refused or unparsable message. stdout carries
	// protocol only, so a client reading stdout never sees a log line.
	errOut io.Writer

	// mu guards the session state below. The state is read on the reader loop and
	// written only there, so it is the reader's state; the mutex is what lets the
	// handlers that answer concurrently read it safely.
	mu          sync.Mutex
	initialized bool
	protocol    string

	// outMu guards every write to stdout. Two answers must never interleave into
	// one line, which is the whole framing contract of this transport.
	outMu sync.Mutex
	out   io.Writer

	// wg counts the handlers this session started, so serve can report honestly
	// about what was in flight when stdin closed.
	wg sync.WaitGroup
}

func newServer() *server {
	apiURL := os.Getenv("LAUNCHSENSE_API_URL")
	if apiURL == "" {
		apiURL = "https://harmless-chihuahua-667.convex.site"
	}
	return &server{
		apiURL:   strings.TrimRight(apiURL, "/"),
		account:  localAccount,
		client:   &http.Client{Timeout: apiTimeout},
		errOut:   os.Stderr,
		protocol: defaultProtocolVersion,
	}
}

// logf writes one line to stderr when a stderr writer is set. A nil writer is
// the quiet case, used by tests that only read stdout. errMu is the same guard
// writeResult uses, because a log line and an answer can be written at the same
// moment once the loop is concurrent.
func (s *server) logf(format string, args ...any) {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	if s.errOut == nil {
		return
	}
	fmt.Fprintf(s.errOut, "launchsense-mcp: "+format+"\n", args...)
}

// serve reads one JSON message per line and writes one JSON message per line.
// That is the MCP stdio transport: no length header, no embedded newline, a
// blank line is not a message.
//
// Each message is handled in its own goroutine, so a slow tool call does not hold
// up the messages behind it: a ping during a ten minute local review still
// answers, and a client that uses ping as a liveness probe no longer concludes
// the process is dead. Two things keep that honest. The lifecycle and envelope
// checks run on this loop, in arrival order, so a client that wrote initialize
// and then its next request in one write has both messages admitted in that
// order, which is what the session rules depend on. And every write to stdout is
// guarded for the whole of one message, so two answers cannot interleave into one
// broken line.
//
// Answers are therefore not in request order, which is normal for a concurrent
// server: MCP identifies every answer by its id, so a client matches the answer to
// the request by id and not by position.
//
// When stdin closes the session is over, and serve waits for the answers already
// in flight before it returns. A client that writes a request and closes its pipe
// straight after still gets its answer, which is what every stdio client does when
// it has nothing more to send. That wait is bounded by the tools themselves, so the
// slowest one this server has is the ten minute local review budget.
func (s *server) serve(in io.Reader, out io.Writer) error {
	s.outMu.Lock()
	s.out = out
	s.outMu.Unlock()

	reader := bufio.NewReaderSize(in, 64*1024)
	for {
		line, oversize, err := readMessage(reader)
		if err == io.EOF {
			s.wg.Wait()
			return nil
		}
		if err != nil {
			return err
		}
		if !oversize && len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		if oversize {
			s.logf("message over the %d byte limit was refused", maxMessageBytes)
			if err := s.answer(nil, nil, &rpcError{
				Code:    -32600,
				Message: fmt.Sprintf("Message too large. The limit is %d bytes (4 MiB) and nothing was run.", maxMessageBytes),
			}); err != nil {
				return err
			}
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal(line, &req); err != nil {
			s.logf("parse error: %v", err)
			if err := s.answer(nil, nil, &rpcError{
				Code:    -32700,
				Message: "Parse error. The line was not one JSON message, so nothing was run.",
			}); err != nil {
				return err
			}
			continue
		}

		// A message with no id member at all is a notification: it is run, and it
		// is never answered. An id that is present and null is a request, and is
		// answered with id null, which is what JSON-RPC 2.0 says about a null id.
		// Treating the two the same left a client that sent id null waiting with
		// nothing on stderr to say why.
		notification := len(req.ID) == 0

		if rpcErr := s.begin(req); rpcErr != nil {
			if notification {
				// A notification has no id, so there is nothing to answer with. One
				// line on stderr is the only honest place for the refusal.
				s.logf("%s was not run: %s", req.Method, rpcErr.Message)
				continue
			}
			if err := s.answer(req.ID, nil, rpcErr); err != nil {
				return err
			}
			continue
		}

		s.wg.Add(1)
		go func(req rpcRequest, notification bool) {
			defer s.wg.Done()
			result, rpcErr := s.handle(req)
			if notification {
				return
			}
			if err := s.answer(req.ID, result, rpcErr); err != nil {
				s.logf("answer not written: %v", err)
			}
		}(req, notification)
	}
}

// begin runs the envelope and lifecycle checks on the reader loop, in arrival
// order, and returns the error to answer with, or nil to run the message. It
// changes the session state as a side effect: the one initialize a session gets
// is accepted here, before its handler runs, so a client that wrote initialize
// and its next request in one write has both admitted in that order and neither
// is refused for arriving before the handshake.
func (s *server) begin(req rpcRequest) *rpcError {
	if rpcErr := validateEnvelope(req); rpcErr != nil {
		return rpcErr
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case req.Method == "initialize":
		if s.initialized {
			return &rpcError{
				Code:    -32600,
				Message: "Already initialized. This server answers one initialize per session, because the tools and capabilities after it are the same every time. Start a new session, that is a new process, to negotiate again.",
			}
		}
		s.initialized = true
		s.protocol = negotiateProtocol(req.Params)
		return nil
	case req.Method == "ping":
		// ping is how a client asks whether the process is alive, so it answers
		// before the handshake and after it.
		return nil
	case !s.initialized:
		return &rpcError{
			Code:    -32002,
			Message: "Server not initialized. Send initialize first. ping is the only method that answers before it.",
		}
	default:
		return nil
	}
}

// validateEnvelope checks the two parts of a JSON-RPC 2.0 message that make it a
// request at all: the version and the id. A message that fails either is
// answered Invalid Request and no method runs, because a message that is not a
// JSON-RPC 2.0 request cannot be answered as one.
func validateEnvelope(req rpcRequest) *rpcError {
	if len(req.JSONRPC) == 0 {
		return &rpcError{
			Code:    -32600,
			Message: `Invalid Request. The jsonrpc member is missing. Every JSON-RPC 2.0 message must carry "jsonrpc":"2.0".`,
		}
	}
	var version string
	if err := json.Unmarshal(req.JSONRPC, &version); err != nil {
		return &rpcError{
			Code:    -32600,
			Message: `Invalid Request. The jsonrpc member must be the string "2.0", not a number, an array or an object.`,
		}
	}
	if version != "2.0" {
		return &rpcError{
			Code:    -32600,
			Message: fmt.Sprintf(`Invalid Request. The jsonrpc member must be "2.0". This server speaks JSON-RPC %s.`, version),
		}
	}
	if len(req.ID) == 0 {
		return nil
	}
	if !validID(req.ID) {
		got, err := jsonTypeOf(req.ID)
		if err != nil {
			got = "a value that is not valid JSON"
		}
		return &rpcError{
			Code:    -32600,
			Message: fmt.Sprintf("Invalid Request. The id member must be a string, a number or null. Got %s. The id is echoed back unchanged on every answer, so a wrong one is a mistake worth naming rather than passing along.", got),
		}
	}
	return nil
}

// validID reports whether an id is one JSON-RPC 2.0 allows: a string, a number,
// or null. An object or an array is refused, because echoing an object back as
// the id of an answer is not something the spec describes.
func validID(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return false
	}
	switch trimmed[0] {
	case '"':
		var text string
		return json.Unmarshal(trimmed, &text) == nil
	case 'n':
		return string(trimmed) == "null"
	case 't', 'f', '{', '[':
		return false
	default:
		var number json.Number
		return json.Unmarshal(trimmed, &number) == nil
	}
}

// negotiateProtocol answers the version the client asked for when this server
// serves it, and the default otherwise. It mirrors supportedVersion in
// convex/mcpHttp.ts, so both surfaces accept the same clients.
func negotiateProtocol(params json.RawMessage) string {
	var asked struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if len(params) == 0 {
		return defaultProtocolVersion
	}
	if err := json.Unmarshal(params, &asked); err != nil {
		return defaultProtocolVersion
	}
	for _, version := range supportedProtocolVersions {
		if asked.ProtocolVersion == version {
			return version
		}
	}
	return defaultProtocolVersion
}

// answer writes one JSON-RPC message under the stdout guard.
func (s *server) answer(id json.RawMessage, result any, rpcErr *rpcError) error {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	return writeResult(s.out, id, result, rpcErr)
}

// readMessage reads one newline-terminated line. It reports an oversize line
// instead of keeping it: the remainder is drained to the newline so the next
// read starts on a message boundary. A final line with no newline is still a
// message, which is what a client that closed its pipe sent.
func readMessage(r *bufio.Reader) (line []byte, oversize bool, err error) {
	total := 0
	for {
		chunk, readErr := r.ReadSlice('\n')
		total += len(chunk)
		if total > maxMessageBytes {
			oversize = true
			line = nil
		} else if !oversize {
			line = append(line, chunk...)
		}
		if readErr == bufio.ErrBufferFull {
			continue
		}
		if readErr == io.EOF && (line != nil || oversize) {
			// A client that closed its pipe may leave the last line unterminated.
			// It is still a message, and the next read reports the EOF.
			return bytes.TrimRight(line, "\r\n"), oversize, nil
		}
		if readErr != nil {
			return nil, false, readErr
		}
		return bytes.TrimRight(line, "\r\n"), oversize, nil
	}
}

func (s *server) handle(req rpcRequest) (any, *rpcError) {
	switch req.Method {
	case "initialize":
		s.mu.Lock()
		version := s.protocol
		s.mu.Unlock()
		return map[string]any{
			"protocolVersion": version,
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
		def, known := toolDef(call.Name)
		if !known {
			// isError means a tool ran and failed. A name this server does not
			// have is a protocol error, and the spec's own example is -32602.
			return nil, &rpcError{Code: -32602, Message: "Unknown tool: " + call.Name}
		}
		if schema, ok := def["inputSchema"].(map[string]any); ok {
			if err := validateArgs(schema, call.Arguments); err != nil {
				return nil, &rpcError{
					Code:    -32602,
					Message: "Invalid arguments for " + call.Name + ": " + err.Error(),
				}
			}
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

// toolDef is the published definition of one tool. tools/list sends it and the
// argument check reads it, so the schema a client reads is the schema that is
// enforced.
func toolDef(name string) (map[string]any, bool) {
	for _, def := range toolDefs() {
		if def["name"] == name {
			return def, true
		}
	}
	return nil, false
}

// validateArgs checks the arguments against the schema the tool publishes. A
// missing required field, a wrong JSON type, and an undeclared field are three
// different mistakes and each answer says which one it is, instead of calling
// every one of them a missing field or quietly running with the extra ignored.
func validateArgs(schema map[string]any, raw json.RawMessage) error {
	args := map[string]json.RawMessage{}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) > 0 && string(trimmed) != "null" {
		if err := json.Unmarshal(trimmed, &args); err != nil {
			return fmt.Errorf("arguments must be a JSON object")
		}
	}
	props, _ := schema["properties"].(map[string]any)
	for _, name := range requiredNames(schema) {
		value, ok := args[name]
		if !ok || isEmptyValue(value) {
			return fmt.Errorf("%s is required", name)
		}
	}
	// A schema that does not say otherwise is treated as closed. Every schema
	// this server publishes sets additionalProperties, and an argument no tool
	// declares is a mistake worth reporting rather than a field to drop.
	closed := true
	if flag, ok := schema["additionalProperties"].(bool); ok {
		closed = !flag
	}
	for _, name := range sortedNames(args) {
		declared, ok := props[name].(map[string]any)
		if !ok {
			if len(props) == 0 {
				return fmt.Errorf("unexpected property %s. This tool takes no arguments.", name)
			}
			return fmt.Errorf("unexpected property %s. Declared properties: %s", name, strings.Join(sortedKeys(props), ", "))
		}
		if !closed {
			continue
		}
		want, _ := declared["type"].(string)
		got, err := jsonTypeOf(args[name])
		if err != nil {
			return err
		}
		if want != "" && got != want {
			return fmt.Errorf("%s must be a %s, got %s", name, want, got)
		}
	}
	return nil
}

func requiredNames(schema map[string]any) []string {
	raw, ok := schema["required"].([]string)
	if !ok {
		return nil
	}
	return raw
}

func sortedNames(values map[string]json.RawMessage) []string {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// isEmptyValue reports a field that is absent, null, or a blank string. A blank
// scan id is no more usable than a missing one, and it says so the same way.
func isEmptyValue(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return true
	}
	if trimmed[0] == '"' {
		var text string
		if err := json.Unmarshal(trimmed, &text); err == nil {
			return strings.TrimSpace(text) == ""
		}
	}
	return false
}

func jsonTypeOf(raw json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return "", fmt.Errorf("a value is missing")
	}
	switch trimmed[0] {
	case '"':
		return "string", nil
	case '{':
		return "object", nil
	case '[':
		return "array", nil
	case 't', 'f':
		return "boolean", nil
	case 'n':
		return "null", nil
	default:
		return "number", nil
	}
}

func toolDefs() []map[string]any {
	return []map[string]any{
		{
			// The hosted server really reads a public repo under this name. A
			// local tool of that name that reads nothing is how a scan gets
			// reported that never happened, so this one says where the hosted
			// read lives and is named so it cannot be mistaken for it.
			"name":        "launchsense_scan_public_notice",
			"description": "Does nothing by itself. It names where the public repo read actually lives: the website, or the hosted MCP address. This server reads only files on this machine and never downloads GitHub.",
			"inputSchema": objectSchema(map[string]any{}),
		},
		{
			"name":        "launchsense_report",
			"description": "Read a LaunchSense report by scan id.",
			"inputSchema": objectSchema(map[string]any{
				"scanId": map[string]any{"type": "string", "description": "The scan id the website or the hosted address gave you."},
			}, "scanId"),
		},
		{
			"name":        "launchsense_github",
			"description": "See if gh is logged in on this machine, and which repo is open. Does not send a token anywhere.",
			"inputSchema": objectSchema(map[string]any{}),
		},
		{
			"name":        "launchsense_scan_repo",
			"description": "Review the files already on this machine, under LAUNCHSENSE_ROOT. Does not download GitHub. Alpha has no login.",
			"inputSchema": objectSchema(map[string]any{}),
		},
	}
}

// objectSchema publishes a closed object schema. A closed schema is what makes
// an argument the server does not use a visible mistake rather than a silent
// no-op.
func objectSchema(props map[string]any, required ...string) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"properties":           props,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func (s *server) callTool(call toolCall) (string, error) {
	switch call.Name {
	case "launchsense_scan_public_notice":
		return "The public paste is the website, and the hosted address reads a public repo too: " +
			"https://harmless-chihuahua-667.convex.site/mcp\n" +
			"This server reviews the files on this machine and does not download GitHub. " +
			"Use launchsense_scan_repo for the checkout.", nil
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
		return s.scanRepo()
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

// scanRepo reviews the checkout named by LAUNCHSENSE_ROOT. It takes no arguments
// on purpose: it reads files on this machine, so a repository URL would be a
// promise this tool cannot keep. A caller that sends one is told by the argument
// check rather than quietly ignored.
func (s *server) scanRepo() (string, error) {
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
	// One byte past the cap, so a body that is exactly at the cap is whole and a
	// body that crosses it is known to be clipped rather than assumed complete.
	data, err := io.ReadAll(io.LimitReader(res.Body, maxReportBytes+1))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("LaunchSense API error %d", res.StatusCode)
	}
	if len(data) > maxReportBytes {
		return nil, fmt.Errorf(
			"the report body is over %d bytes and was cut off, so this is a partial answer and not a report. Ask again for a smaller scan, or read the report on the website.",
			maxReportBytes,
		)
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

// writeResult writes one JSON-RPC message and a newline, in one call to out.
// A nil id writes null, which is what a parse error has to answer with because
// no id could be read. json.Marshal escapes every newline inside a string, so a
// message can never break the line framing.
//
// The message and its newline are one byte slice handed to one Write, and the
// caller holds the stdout guard across it. That is what makes a line atomic:
// two answers can be produced at the same moment by two goroutines, and if
// either one wrote the body and the newline separately another answer could land
// between them and turn two valid messages into one broken line.
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
	line := make([]byte, 0, len(body)+1)
	line = append(line, body...)
	line = append(line, '\n')
	_, err = out.Write(line)
	return err
}
