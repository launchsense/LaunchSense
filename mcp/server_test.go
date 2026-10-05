package main

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
	text, err := s.scanRepo("https://github.com/octocat/Hello-World")
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
	text, err := s.scanRepo("")
	if err != nil {
		t.Fatal(err)
	}
	if text != "local files" {
		t.Fatalf("text = %s", text)
	}
}

func TestParseGitHubURL(t *testing.T) {
	owner, name, ok := parseGitHubURL("https://github.com/octocat/Hello-World.git")
	if !ok || owner != "octocat" || name != "Hello-World" {
		t.Fatalf("%s %s %v", owner, name, ok)
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

func TestInitializeFrame(t *testing.T) {
	s := newServer()
	var in bytes.Buffer
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	fmtFrame(&in, body)
	var out bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- s.serve(&in, &out)
	}()
	// Close is not available on bytes.Buffer. serve returns on EOF after one message
	// only if the reader ends. bytes.Buffer read returns EOF, so serve should return.
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out.Bytes(), []byte(`"launchsense"`)) {
		t.Fatalf("out = %s", out.String())
	}
}

func fmtFrame(w io.Writer, body []byte) {
	_, _ = w.Write([]byte("Content-Length: "))
	_, _ = w.Write([]byte(itoa(len(body))))
	_, _ = w.Write([]byte("\r\n\r\n"))
	_, _ = w.Write(body)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
