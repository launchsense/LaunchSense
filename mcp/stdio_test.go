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
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	// The two answers are found by id, not by position: the loop is concurrent, so
	// their order is not fixed.
	for _, id := range []float64{2, 3} {
		if msg := msgForID(t, msgs, id); msg["result"] == nil {
			t.Fatalf("message %v was not answered with a result: %v", id, msg)
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

// ------------------------------------------------------------------
// W41-MCP. The session lifecycle, the JSON-RPC envelope, the protocol version
// both MCP surfaces negotiate, and a loop that does not serialise every request
// behind the slowest one.
//
// Before this, serve() held no session state at all, never read the jsonrpc
// member, echoed back whatever id it was given, answered a second initialize,
// and answered one message at a time. Each test below drives real bytes, so the
// whole path from stdin to stdout is covered.
// ------------------------------------------------------------------

// initializeFrame is one handshake request with a chosen id.
func initializeFrame(id int) string {
	return fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`+"\n", id)
}

// msgForID finds the answer to one id. Once requests are answered concurrently
// the order of two answers is not fixed, so every test here looks an answer up
// by its id instead of by position.
func msgForID(t *testing.T, msgs []map[string]any, id float64) map[string]any {
	t.Helper()
	for _, msg := range msgs {
		if got, ok := msg["id"].(float64); ok && got == id {
			return msg
		}
	}
	t.Fatalf("no answer for id %v in %d message(s)", id, len(msgs))
	return nil
}

// readAnswers turns a pipe of stdout into a stream of parsed messages, so a test
// can wait for one answer while another request is still running.
func readAnswers(t *testing.T, r io.Reader) <-chan map[string]any {
	t.Helper()
	ch := make(chan map[string]any, 16)
	go func() {
		defer close(ch)
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 0, 64*1024), maxMessageBytes+1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var msg map[string]any
			if err := json.Unmarshal([]byte(line), &msg); err != nil {
				ch <- map[string]any{"__notJSON": line}
				continue
			}
			ch <- msg
		}
	}()
	return ch
}

// awaitID waits for the answer to one id and returns it. Answers for other ids
// are read past.
func awaitID(t *testing.T, ch <-chan map[string]any, id float64, within time.Duration) map[string]any {
	t.Helper()
	timer := time.NewTimer(within)
	defer timer.Stop()
	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				t.Fatalf("the session ended before id %v was answered", id)
			}
			if got, isFloat := msg["id"].(float64); isFloat && got == id {
				return msg
			}
		case <-timer.C:
			t.Fatalf("no answer for id %v within %s", id, within)
		}
	}
}

// answerLog collects answers instead of discarding them. awaitID reads past
// answers for other ids, which is fine while one request is outstanding at a
// time but throws answers away as soon as several are, so a test that needs to
// wait for many ids in any order collects them here first.
type answerLog struct {
	mu       sync.Mutex
	messages []map[string]any
}

// take waits for the answer carrying id and removes it from the log. Every other
// answer is kept, so waiting for one request never loses another.
func (l *answerLog) take(t *testing.T, ch <-chan map[string]any, id float64, within time.Duration) map[string]any {
	t.Helper()
	timer := time.NewTimer(within)
	defer timer.Stop()
	for {
		l.mu.Lock()
		for i, msg := range l.messages {
			if got, ok := msg["id"].(float64); ok && got == id {
				l.messages = append(l.messages[:i:i], l.messages[i+1:]...)
				l.mu.Unlock()
				return msg
			}
		}
		l.mu.Unlock()
		select {
		case msg, ok := <-ch:
			if !ok {
				t.Fatalf("the session ended before id %v was answered", id)
			}
			l.mu.Lock()
			l.messages = append(l.messages, msg)
			l.mu.Unlock()
		case <-timer.C:
			l.mu.Lock()
			held := len(l.messages)
			l.mu.Unlock()
			t.Fatalf("no answer for id %v within %s (%d other answers held)", id, within, held)
		}
	}
}

// A request before initialize is refused by name, nothing is run, and ping is
// the one method that still answers, because it is how a client asks whether the
// process is alive.
func TestRequestBeforeInitializeIsRefusedAndPingStillAnswers(t *testing.T) {
	stdout, stderr := drive(t, newServer(),
		`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`+"\n"+
			`{"jsonrpc":"2.0","id":2,"method":"ping"}`+"\n")
	msgs := replies(t, stdout)

	list := msgForID(t, msgs, 1)
	code, message := errorOf(t, list)
	if code != -32002 {
		t.Fatalf("a request before initialize is -32002 Server not initialized, got %d (%s)", code, message)
	}
	if !strings.Contains(message, "not initialized") {
		t.Fatalf("the answer says why: %s", message)
	}
	if _, ok := list["result"]; ok {
		t.Fatalf("a refused request is not a result: %v", list)
	}
	if ping := msgForID(t, msgs, 2); ping["result"] == nil {
		t.Fatalf("ping answers before initialize: %v", ping)
	}
	if stderr != "" {
		t.Fatalf("a refusal is a protocol answer, so nothing is logged: %q", stderr)
	}
}

// A tool call before initialize must not run the tool. The answer names the
// lifecycle, and none of the tool's text comes back.
func TestToolCallBeforeInitializeDoesNotRunTheTool(t *testing.T) {
	stdout, _ := drive(t, newServer(),
		`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"launchsense_scan_public_notice","arguments":{}}}`+"\n")
	if code, _ := errorOf(t, msgForID(t, replies(t, stdout), 7)); code != -32002 {
		t.Fatalf("a tool call before initialize is refused, got %d", code)
	}
	if strings.Contains(stdout, "convex.site/mcp") {
		t.Fatalf("the tool ran before the handshake: %q", stdout)
	}
}

// The lifecycle allows one initialize. A second one is a client that restarted
// or raced, and it is told so instead of being handed a second handshake. The
// session itself keeps working.
func TestSecondInitializeIsRefusedAndTheSessionSurvives(t *testing.T) {
	stdout, _ := drive(t, newServer(),
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`+"\n"+
			`{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}`+"\n"+
			`{"jsonrpc":"2.0","id":3,"method":"tools/list"}`+"\n")
	msgs := replies(t, stdout)

	first := msgForID(t, msgs, 1)
	result, ok := first["result"].(map[string]any)
	if !ok {
		t.Fatalf("the first initialize answers with a result: %v", first)
	}
	if result["serverInfo"] == nil {
		t.Fatalf("the first handshake names the server: %v", result)
	}

	code, message := errorOf(t, msgForID(t, msgs, 2))
	if code != -32600 {
		t.Fatalf("a second initialize is Invalid Request, got %d (%s)", code, message)
	}
	if !strings.Contains(strings.ToLower(message), "already initialized") {
		t.Fatalf("the answer says why: %s", message)
	}
	if list := msgForID(t, msgs, 3); list["result"] == nil {
		t.Fatalf("a refused second initialize does not end the session: %v", list)
	}
}

// The envelope is checked before any method runs. A message that is not a
// JSON-RPC 2.0 message cannot be answered as one, and answering it anyway is how
// a client ends up waiting for an answer to a request it never made.
func TestEnvelopeIsCheckedBeforeAnyMethodRuns(t *testing.T) {
	// The three bad ids echo an id that is not a number, so their answers are
	// found by the error member rather than by id.
	cases := []struct{ name, line string }{
		{"jsonrpc 1.0", `{"jsonrpc":"1.0","id":1,"method":"tools/list"}`},
		{"no jsonrpc member", `{"id":1,"method":"tools/list"}`},
		{"jsonrpc is a number", `{"jsonrpc":2.0,"id":1,"method":"tools/list"}`},
		{"jsonrpc is an array", `{"jsonrpc":["2.0"],"id":1,"method":"tools/list"}`},
		{"id is an object", `{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}`},
		{"id is an array", `{"jsonrpc":"2.0","id":[1],"method":"ping"}`},
		{"id is a boolean", `{"jsonrpc":"2.0","id":true,"method":"ping"}`},
	}
	for _, c := range cases {
		// The second line proves the session is still usable after the refusal.
		stdout, stderr := drive(t, newServer(), c.line+"\n"+initializeFrame(99))
		msgs := replies(t, stdout)
		// The refused message is the only one carrying an error. The bad-id cases
		// echo an id that is not a number, so the answer is found by its error
		// member rather than by id.
		var bad map[string]any
		for _, msg := range msgs {
			if _, isError := msg["error"]; isError {
				bad = msg
			}
		}
		if bad == nil {
			t.Fatalf("%s: nothing was answered for a bad envelope: %q", c.name, stdout)
		}
		code, message := errorOf(t, bad)
		if code != -32600 {
			t.Fatalf("%s: code = %d, want -32600 Invalid Request", c.name, code)
		}
		if _, ok := bad["result"]; ok {
			t.Fatalf("%s: a refused envelope is not a result: %v", c.name, bad)
		}
		if message == "" {
			t.Fatalf("%s: the answer says what is wrong with the message", c.name)
		}
		if strings.Contains(stderr, "Go struct field") {
			t.Fatalf("%s: the log line leaks a Go internal, not the mistake: %q", c.name, stderr)
		}
		if after := msgForID(t, msgs, 99); after["result"] == nil {
			t.Fatalf("%s: the session survives the refusal: %v", c.name, after)
		}
	}
}

// An id that is present and null is a request, not a notification: JSON-RPC 2.0
// allows null as a request id and the answer must carry the same null. The
// missing id member is the notification case, and that one gets no answer at
// all. Both used to be dropped, which left a client that sent id null waiting
// with nothing on stderr to say why.
func TestExplicitNullIDIsAnswered(t *testing.T) {
	stdout, stderr := drive(t, newServer(), initializeFrame(1)+`{"jsonrpc":"2.0","id":null,"method":"ping"}`+"\n")
	answered := false
	for _, msg := range replies(t, stdout) {
		if _, isMap := msg["id"].(map[string]any); isMap {
			continue
		}
		if msg["id"] == nil && msg["result"] != nil {
			answered = true
		}
	}
	if !answered {
		t.Fatalf(`"id": null is a request and is answered with id null: %q`, stdout)
	}
	if stderr != "" {
		t.Fatalf("the answer is on stdout, so nothing is logged: %q", stderr)
	}
}

// A notification is run and never answered. Running it is the other half of
// "never answered": a client notification that carries work must still see the
// work done. The decision that matters here is between a missing id and an id
// that is present and null, and TestExplicitNullIDIsAnswered covers the other
// half of that pair.
func TestNotificationIsRunAndIsNotAnswered(t *testing.T) {
	t.Setenv("LAUNCHSENSE_ROOT", t.TempDir())
	ran := make(chan string, 4)
	s := newServer()
	s.review = func(root string) (string, error) {
		ran <- root
		return "local review text", nil
	}
	stdout, _ := drive(t, s,
		initializeFrame(1)+
			`{"jsonrpc":"2.0","method":"notifications/initialized"}`+"\n"+
			`{"jsonrpc":"2.0","method":"tools/call","params":{"name":"launchsense_scan_repo","arguments":{}}}`+"\n")
	// Two notifications, two requests for them, and no answer for either. The two
	// answers that do come back are the handshake above and nothing else.
	msgs := replies(t, stdout)
	if len(msgs) != 1 {
		t.Fatalf("only the initialize is answered: %q", stdout)
	}
	if msgs[0]["id"].(float64) != 1 {
		t.Fatalf("id = %v, want the handshake id 1", msgs[0]["id"])
	}
	// serve returns only once every handler it started has finished, so by here
	// the notification has been run.
	if len(ran) != 1 {
		t.Fatalf("a notification is run, not skipped: the review ran %d times", len(ran))
	}
}

// The local server negotiates the same four versions the hosted surface
// negotiates, so a client that can talk to one can talk to the other. A version
// this server does not implement is answered with the default rather than
// refused.
func TestProtocolVersionIsNegotiated(t *testing.T) {
	// The four versions are not restated from the hosted file as a second copy to
	// trust: the hosted list is read from disk, so the two surfaces cannot drift
	// apart silently.
	hosted, err := os.ReadFile(filepath.Join("..", "convex", "mcpHttp.ts"))
	if err != nil {
		t.Fatalf("the hosted MCP handler is the reference for the version list: %v", err)
	}
	line := ""
	for _, candidate := range strings.Split(string(hosted), "\n") {
		if strings.Contains(candidate, "PROTOCOL_VERSIONS") && strings.Contains(candidate, "[") {
			line = candidate
			break
		}
	}
	if line == "" {
		t.Fatal("no protocol version list found in convex/mcpHttp.ts")
	}

	cases := []struct{ asked, want string }{
		{"2024-11-05", "2024-11-05"},
		{"2025-03-26", "2025-03-26"},
		{"2025-06-18", "2025-06-18"},
		{"2025-11-25", "2025-11-25"},
		// Anything else is answered with the default, not refused and not echoed.
		{"2099-01-01", "2025-03-26"},
	}
	for _, c := range cases {
		if c.want == c.asked && !strings.Contains(line, `"`+c.asked+`"`) {
			t.Fatalf("%s is not a version the hosted surface serves; line = %s", c.asked, line)
		}
		stdout, _ := drive(t, newServer(),
			`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"`+c.asked+`"}}`+"\n")
		result, ok := msgForID(t, replies(t, stdout), 1)["result"].(map[string]any)
		if !ok {
			t.Fatalf("initialize for %s answered with a result", c.asked)
		}
		if result["protocolVersion"] != c.want {
			t.Fatalf("%s answered %v, want %s", c.asked, result["protocolVersion"], c.want)
		}
	}

	// A version that is not a string, and no version at all, both get the default
	// rather than whatever the server last said.
	for _, params := range []string{`{"protocolVersion":20250618}`, `{"protocolVersion":null}`, `{}`} {
		stdout, _ := drive(t, newServer(),
			`{"jsonrpc":"2.0","id":1,"method":"initialize","params":`+params+"}\n")
		result, ok := msgForID(t, replies(t, stdout), 1)["result"].(map[string]any)
		if !ok {
			t.Fatalf("initialize with %s answered with a result", params)
		}
		if result["protocolVersion"] != "2025-03-26" {
			t.Fatalf("%s answered %v, want the default 2025-03-26", params, result["protocolVersion"])
		}
		if !strings.Contains(line, `"`+result["protocolVersion"].(string)+`"`) {
			t.Fatalf("the default must be a version the hosted surface serves: %v", result["protocolVersion"])
		}
	}
}

// Every answer is one whole stdout line, written under the stdout guard, so two
// answers produced at the same moment cannot interleave into one broken line.
// Each answer is also a single Write, so a message and its newline cannot be
// pulled apart by another writer between two calls. This drives several slow
// tool calls and several fast ones at once, and then checks that every line of
// stdout is exactly one JSON message and that every id was answered exactly once.
//
// Without the guard, two answers sharing one line fail to parse here. Without the
// single Write, a newline lands on its own and an answer arrives as two lines,
// which the line count catches.
func TestConcurrentAnswersAreOneAtomicLineEach(t *testing.T) {
	t.Setenv("LAUNCHSENSE_ROOT", t.TempDir())
	const slow = 4
	const fast = 12
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseAll := func() { releaseOnce.Do(func() { close(release) }) }

	s := newServer()
	s.review = func(string) (string, error) {
		<-release
		return "a review body with\na newline inside it\nand a third line", nil
	}
	var errOut bytes.Buffer
	s.errOut = &errOut

	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	// The raw bytes are teed aside as they are read, so the test can check the
	// framing itself and not only the parsed messages.
	var rawMu sync.Mutex
	var raw bytes.Buffer
	answers := readAnswers(t, io.TeeReader(outR, writerFunc(func(p []byte) (int, error) {
		rawMu.Lock()
		defer rawMu.Unlock()
		return raw.Write(p)
	})))

	done := make(chan error, 1)
	go func() { done <- s.serve(inR, outW) }()

	// One writer goroutine, so a slow handler cannot block the test's writes.
	lines := make(chan string, slow+fast+2)
	go func() {
		for line := range lines {
			_, _ = inW.Write([]byte(line))
		}
	}()

	// shutdown is idempotent, because both this test and its cleanup need it and
	// either one may run first after a failure.
	var shutdownOnce sync.Once
	shutdown := func() error {
		var serveErr error
		shutdownOnce.Do(func() {
			releaseAll()
			close(lines)
			_ = inW.Close()
			select {
			case serveErr = <-done:
			case <-time.After(10 * time.Second):
				serveErr = fmt.Errorf("serve did not return after the reviews were released and stdin closed")
			}
			_ = outW.Close()
		})
		return serveErr
	}
	t.Cleanup(func() {
		if err := shutdown(); err != nil {
			t.Errorf("%v", err)
		}
	})

	log := &answerLog{}

	lines <- initializeFrame(1)
	log.take(t, answers, 1, 5*time.Second)

	// Every request is written before any of the slow ones is released, so all of
	// them are in flight at the same moment and their answers really do race.
	for i := 0; i < slow; i++ {
		lines <- fmt.Sprintf(
			`{"jsonrpc":"2.0","id":%d,"method":"tools/call","params":{"name":"launchsense_scan_repo","arguments":{}}}`+"\n",
			10+i,
		)
	}
	for i := 0; i < fast; i++ {
		lines <- fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"ping"}`+"\n", 100+i)
	}

	// The fast ones answer now, while every review is still blocked. That is the
	// concurrency, proved from the outside.
	for i := 0; i < fast; i++ {
		log.take(t, answers, float64(100+i), 5*time.Second)
	}
	releaseAll()
	for i := 0; i < slow; i++ {
		log.take(t, answers, float64(10+i), 10*time.Second)
	}

	if err := shutdown(); err != nil {
		t.Fatalf("%v", err)
	}
	// The tee and the answer reader are still draining the pipe the writer was
	// writing to, so give them a moment before the raw bytes are read.
	time.Sleep(100 * time.Millisecond)

	rawMu.Lock()
	rawBytes := raw.String()
	rawMu.Unlock()

	// The framing check, on the bytes themselves. Every line must be one whole
	// JSON message and nothing may be left over.
	var seen []map[string]any
	for _, line := range strings.Split(rawBytes, "\n") {
		if line == "" {
			continue
		}
		var msg map[string]any
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			t.Fatalf("a line on stdout is not one JSON message, so two answers interleaved: %q", line)
		}
		seen = append(seen, msg)
	}
	if len(seen) != slow+fast+1 {
		t.Fatalf("one line per answer: want %d, got %d in %q", slow+fast+1, len(seen), rawBytes)
	}
	// Every id answered exactly once, whatever order they came out in.
	counts := map[float64]int{}
	for _, msg := range seen {
		id, ok := msg["id"].(float64)
		if !ok {
			t.Fatalf("an answer has no numeric id: %v", msg)
		}
		counts[id]++
	}
	for id, n := range counts {
		if n != 1 {
			t.Fatalf("id %v answered %d times", id, n)
		}
	}
	if counts[1] != 1 {
		t.Fatalf("the handshake answered once: %d", counts[1])
	}
	for i := 0; i < slow; i++ {
		msg := msgForID(t, seen, float64(10+i))
		result, ok := msg["result"].(map[string]any)
		if !ok {
			t.Fatalf("the review answers with a result: %v", msg)
		}
		content, ok := result["content"].([]any)
		if !ok || len(content) != 1 {
			t.Fatalf("result = %#v", result)
		}
		text, _ := content[0].(map[string]any)["text"].(string)
		if !strings.Contains(text, "third line") {
			t.Fatalf("a body holding newlines came through whole: %q", text)
		}
	}
}

// writerFunc turns a write function into an io.Writer.
type writerFunc func(p []byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }

// A slow tool call must not hold the loop. Before this, serve answered one
// message at a time, so a local review that ran for minutes took ping down with
// it and a client using ping as a liveness probe would conclude the process was
// dead.
func TestPingAnswersWhileAToolCallIsStillRunning(t *testing.T) {
	t.Setenv("LAUNCHSENSE_ROOT", t.TempDir())
	entered := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseReview := func() { releaseOnce.Do(func() { close(release) }) }
	s := newServer()
	s.review = func(string) (string, error) {
		close(entered)
		<-release
		return "the review finished after the ping answered\non a second line", nil
	}
	var errOut bytes.Buffer
	s.errOut = &errOut

	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	answers := readAnswers(t, outR)
	done := make(chan error, 1)
	go func() { done <- s.serve(inR, outW) }()
	// One writer goroutine, so the test's writes cannot block on a server that is
	// busy with a slow tool call. That blockage is exactly the defect: with a
	// serialised loop the ping never gets read, so the test would hang instead of
	// failing with a reason.
	lines := make(chan string, 8)
	go func() {
		for line := range lines {
			_, _ = inW.Write([]byte(line))
		}
	}()
	t.Cleanup(func() {
		releaseReview()
		close(lines)
		_ = inW.Close()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("serve: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Error("serve did not return after the review was released and stdin closed")
		}
		_ = outW.Close()
	})

	send := func(line string) { lines <- line }
	send(initializeFrame(1))
	awaitID(t, answers, 1, 5*time.Second)

	send(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"launchsense_scan_repo","arguments":{}}}` + "\n")
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the tool call never started")
	}

	send(`{"jsonrpc":"2.0","id":3,"method":"ping"}` + "\n")
	ping := awaitID(t, answers, 3, 5*time.Second)
	if ping["result"] == nil {
		t.Fatalf("ping answers while the review is still running: %v", ping)
	}
	select {
	case early := <-answers:
		t.Fatalf("the slow tool answered before the ping, so nothing was concurrent: %v", early)
	default:
	}

	// Both answers are whole messages. The slow answer holds a newline inside a
	// string and it arrives after a concurrent writer has been to stdout, so the
	// write guard and the encoder both held.
	releaseReview()
	review := awaitID(t, answers, 2, 5*time.Second)
	result, ok := review["result"].(map[string]any)
	if !ok {
		t.Fatalf("the review answers with a result: %v", review)
	}
	content, ok := result["content"].([]any)
	if !ok || len(content) != 1 {
		t.Fatalf("result = %#v", result)
	}
	text, _ := content[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "second line") {
		t.Fatalf("the whole answer came through one writer: %q", text)
	}
}

// The review subprocess cannot outlive its budget. It is a node process the
// server waits on, so a review that never finishes comes back as an error rather
// than a report that never arrives. That the loop keeps answering meanwhile is
// TestPingAnswersWhileAToolCallIsStillRunning.
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
