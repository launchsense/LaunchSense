# Main flow

Two flows. Each line below is what a walk showed, or what is still not on the live site.

## Live site, the first look

URL: `https://harmless-chihuahua-667.convex.site`

The live site is the guest paste. Open it, paste a public GitHub URL, run the scan, read the answer with its coverage, and copy the prompt. A partial result is not a pass.

This file was written with the alpha harness in the repository. The live site does not yet serve `install.sh` or the case studies page until this commit is deployed.

## Alpha harness, the job

Command, from this repository, offline:

`LAUNCHSENSE_OFFLINE=1 node --experimental-strip-types mcp/review-entry.ts --root <a folder>`

A walk on 2026-10-04 of a two-file folder, offline, printed: "LaunchSense alpha review. The job runs on the files on this machine." It read 2 files, named the MIT signal, and listed the missing lockfile and the unqueried registries as not checked. It did not call api.github.com. Unknown stays unknown. A model quote appears only when the decision API answers, and the line says the quote is not a finding.

Install for a harness: `sh install.sh` from this repository.
