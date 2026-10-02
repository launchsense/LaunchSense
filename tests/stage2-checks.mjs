import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGitHubRepoUrl } from "../shared/githubUrl.ts";

describe("parseGitHubRepoUrl", () => {
  it("accepts a plain owner/repo URL and preserves the repo's capitalization", () => {
    const result = parseGitHubRepoUrl("https://github.com/withkeshav/LaunchSense");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.owner, "withkeshav");
      assert.equal(result.value.repo, "LaunchSense");
      assert.equal(result.value.normalizedUrl, "https://github.com/withkeshav/LaunchSense");
    }
  });

  it("strips .git, trailing slash, and tree suffix", () => {
    for (const url of [
      "https://github.com/withkeshav/LaunchSense.git",
      "https://github.com/withkeshav/LaunchSense/",
      "https://github.com/withkeshav/LaunchSense/tree/main/src",
    ]) {
      const result = parseGitHubRepoUrl(url);
      assert.equal(result.ok, true, url);
    }
  });

  it("rejects non-github hosts, credentials, and non-https", () => {
    for (const url of [
      "https://gitlab.com/owner/repo",
      "https://user:pass@github.com/owner/repo",
      "http://github.com/owner/repo",
      "https://github.com/onlyowner",
      "not a url",
      "",
    ]) {
      const result = parseGitHubRepoUrl(url);
      assert.equal(result.ok, false, url);
    }
  });
});
