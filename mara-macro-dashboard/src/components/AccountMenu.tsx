/**
 * AccountMenu — sign in (Google / wallet / guest), credits chip, session menu.
 * Google renders only when VITE_GOOGLE_CLIENT_ID is configured; wallets are
 * discovered live via EIP-6963 so every installed extension shows up by name.
 */
import { useEffect, useRef, useState } from "react";
import { LogOut, Wallet, UserCircle2, Zap, ChevronDown } from "lucide-react";
import {
  useSession, restoreSession, loginGuest, loginWallet, loginGoogleCredential,
  logout, discoverWallets, loadGis, GOOGLE_CLIENT_ID,
  type DiscoveredWallet,
} from "../session";

export default function AccountMenu() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void restoreSession(); }, []);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // discover wallets + mount Google button when the menu opens (signed out)
  useEffect(() => {
    if (!open || session.user) return;
    void discoverWallets().then(setWallets);
    if (GOOGLE_CLIENT_ID) {
      void loadGis().then(() => {
        if (!googleBtnRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (res) => {
            setBusy("google");
            loginGoogleCredential(res.credential)
              .catch((e) => setErr(String(e instanceof Error ? e.message : e)))
              .finally(() => setBusy(null));
          },
        });
        googleBtnRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "filled_black", size: "large", width: 264, text: "continue_with", shape: "rectangular",
        });
      }).catch(() => setErr("Google Sign-In failed to load"));
    }
  }, [open, session.user]);

  const run = (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null);
    fn().then(() => setOpen(false))
      .catch((e) => setErr(String(e instanceof Error ? e.message : e).slice(0, 120)))
      .finally(() => setBusy(null));
  };

  if (session.loading) {
    return <span className="mc-badge mc-badge--muted">SESSION…</span>;
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
      {session.user && (
        <span className="acct-credit-chip" title="MARA credits — stake them in Signal Duel">
          <Zap size={12} />
          {session.credits.toLocaleString()}
          <span style={{ color: "var(--fg-3)", fontWeight: 500 }}>CR</span>
        </span>
      )}

      <button type="button" className="mc-btn" style={{ gap: 8 }} onClick={() => setOpen(!open)}>
        {session.user ? (
          <>
            {session.user.avatar
              ? <img src={session.user.avatar} alt="" style={{ width: 16, height: 16, borderRadius: 99 }} />
              : <UserCircle2 size={14} />}
            {(session.user.name ?? "Operator").split(" ")[0]}
          </>
        ) : (
          <><Wallet size={13} /> Sign In</>
        )}
        <ChevronDown size={12} style={{ opacity: .6, transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
      </button>

      {open && (
        <div className="acct-pop">
          {session.user ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span className="mara-label">Account</span>
                <span className={`mc-badge ${session.user.provider === "guest" ? "mc-badge--muted" : "mc-badge--pos"}`}>
                  {session.user.provider.toUpperCase()}
                </span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div className="mara-name" style={{ fontSize: 14 }}>{session.user.name ?? "Operator"}</div>
                {session.user.email && <div className="mara-micro" style={{ textTransform: "none", marginTop: 3 }}>{session.user.email}</div>}
                {session.user.walletAddress && (
                  <div className="mara-micro" style={{ textTransform: "none", marginTop: 3, wordBreak: "break-all" }}>
                    {session.user.walletAddress}
                  </div>
                )}
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="mara-label">MARA CREDITS</span>
                <span className="mara-value mara-amber" style={{ fontSize: 20 }}>{session.credits.toLocaleString()}</span>
              </div>
              <p className="mara-micro" style={{ textTransform: "none", letterSpacing: 0, marginBottom: 12, lineHeight: 1.5 }}>
                Credits power Signal Duel stakes. Win duels against the agent to earn more.
              </p>
              {session.user.provider === "guest" && (
                <p className="mara-micro mara-amber" style={{ textTransform: "none", letterSpacing: 0, marginBottom: 12, lineHeight: 1.5 }}>
                  Guest pass — sign in with Google or a wallet to keep this account across devices.
                </p>
              )}
              <button className="mc-btn mc-btn--neg mc-btn--full" style={{ padding: "9px 0" }} onClick={() => run("logout", logout)}>
                <LogOut size={13} /> Sign Out
              </button>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <span className="mara-label">Join the desk</span>
                <p className="mara-micro" style={{ textTransform: "none", letterSpacing: 0, marginTop: 6, lineHeight: 1.55 }}>
                  New accounts get <span className="mara-amber">1,000 MARA credits</span> (guests 400) — stake them
                  against the agent in Signal Duel.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {GOOGLE_CLIENT_ID ? (
                  <div ref={googleBtnRef} style={{ minHeight: 40 }} />
                ) : (
                  <button className="acct-provider-btn" disabled title="Set VITE_GOOGLE_CLIENT_ID + GOOGLE_CLIENT_ID to enable">
                    <UserCircle2 size={15} /> Google — not configured yet
                  </button>
                )}

                {wallets.map((w) => (
                  <button
                    key={w.uuid}
                    className="acct-provider-btn"
                    disabled={busy !== null}
                    onClick={() => run(w.uuid, () => loginWallet(w))}
                  >
                    {w.icon
                      ? <img src={w.icon} alt="" style={{ width: 16, height: 16 }} />
                      : <Wallet size={15} />}
                    {busy === w.uuid ? "Check your wallet…" : `${w.name} — sign to verify`}
                  </button>
                ))}
                {wallets.length === 0 && (
                  <button className="acct-provider-btn" disabled>
                    <Wallet size={15} /> No wallet extension detected
                  </button>
                )}

                <button
                  className="acct-provider-btn"
                  disabled={busy !== null}
                  onClick={() => run("guest", () => loginGuest())}
                >
                  <Zap size={15} />
                  {busy === "guest" ? "Issuing pass…" : "Guest pass — instant, 400 credits"}
                </button>
              </div>

              {err && (
                <p className="mara-micro mara-neg" style={{ textTransform: "none", letterSpacing: 0, marginTop: 10 }}>
                  {err}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
