package main

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestPublicScanDoesNotSendAToken(t *testing.T) {
	var got string
	s := &server{
		apiURL: "https://example.test",
		account: func() (Account, error) {
			return Account{}, nil
		},
		private: func(string, string) (bool, error) { return false, nil },
		client: &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
			body, _ := io.ReadAll(r.Body)
			got = string(body) + " " + r.Header.Get("Authorization")
			return &http.Response{
				StatusCode: 200,
				Body:       io.NopCloser(strings.NewReader(`{"scanId":"s1","findingCount":0}`)),
				Header:     make(http.Header),
			}, nil
		})},
	}
	text, err := s.scanRepo("https://github.com/octocat/Hello-World")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "gho_") || strings.Contains(got, "Bearer") || strings.Contains(got, "token") {
		t.Fatalf("request carried a token: %s", got)
	}
	if !strings.Contains(text, "shared quota") {
		t.Fatalf("text = %s", text)
	}
	if strings.Contains(text, "gho_") {
		t.Fatal("response contained a token")
	}
}

func TestPrivateRepoStopsBeforeAnalysis(t *testing.T) {
	s := &server{
		apiURL: "https://example.test",
		account: func() (Account, error) {
			return Account{LoggedIn: true, Login: "ada", Owner: "ada", Name: "secret", Private: true, Host: "github.com"}, nil
		},
		private: func(string, string) (bool, error) { return true, nil },
		client: &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
			t.Fatal("private repo must not call LaunchSense")
			return nil, nil
		})},
	}
	text, err := s.scanRepo("")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "does not analyze private files yet") {
		t.Fatalf("text = %s", text)
	}
	if !strings.Contains(text, "token stayed on this machine") {
		t.Fatalf("text = %s", text)
	}
}

func TestLoggedOutCurrentRepoTellsTheUserTheCommand(t *testing.T) {
	s := &server{
		account: func() (Account, error) { return Account{}, nil },
	}
	text, err := s.scanRepo("")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "gh auth login") {
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
