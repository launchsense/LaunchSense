package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalReviewDoesNotCallGitHub(t *testing.T) {
	s := &server{
		apiURL:  "https://example.test",
		account: func() (Account, error) { return Account{}, nil },
		private: func(string, string) (bool, error) { return true, nil },
		review: func(string) (string, error) {
			return "LaunchSense alpha review. The job runs on the files on this machine.", nil
		},
		client: &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
			t.Fatal("local review must not call the network")
			return nil, nil
		})},
	}
	text, err := s.scanRepo()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "on this machine") {
		t.Fatalf("text = %s", text)
	}
}

func TestPrivateCheckoutStillReviewsLocalFiles(t *testing.T) {
	s := &server{
		account: func() (Account, error) {
			return Account{LoggedIn: true, Login: "ada", Owner: "ada", Name: "secret", Private: true, Host: "github.com"}, nil
		},
		private: func(string, string) (bool, error) { return true, nil },
		review:  func(string) (string, error) { return "local files", nil },
		client: &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
			t.Fatal("a private checkout must not call GitHub")
			return nil, nil
		})},
	}
	text, err := s.scanRepo()
	if err != nil {
		t.Fatal(err)
	}
	if text != "local files" {
		t.Fatalf("text = %s", text)
	}
}

// W3-INSTALL-ROOT. The server is started with cwd = <checkout>/mcp, so the
// process folder cannot be the review root.
func TestLaunchSenseRootWinsOverTheProcessFolder(t *testing.T) {
	// The go test runs in the mcp module folder, so the process folder is the
	// folder that must not be read.
	t.Setenv("LAUNCHSENSE_ROOT", t.TempDir())
	want, err := filepath.EvalSymlinks(os.Getenv("LAUNCHSENSE_ROOT"))
	if err != nil {
		t.Fatal(err)
	}
	root, err := reviewRoot()
	if err != nil {
		t.Fatal(err)
	}
	if root != want {
		t.Fatalf("root = %s, want %s", root, want)
	}
}

func TestLaunchSenseRootMustBeAFolder(t *testing.T) {
	t.Setenv("LAUNCHSENSE_ROOT", "server_test.go")
	if _, err := reviewRoot(); err == nil {
		t.Fatal("a file is not a checkout root")
	}
	t.Setenv("LAUNCHSENSE_ROOT", filepath.Join(t.TempDir(), "absent"))
	if _, err := reviewRoot(); err == nil {
		t.Fatal("an unreadable root must be reported, not silently replaced")
	}
}

// `cd mcp && go run .` is the documented local command. The mcp module folder
// means the checkout is its parent, and a built binary that sits in mcp/ works
// the same way.
func TestModuleFolderMeansTheParentIsTheCheckout(t *testing.T) {
	t.Setenv("LAUNCHSENSE_ROOT", "")
	module := checkoutAbove(mustGetwd(t))
	if module == "" {
		t.Fatal("the go test folder is not recognised as the mcp module")
	}
	want, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	if module != want {
		t.Fatalf("module = %s, want %s", module, want)
	}
}

func TestReviewScriptResolvesAgainstTheReviewRoot(t *testing.T) {
	t.Setenv("LAUNCHSENSE_REVIEW", "")
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	script, err := reviewScript(root)
	if err != nil {
		t.Fatal(err)
	}
	if script != filepath.Join(root, "mcp", "review-entry.ts") {
		t.Fatalf("script = %s", script)
	}
	// A root with no review script names the paths it tried, rather than handing
	// node a path that cannot exist.
	if _, err := reviewScript(t.TempDir()); err == nil {
		t.Fatal("a checkout with no review script must say so")
	}
}

func TestNamedReviewScriptIsUsedAsGiven(t *testing.T) {
	t.Setenv("LAUNCHSENSE_REVIEW", "/somewhere/review-entry.ts")
	script, err := reviewScript(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if script != "/somewhere/review-entry.ts" {
		t.Fatalf("script = %s", script)
	}
}

func mustGetwd(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return cwd
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// W4-MCP item 1. The MCP stdio transport is newline-delimited JSON with no
// headers. A Content-Length frame is LSP framing and no conformant client
// writes one, so this test sends what a client sends and reads what it gets.
func TestInitializeFrame(t *testing.T) {
	s := newServer()
	var in bytes.Buffer
	in.WriteString(`{"jsonrpc":"2.0","id":1,"method":"initialize"}` + "\n")
	var out bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- s.serve(&in, &out)
	}()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out.Bytes(), []byte(`"launchsense"`)) {
		t.Fatalf("out = %s", out.String())
	}
	if bytes.Contains(out.Bytes(), []byte("Content-Length")) {
		t.Fatalf("the answer carries an LSP header: %s", out.String())
	}
	if !bytes.HasSuffix(out.Bytes(), []byte("\n")) {
		t.Fatalf("the answer is not newline terminated: %q", out.String())
	}
}

// toolResult runs one tools/call through handle and returns what the client
// would see, so an argument check can be read without starting a process.
func toolResult(t *testing.T, s *server, name string, args string) map[string]any {
	t.Helper()
	params := fmt.Sprintf(`{"name":%q,"arguments":%s}`, name, args)
	wire := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":%s}`, params)
	var req rpcRequest
	if err := json.Unmarshal([]byte(wire), &req); err != nil {
		t.Fatal(err)
	}
	result, rpcErr := s.handle(req)
	if rpcErr != nil {
		return map[string]any{"__error": rpcErr}
	}
	out, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result is not an object: %#v", result)
	}
	return out
}

func errorCode(t *testing.T, result map[string]any) int {
	t.Helper()
	raw, ok := result["__error"]
	if !ok {
		t.Fatalf("a protocol error was expected, got a result: %#v", result)
	}
	return raw.(*rpcError).Code
}

func errorMessage(t *testing.T, result map[string]any) string {
	t.Helper()
	raw, ok := result["__error"]
	if !ok {
		t.Fatalf("a protocol error was expected, got a result: %#v", result)
	}
	return raw.(*rpcError).Message
}

// noNetwork is a server whose other job in these tests is to prove that an
// argument check runs before any tool does.
func noNetwork(t *testing.T) *server {
	t.Helper()
	return &server{
		apiURL: "https://example.test",
		client: &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
			t.Error("the network must not be reached from an argument check")
			return nil, fmt.Errorf("no network in this test")
		})},
	}
}

// W4-MCP item 8. A missing required field, a wrong type, and an undeclared
// field are three different errors, and none of them runs the tool.
func TestArgumentChecksAreSpecific(t *testing.T) {
	s := noNetwork(t)
	missing := toolResult(t, s, "launchsense_report", `{}`)
	if got := errorCode(t, missing); got != -32602 {
		t.Fatalf("a missing field is -32602, got %d", got)
	}
	if !strings.Contains(errorMessage(t, missing), "scanId is required") {
		t.Fatalf("message = %s", errorMessage(t, missing))
	}

	wrongType := toolResult(t, s, "launchsense_report", `{"scanId":42}`)
	if got := errorCode(t, wrongType); got != -32602 {
		t.Fatalf("a wrong type is -32602, got %d", got)
	}
	if !strings.Contains(errorMessage(t, wrongType), "scanId must be a string, got number") {
		t.Fatalf("message = %s", errorMessage(t, wrongType))
	}

	// repoUrl is no longer published by launchsense_scan_repo, so a caller that
	// still sends it is told, rather than quietly ignored.
	undeclared := toolResult(t, s, "launchsense_scan_repo", `{"repoUrl":"https://github.com/octocat/Hello-World"}`)
	if got := errorCode(t, undeclared); got != -32602 {
		t.Fatalf("an undeclared field is -32602, got %d", got)
	}
	if !strings.Contains(errorMessage(t, undeclared), "repoUrl") {
		t.Fatalf("message = %s", errorMessage(t, undeclared))
	}
}

// W4-MCP item 6. An unknown tool is a protocol error. isError is for a tool
// that ran and failed.
func TestUnknownToolIsAProtocolError(t *testing.T) {
	result := toolResult(t, noNetwork(t), "launchsense_nope", `{}`)
	if got := errorCode(t, result); got != -32602 {
		t.Fatalf("code = %d, want -32602", got)
	}
	if !strings.Contains(errorMessage(t, result), "launchsense_nope") {
		t.Fatalf("message = %s", errorMessage(t, result))
	}
}

// W4-MCP item 5. The hosted server really scans a public repo under
// launchsense_scan_public. A local tool of that name that reads nothing is how a
// scan gets reported that never happened, so the name is not used and every
// published schema says which arguments it takes.
func TestLocalToolNamesCannotClaimAHostedScan(t *testing.T) {
	var names []string
	var notice map[string]any
	for _, def := range toolDefs() {
		name, _ := def["name"].(string)
		names = append(names, name)
		if name == "launchsense_scan_public" {
			t.Fatalf("the local tool list must not answer to the hosted scan name: %v", names)
		}
		if strings.Contains(name, "scan_public") {
			notice = def
		}
		schema, ok := def["inputSchema"].(map[string]any)
		if !ok {
			t.Fatalf("%v publishes no object schema", name)
		}
		if schema["additionalProperties"] != false {
			t.Fatalf("%v does not close its argument list: %v", name, schema)
		}
		props, _ := schema["properties"].(map[string]any)
		if _, ok := props["repoUrl"]; ok {
			t.Fatalf("%v publishes repoUrl and does not use it", name)
		}
	}
	if notice == nil {
		t.Fatalf("the pointer to the hosted address is gone: %v", names)
	}
	description, _ := notice["description"].(string)
	if strings.Contains(strings.ToLower(description), "scan") {
		t.Fatalf("a pointer must not read as a scan: %s", description)
	}
	schema, _ := notice["inputSchema"].(map[string]any)
	if required, ok := schema["required"]; ok && len(required.([]string)) != 0 {
		t.Fatalf("a tool that reads nothing requires nothing: %v", required)
	}
}

// W4-MCP item 3. A report body over the cap is a partial answer. Returning it as
// a whole report would break the product's own rule: a partial result is not a
// pass.
func TestReportBodyOverTheCapIsPartial(t *testing.T) {
	body := strings.Repeat("R", 2*maxReportBytes)
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	defer host.Close()

	s := &server{apiURL: host.URL, client: host.Client()}
	if _, err := s.postJSON("/api/mcp/report", map[string]string{"scanId": "fixture"}); err == nil {
		t.Fatal("a clipped body must not come back as a success")
	} else if !strings.Contains(err.Error(), "partial") {
		t.Fatalf("the error must say the answer is partial: %s", err)
	}

	result := toolResult(t, s, "launchsense_report", `{"scanId":"fixture"}`)
	if result["isError"] != true {
		t.Fatalf("a clipped report is an error result, got %#v", result["isError"])
	}
	content, ok := result["content"].([]map[string]string)
	if !ok {
		t.Fatalf("result = %#v", result)
	}
	if !strings.Contains(content[0]["text"], "partial") {
		t.Fatalf("text = %s", content[0]["text"])
	}
}

// W4-MCP item 4. One API call cannot wait forever. The stdio loop handles one
// message at a time, so an endpoint that accepts and never answers would take
// ping down with it.
func TestAPIClientHasATimeout(t *testing.T) {
	client := newServer().client
	if client.Timeout <= 0 {
		t.Fatal("the API client has no timeout, so one unreachable endpoint wedges every method")
	}
	if client.Timeout != apiTimeout {
		t.Fatalf("timeout = %s, want %s", client.Timeout, apiTimeout)
	}
}

// The mechanism behind TestAPIClientHasATimeout, with the timeout shortened so
// the test does not wait eight seconds: an endpoint that accepts and never
// answers fails one call, and the reason is named.
func TestHungEndpointIsReportedNotHung(t *testing.T) {
	release := make(chan struct{})
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-release
	}))
	// The handler holds the request open until the test lets it go, so Close
	// cannot be left waiting on a goroutine that never returns.
	t.Cleanup(func() {
		close(release)
		host.CloseClientConnections()
		host.Close()
	})

	s := &server{apiURL: host.URL, client: &http.Client{Timeout: 300 * time.Millisecond}}
	result := toolResult(t, s, "launchsense_report", `{"scanId":"hangs"}`)
	if result["isError"] != true {
		t.Fatalf("a call that timed out is an error result, got %#v", result["isError"])
	}
	text := result["content"].([]map[string]string)[0]["text"]
	lowered := strings.ToLower(text)
	if !strings.Contains(lowered, "timeout") && !strings.Contains(lowered, "deadline") {
		t.Fatalf("the answer must name the timeout: %s", text)
	}
}
