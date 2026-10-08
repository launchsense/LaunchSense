// The free local path, in words only. No commands here: the agent reads
// /install.txt and does the typing. It runs on the user's machine, reads
// their working tree, sends nothing to us, and has no hourly limit.

export default function LocalPath() {
  return (
    <div aria-label="Free local check">
      <p>
        Run the same checks on your own machine, free and unlimited. Nothing is sent to
        us, there is no hourly limit, and it reads your working tree, including work you
        have not committed yet.
      </p>
      <p>
        Your coding tool does the setup with you. <a href="/start">Start here, everything in one place</a>.
      </p>
    </div>
  );
}
