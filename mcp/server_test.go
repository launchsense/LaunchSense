package main

import (
	"bytes"
	"io"
	"net/http"
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
