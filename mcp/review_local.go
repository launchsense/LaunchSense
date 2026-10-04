package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func runNodeReview(root string) (string, error) {
	script := os.Getenv("LAUNCHSENSE_REVIEW")
	if script == "" {
		script = filepath.Join("mcp", "review-entry.ts")
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
