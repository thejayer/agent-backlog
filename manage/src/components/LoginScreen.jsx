import React, { useState } from "react";

export function LoginScreen({ error, onLogin, sessionInfo }) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const githubStart = sessionInfo?.providers?.github ? sessionInfo.loginUrls?.github : "";
  const githubLoginUrl = githubStart
    ? `${githubStart}${githubStart.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(
      typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}${window.location.hash}`,
    )}`
    : "";

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    await onLogin(token);
    setSubmitting(false);
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark">A</div>
        <h1>Agent Backlog</h1>
        <p>Sign in with an allowed GitHub account or the operator / break-glass token. The agent bearer token cannot open a browser session.</p>
        {githubLoginUrl ? (
          <>
            <a className="button secondary github-login" href={githubLoginUrl}>
              Continue with GitHub
            </a>
            <div className="auth-divider">
              <span>or</span>
            </div>
          </>
        ) : null}
        <label>
          <span>Operator token</span>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="manage-local"
            type="password"
            autoFocus
          />
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button type="submit" className="button primary" disabled={submitting}>
          {submitting ? "Checking" : "Open console"}
        </button>
      </form>
    </div>
  );
}
