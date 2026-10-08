// The free local path, shown on the home and connect pages.
//
// It runs on the user's machine, reads their working tree, sends nothing to us,
// and has no hourly limit.

const REPO_URL = "https://github.com/launchsense/LaunchSense";

export default function LocalPath() {
  return (
    <div aria-label="Free local check">
      <p>
        Run the same checks on your own machine, free and unlimited. Nothing is sent to
        us, there is no hourly limit, and it reads your working tree, including work you
        have not committed yet.
      </p>
      <pre className="install-command">{`git clone ${REPO_URL}
cd LaunchSense && ./install.sh`}</pre>
      <p>
        The installer asks before it changes anything and writes the entry for your
        coding tool. You can read it before it runs.
      </p>
    </div>
  );
}
