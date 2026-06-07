/**
 * OnChainAttestation panel
 *
 * Shows the MARA on-chain identity and decision audit trail stats from
 * the MARAAttestation contract deployed on ValueChain.
 *
 * Data source: GET /api/attestation → attestation-service.ts → ValueChain RPC
 */

import { useState, useEffect, useRef } from 'react';
import PanelHeader from './PanelHeader';

interface AttestationSummary {
  contractAddress:  string;
  chainId:          number;
  version:          string;
  operator:         string;
  expectedOperator: string;
  identityCoherent: boolean;
  deployedAt:       string;
  onChainDecisions: number;
  onChainTrades:    number;
  onChainUpgrades:  number;
  killSwitchActive: boolean;
  enabled:          boolean;
}

function chainLabel(chainId: number): string {
  if (chainId === 138565) return 'ValueChain Testnet';
  if (chainId === 286623) return 'ValueChain Mainnet';
  if (chainId === 31337)  return 'Local Dev Chain';
  return `chain ${chainId}`;
}

function shortenAddr(addr: string): string {
  if (!addr || addr === '—' || addr === 'error') return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function explorerUrl(addr: string, chainId = 138565): string {
  // ValueChain testnet explorer
  const base = chainId === 138565
    ? 'https://testnet-scan.valuechain.xyz'
    : 'https://main-scan.valuechain.xyz';
  return `${base}/address/${addr}`;
}

export default function OnChainAttestation({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [summary, setSummary] = useState<AttestationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [bumped, setBumped]   = useState(false);
  const prevDecisions         = useRef<number | null>(null);

  const fetchAttestation = useRef(async () => {
    try {
      const res = await fetch('/api/attestation');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AttestationSummary = await res.json();
      setSummary((prev) => {
        // Flash the counter when a new decision lands on-chain.
        if (prevDecisions.current !== null && data.onChainDecisions > prevDecisions.current) {
          setBumped(true);
          setTimeout(() => setBumped(false), 1500);
        }
        prevDecisions.current = data.onChainDecisions;
        return data ?? prev;
      });
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  });

  // Steady poll
  useEffect(() => {
    void fetchAttestation.current();
    const timer = setInterval(() => void fetchAttestation.current(), 12_000);
    return () => clearInterval(timer);
  }, []);

  // A new decision arrived over WebSocket → the backend writes it on-chain after
  // a ~3s debounce, so re-fetch in a short burst to catch the counter ticking up.
  useEffect(() => {
    if (refreshSignal === 0) return;
    const t1 = setTimeout(() => void fetchAttestation.current(), 3_800);
    const t2 = setTimeout(() => void fetchAttestation.current(), 8_000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [refreshSignal]);

  const statusDot = summary?.enabled
    ? <span className="mc-dot mc-dot--live" />
    : <span className="mc-dot" style={{ background: 'var(--fg-4)' }} />;

  const statusChip = summary?.enabled
    ? <span className="mc-badge mc-badge--pos">ON-CHAIN LIVE</span>
    : <span className="mc-badge mc-badge--muted">OFF-CHAIN ONLY</span>;

  return (
    <div className="mc-panel" style={{ minHeight: 0 }}>
      <PanelHeader
        icon="⛓"
        title="ON-CHAIN ATTESTATION"
        subtitle="ValueChain · MARAAttestation.sol"
        chip={<>{statusDot}&nbsp;{statusChip}</>}
      />

      <div style={{ padding: '0 16px 16px' }}>
        {loading && (
          <p className="mara-label" style={{ color: 'var(--fg-4)', padding: '12px 0' }}>
            Loading on-chain data…
          </p>
        )}

        {error && !loading && (
          <div className="mc-card" style={{ padding: '10px 12px', borderColor: 'var(--neg)', marginBottom: 8 }}>
            <span className="mara-label" style={{ color: 'var(--neg)' }}>
              RPC error: {error}
            </span>
          </div>
        )}

        {summary && !loading && (
          <>
            {/* Kill switch warning */}
            {summary.killSwitchActive && (
              <div className="mc-card" style={{
                padding: '8px 12px',
                borderColor: 'var(--neg)',
                background: 'var(--neg-bg)',
                marginBottom: 10,
              }}>
                <span className="mara-label mara-neg">
                  ⚠ KILL SWITCH ACTIVE ON-CHAIN
                </span>
              </div>
            )}

            {/* Identity coherence — the single-source-of-truth proof */}
            <div className="mc-card" style={{
              padding: '8px 12px', marginBottom: 8,
              borderColor: summary.identityCoherent ? 'var(--pos)' : 'var(--neg)',
              background: summary.identityCoherent ? 'var(--pos-bg, rgba(0,184,125,.06))' : 'var(--neg-bg)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={`mara-label ${summary.identityCoherent ? 'mara-pos' : 'mara-neg'}`}>
                  {summary.identityCoherent ? '✓ OPERATOR IDENTITY VERIFIED' : '✗ IDENTITY DIVERGENCE'}
                </span>
                <span className="mara-micro mara-muted" style={{ fontSize: 10 }}>
                  {chainLabel(summary.chainId)}
                </span>
              </div>
              <span className="mara-micro mara-muted" style={{ display: 'block', marginTop: 3, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>
                {summary.identityCoherent
                  ? 'On-chain owner == SoDEX execution wallet'
                  : 'Contract owner ≠ execution wallet — see IDENTITY.md'}
              </span>
            </div>

            {/* Contract identity */}
            <div className="mc-card" style={{ padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span className="mara-label mara-muted">CONTRACT ADDRESS</span>
                {summary.contractAddress && summary.contractAddress !== '—' ? (
                  <a
                    href={explorerUrl(summary.contractAddress, summary.chainId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--info)', fontFamily: 'var(--font-mono)', fontSize: 11, textDecoration: 'none' }}
                  >
                    {shortenAddr(summary.contractAddress)} ↗
                  </a>
                ) : (
                  <span className="mara-data mara-muted">{summary.contractAddress || 'Not deployed'}</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="mara-label mara-muted">OPERATOR WALLET</span>
                <span className="mara-data" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {shortenAddr(summary.operator)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="mara-label mara-muted">VERSION</span>
                <span className="mara-data">{summary.version}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="mara-label mara-muted">DEPLOYED</span>
                <span className="mara-data mara-muted" style={{ fontSize: 11 }}>
                  {summary.deployedAt !== '—' && summary.deployedAt !== 'error'
                    ? new Date(summary.deployedAt).toUTCString().replace(' GMT', ' UTC')
                    : summary.deployedAt}
                </span>
              </div>
            </div>

            {/* Audit trail stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
              <div className="mc-stat" style={{
                textAlign: 'center', padding: '8px 4px',
                transition: 'box-shadow .4s, border-color .4s',
                boxShadow: bumped ? '0 0 0 1px var(--pos), 0 0 14px rgba(0,184,125,.45)' : 'none',
                borderColor: bumped ? 'var(--pos)' : undefined,
              }}>
                <div className="mara-value" style={{ fontSize: 22, color: bumped ? 'var(--pos)' : undefined, transition: 'color .4s' }}>
                  {summary.onChainDecisions.toLocaleString()}
                </div>
                <div className="mara-label mara-muted" style={{ marginTop: 2 }}>DECISIONS</div>
              </div>
              <div className="mc-stat" style={{ textAlign: 'center', padding: '8px 4px' }}>
                <div className="mara-value" style={{ fontSize: 22 }}>
                  {summary.onChainTrades.toLocaleString()}
                </div>
                <div className="mara-label mara-muted" style={{ marginTop: 2 }}>TRADES</div>
              </div>
              <div className="mc-stat" style={{ textAlign: 'center', padding: '8px 4px' }}>
                <div className="mara-value" style={{ fontSize: 22 }}>
                  {summary.onChainUpgrades.toLocaleString()}
                </div>
                <div className="mara-label mara-muted" style={{ marginTop: 2 }}>UPGRADES</div>
              </div>
            </div>

            {/* Audit explanation */}
            <div className="mc-card" style={{ padding: '8px 12px' }}>
              <p className="mara-label mara-muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
                Every MARA decision is hashed on-chain:{' '}
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--info)' }}>
                  keccak256(id ‖ event ‖ ts ‖ conviction ‖ confidence)
                </code>
                . Judges can verify any decision from{' '}
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--info)' }}>
                  GET /api/decisions
                </code>{' '}
                against the contract using{' '}
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--info)' }}>
                  computeDecisionHash()
                </code>.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
