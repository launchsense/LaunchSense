package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func runNodeReview(root string) (string, error) {
	script, err := reviewScript(root)
	if err != nil {
		return "", err
	}
	cmd := exec.Command("node", "--experimental-strip-types", script, "--root", root)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
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
