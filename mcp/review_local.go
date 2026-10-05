package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// reviewTimeout bounds the local review subprocess. The review is a node script
// that may reach the network for OSV, so it is slower than an API call, but the
// stdio loop answers one message at a time: a process that never exits would
// hold every later message, ping included. It is a variable so a test can shorten
// it; nothing in production changes it.
var reviewTimeout = 10 * time.Minute

func runNodeReview(root string) (string, error) {
	script, err := reviewScript(root)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), reviewTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "--experimental-strip-types", script, "--root", root)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf(
			"the local review did not finish within %s, so there is no report here and nothing is claimed about the files. Run it yourself to see the whole review: node --experimental-strip-types %s --root %s",
			reviewTimeout, script, root,
		)
	}
	if err != nil {
		if text == "" {
			return "", err
		}
		return "", err
	}
	return text, nil
}

// reviewScript is the local review entry point. The installer passes an absolute
// LAUNCHSENSE_REVIEW. Without it, resolve against the review root, not the
// process folder: the server runs with cwd = <checkout>/mcp, so a process
// relative default looks for <checkout>/mcp/mcp/review-entry.ts and finds
// nothing.
func reviewScript(root string) (string, error) {
	if named := strings.TrimSpace(os.Getenv("LAUNCHSENSE_REVIEW")); named != "" {
		return named, nil
	}
	candidates := []string{
		filepath.Join(root, "mcp", "review-entry.ts"),
		filepath.Join(root, "review-entry.ts"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf(
		"no review script found. Set LAUNCHSENSE_REVIEW to review-entry.ts, or start the server from a LaunchSense checkout. Looked in %s",
		strings.Join(candidates, " and "),
	)
}
