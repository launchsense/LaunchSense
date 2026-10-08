export function LocalProofStrip() {
  return (
    <div className="local-proof-strip" aria-label="Local audit facts">
      <div className="proof-item">
        <span className="proof-value">working tree</span>
        <span className="proof-label">Audits uncommitted code</span>
        <p className="proof-desc">Reads files directly on your machine before you share.</p>
      </div>
      <div className="proof-item">
        <span className="proof-value">no hourly limit</span>
        <span className="proof-label">Run as often as you build</span>
        <p className="proof-desc">Free and unlimited local reviews with no metered cap.</p>
      </div>
      <div className="proof-item">
        <span className="proof-value">nothing uploaded</span>
        <span className="proof-label">Zero egress to our servers</span>
        <p className="proof-desc">Your repo and secrets never leave your checkout.</p>
      </div>
    </div>
  );
}
