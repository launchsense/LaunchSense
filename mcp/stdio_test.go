// W4-MCP. What the MCP stdio transport is, held as tests.
//
// The transport is one JSON message per line, in both directions, with no
// header and no embedded newline. This file drives serve() with exactly those
// bytes and reads exactly those bytes back, then covers the three refusals that
// the old LSP framing had no room for: a message over the cap, a line that is
// not JSON, and a line that is too long to keep.
//
// Every refusal must still leave a working session, because a client that gets
// one error and then a dead stream cannot tell a bad message from a dead server.

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

// drive runs one stdio session over the given bytes and returns what the server
// wrote to stdout and to stderr.
func drive(t *testing.T, s *server, input string) (string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	s.errOut = &errOut
	if err := s.serve(strings.NewReader(input), &out); err != nil {
		t.Fatalf("serve: %v", err)
	}
	return out.String(), errOut.String()
}

// replies splits stdout into one parsed message per line, and fails if any line
// is not exactly one JSON message.
func replies(t *testing.T, stdout string) []map[string]any {
	t.Helper()
	var parsed []map[string]any
	for _, line := range strings.Split(stdout, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var msg map[string]any
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			t.Fatalf("a line on stdout is not one JSON message: %q", line)
		}
		parsed = append(parsed, msg)
	}
	return parsed
}

func errorOf(t *testing.T, msg map[string]any) (int, string) {
	t.Helper()
	raw, ok := msg["error"].(map[string]any)
	if !ok {
		t.Fatalf("a protocol error was expected, got %v", msg)
	}
	code, ok := raw["code"].(float64)
	if !ok {
		t.Fatalf("error has no code: %v", raw)
	}
	message, _ := raw["message"].(string)
	return int(code), message
}

// A notification has no id, so it is answered with nothing at all.
func TestNotificationIsNotAnswered(t *testing.T) {
	stdout, _ := drive(t, newServer(), `{"jsonrpc":"2.0","method":"notifications/initialized"}`+"\n")
	if stdout != "" {
		t.Fatalf("a notification must not be answered: %q", stdout)
	}
}

// A message split across two writes is still one message: the newline is the
// only framing, so a line is reassembled rather than cut.
func TestMessageSplitAcrossWritesIsOneMessage(t *testing.T) {
	s := newServer()
	var out, errOut bytes.Buffer
	s.errOut = &errOut
	pr, pw := io.Pipe()
	go func() {
		defer pw.Close()
		_, _ = pw.Write([]byte(`{"jsonrpc":"2.0","id":1,`))
		time.Sleep(10 * time.Millisecond)
		_, _ = pw.Write([]byte(`"method":"initialize"}` + "\n"))
	}()
	if err := s.serve(pr, &out); err != nil {
		t.Fatalf("serve: %v", err)
	}
	msgs := replies(t, out.String())
	if len(msgs) != 1 || msgs[0]["id"].(float64) != 1 {
		t.Fatalf("one message in, one answer out: %q", out.String())
	}
}

// A line that is not JSON is answered with -32700 and id null, and the session
// keeps working. Silently dropping it leaves the client waiting forever, which
// is the same thing as a crash from where the client sits.
func TestMalformedJSONIsAnsweredAndTheSessionSurvives(t *testing.T) {
	stdout, stderr := drive(t, newServer(), "{not json at all\n"+`{"jsonrpc":"2.0","id":2,"method":"ping"}`+"\n")
	msgs := replies(t, stdout)
	if len(msgs) != 2 {
		t.Fatalf("the bad line and the ping both answer: %q", stdout)
	}
	code, message := errorOf(t, msgs[0])
	if code != -32700 {
		t.Fatalf("code = %d, want -32700", code)
	}
	if !strings.Contains(message, "Parse error") {
		t.Fatalf("message = %s", message)
	}
	if msgs[0]["id"] != nil {
		t.Fatalf("id = %v, want null because no id could be read", msgs[0]["id"])
	}
	if _, ok := msgs[0]["result"]; ok {
		t.Fatalf("a parse error is not a result: %v", msgs[0])
	}
	if msgs[1]["id"].(float64) != 2 {
		t.Fatalf("the session did not survive: %q", stdout)
	}
	if !strings.Contains(stderr, "parse error") {
		t.Fatalf("one line goes to stderr: %q", stderr)
	}
}

// A line over the cap is refused with a JSON-RPC error, nothing is kept for it,
// and the next message still answers. Before this, a declared length of a
// terabyte took the process down with an out-of-memory stack trace.
func TestOversizeLineIsRefusedWithoutAllocationOrDesync(t *testing.T) {
	s := newServer()
	oversize := `{"jsonrpc":"2.0","id":1,"method":"ping","pad":"` + strings.Repeat("a", maxMessageBytes+1024) + `"}` + "\n"
	stdout, stderr := drive(t, s, oversize+`{"jsonrpc":"2.0","id":2,"method":"ping"}`+"\n")
	msgs := replies(t, stdout)
	if len(msgs) != 2 {
		t.Fatalf("the oversize line is answered and the next one still answers: %q", stdout)
	}
	code, message := errorOf(t, msgs[0])
	if code != -32600 {
		t.Fatalf("code = %d, want -32600 Invalid Request", code)
	}
	if !strings.Contains(message, "4 MiB") {
		t.Fatalf("the cap is named in the answer: %s", message)
	}
	if msgs[1]["id"].(float64) != 2 {
		t.Fatalf("the stream desynced: %q", stdout)
	}
	if !strings.Contains(stderr, "too large") && !strings.Contains(stderr, "limit") {
		t.Fatalf("stderr names the refusal: %q", stderr)
	}
}

// A line just under the cap is a normal message, so the cap is a real boundary
// and not a size check that refuses everything.
func TestLineUnderTheCapIsServed(t *testing.T) {
	// "pad" is not a declared argument of ping, and ping takes no arguments, so
	// the message is answered by ping itself: the point is the size, not the shape.
	big := `{"jsonrpc":"2.0","id":1,"method":"ping","pad":"` + strings.Repeat("a", maxMessageBytes-4096) + `"}` + "\n"
	stdout, _ := drive(t, newServer(), big)
	msgs := replies(t, stdout)
	if len(msgs) != 1 {
		t.Fatalf("a line under the cap is served: %q", stdout)
	}
	if msgs[0]["id"].(float64) != 1 {
		t.Fatalf("id = %v", msgs[0]["id"])
	}
}

// The old LSP framing is now just a line that is not JSON. It gets a parse error
// instead of consuming the next message, which is what a wrong declared length
// used to do: either nothing at all, or a stream that no longer lined up.
func TestOldLSPFramingIsAParseErrorNotADesync(t *testing.T) {
	body := `{"jsonrpc":"2.0","id":2,"method":"ping"}`
	old := fmt.Sprintf("Content-Length: %d\r\n\r\n%s\n", len(body), body)
	stdout, _ := drive(t, newServer(), old+`{"jsonrpc":"2.0","id":3,"method":"ping"}`+"\n")
	msgs := replies(t, stdout)
	if len(msgs) != 3 {
		t.Fatalf("the header line is one parse error and the two real messages after it both answer: %q", stdout)
	}
	if code, _ := errorOf(t, msgs[0]); code != -32700 {
		t.Fatalf("code = %d, want -32700", code)
	}
	for i, id := range []float64{2, 3} {
		if msgs[i+1]["id"] != id || msgs[i+1]["result"] == nil {
			t.Fatalf("message %d was not answered with a result: %v", i, msgs[i+1])
		}
	}
}

// stdout carries protocol only. Every refusal in this file logs to stderr and
// nothing to stdout except the answer itself, so every line on stdout is one
// parseable JSON-RPC message.
func TestStdoutCarriesNoLogLines(t *testing.T) {
	stdout, stderr := drive(t, newServer(), "garbage\n"+`{"jsonrpc":"2.0","id":1,"method":"initialize"}`+"\n")
	msgs := replies(t, stdout)
	if len(msgs) != 2 {
		t.Fatalf("stdout is one answer per message: %q", stdout)
	}
	for _, msg := range msgs {
		if msg["jsonrpc"] != "2.0" {
			t.Fatalf("a stdout line is not a JSON-RPC message: %v", msg)
		}
	}
	if !strings.Contains(stderr, "parse error") {
		t.Fatalf("the log line went somewhere else: stderr = %q, stdout = %q", stderr, stdout)
	}
}

// The review subprocess cannot outlive its budget. It is a node process the
// server waits on, and a hung one would hold the single stdio loop.
func TestReviewSubprocessTimeout(t *testing.T) {
	dir := t.TempDir()
	script := dir + "/slow-review.ts"
	// A review script that never finishes and never exits. The shape is a node
	// entry point, so the failure under test is the wait, not the file.
	if err := os.WriteFile(script, []byte("setInterval(() => {}, 1000);\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("LAUNCHSENSE_REVIEW", script)
	original := reviewTimeout
	reviewTimeout = 400 * time.Millisecond
	t.Cleanup(func() { reviewTimeout = original })

	_, err := runNodeReview(dir)
	if err == nil {
		t.Fatal("a review that never finishes must not come back as a report")
	}
	if !strings.Contains(err.Error(), "did not finish") {
		t.Fatalf("the error says what happened: %s", err)
	}
	if strings.Contains(err.Error(), "LaunchSense alpha review") {
		t.Fatalf("no partial report text is passed off as a review: %s", err)
	}
}
