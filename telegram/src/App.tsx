import { useState, useEffect, useCallback, useRef } from "react";
import {
  createWallet,
  vaultExists,
  loadVault,
  verifyPasskey,
  getBalance,
  getStealthMetaAddress,
  buildAndSubmit,
  shortAddress,
  type Vault,
  type BalanceResult,
} from "./wallet.js";
import * as core from "./core.js";

type Screen = "loading" | "welcome" | "dashboard" | "send" | "receive";

const tg = window.Telegram?.WebApp;

function haptic(type: "success" | "warning" | "error" = "success") {
  tg?.HapticFeedback?.notificationOccurred(type);
}

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [vault, setVault] = useState<Vault | null>(null);
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [error, setError] = useState("");

  const navigate = useCallback((s: Screen) => {
    setError("");
    setScreen(s);
    if (s === "dashboard" || s === "loading") {
      tg?.BackButton?.hide();
    } else {
      tg?.BackButton?.show();
    }
  }, []);

  useEffect(() => {
    tg?.BackButton?.onClick(() => navigate("dashboard"));
  }, [navigate]);

  useEffect(() => {
    (async () => {
      if (!vaultExists()) { navigate("welcome"); return; }
      try {
        const v = loadVault();
        await verifyPasskey(v.credentialId);
        setVault(v);
        navigate("dashboard");
      } catch {
        navigate("welcome");
      }
    })();
  }, [navigate]);

  useEffect(() => {
    if (screen === "dashboard" && vault) {
      getBalance(vault.address).then(setBalance).catch(() => null);
    }
  }, [screen, vault]);

  if (screen === "loading") {
    return <div className="loader"><div className="spinner" /></div>;
  }

  if (screen === "welcome") {
    return <WelcomeScreen onCreated={(v) => { setVault(v); navigate("dashboard"); }} />;
  }

  if (screen === "dashboard" && vault) {
    return (
      <DashboardScreen
        vault={vault}
        balance={balance}
        onSend={() => navigate("send")}
        onReceive={() => navigate("receive")}
      />
    );
  }

  if (screen === "send" && vault) {
    return <SendScreen vault={vault} onBack={() => navigate("dashboard")} />;
  }

  if (screen === "receive" && vault) {
    return <ReceiveScreen vault={vault} onBack={() => navigate("dashboard")} />;
  }

  return null;
}

function WelcomeScreen({ onCreated }: { onCreated: (v: Vault) => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    setLoading(true);
    setErr("");
    try {
      const v = await createWallet();
      haptic("success");
      onCreated(v);
    } catch (e) {
      setErr(errMsg(e));
      haptic("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen welcome">
      <img src="/logo.jpg" width={52} height={52} alt="Marmo" className="logo" />
      <h1 className="title">One wallet,<br />split in three.</h1>
      <p className="sub">
        Your device, a co-signer, and your passkey. Any two can spend. No single one ever can.
      </p>
      <button className="btn btn--primary" onClick={create} disabled={loading}>
        {loading ? "Setting up…" : "Create wallet"}
      </button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function DashboardScreen({
  vault,
  balance,
  onSend,
  onReceive,
}: {
  vault: Vault;
  balance: BalanceResult | null;
  onSend: () => void;
  onReceive: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(vault.address);
    haptic("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="screen dashboard">
      <div className="card">
        <div className="card__top">
          <span className="card__label">Marmo Wallet</span>
          <span className="pill">2-of-3</span>
        </div>
        <div className="balance">
          {balance ? (
            <>
              <span className="balance__usd">$ {balance.usdValue}</span>
              <span className="balance__eth">
                <img src="/eth.png" width={18} height={18} className="token-icon" alt="" />
                {balance.eth} <small>ETH</small>
              </span>
            </>
          ) : <span className="balance__usd">—</span>}
        </div>
        <button className="addr" onClick={copy}>
          {shortAddress(vault.address)}
          <span className="addr__icon">{copied ? "✓" : <CopyIcon />}</span>
        </button>
      </div>

      <div className="actions">
        <button className="btn btn--ghost" onClick={onReceive}>Receive</button>
        <button className="btn btn--primary" onClick={onSend}>Send</button>
      </div>
    </div>
  );
}

function ReceiveScreen({ vault, onBack }: { vault: Vault; onBack: () => void }) {
  const meta = getStealthMetaAddress(vault);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(vault.address)}&color=e9f0f8&bgcolor=141b24&margin=10&qzone=1`;

  async function copyAddress() {
    await navigator.clipboard.writeText(vault.address);
    haptic("success");
  }

  async function copyMeta() {
    await navigator.clipboard.writeText(meta);
    haptic("success");
  }

  return (
    <div className="screen send-screen">
      <button className="back" onClick={onBack}>← Back</button>
      <h2 className="title title--sm">Receive</h2>

      <div className="qr-wrap">
        <img src={qrUrl} width={220} height={220} alt="Wallet address QR code" className="qr-img" />
        <button className="qr-addr" onClick={copyAddress}>
          {shortAddress(vault.address)} <CopyIcon />
        </button>
      </div>

      <div className="net-warn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Send only assets on the <strong>Base network</strong> to this wallet.
      </div>

      <div className="field">
        <label>Stealth meta-address</label>
        <textarea className="field__textarea" readOnly value={meta} rows={4} />
      </div>
      <button className="btn btn--ghost" onClick={copyMeta}>
        <CopyIcon /> Copy meta-address
      </button>
    </div>
  );
}

const KNOWN_TOKENS: Record<string, { symbol: string; logo: string; decimals: number }> = {
  "": { symbol: "ETH", logo: "/eth.png", decimals: 18 },
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": { symbol: "USDC", logo: "/usdc.png", decimals: 6 },
};

function TokenLogo({ logo, symbol }: { logo: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="token-logo token-logo--fallback">?</span>;
  return <img src={logo} width={20} height={20} className="token-logo" alt={symbol} onError={() => setFailed(true)} />;
}

function TokenSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const known = Object.entries(KNOWN_TOKENS);
  const current = KNOWN_TOKENS[value] ?? { symbol: value.slice(0, 8) + "…", logo: "", decimals: 18 };

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="token-selector" ref={ref}>
      <button type="button" className="token-selector__trigger" onClick={() => setOpen(!open)}>
        <TokenLogo logo={current.logo} symbol={current.symbol} />
        <span>{current.symbol}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="token-selector__menu">
          {known.map(([addr, tok]) => (
            <button
              key={addr}
              type="button"
              className={`token-selector__option${value === addr ? " token-selector__option--active" : ""}`}
              onClick={() => { onChange(addr); setOpen(false); }}
            >
              <TokenLogo logo={tok.logo} symbol={tok.symbol} />
              <span>{tok.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SendScreen({ vault, onBack }: { vault: Vault; onBack: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ hash: string; url: string } | null>(null);
  const [err, setErr] = useState("");

  async function submit() {
    if (!to.startsWith("0x") || to.length < 10) { setErr("Enter a valid address"); return; }
    if (!amount || Number(amount) <= 0) { setErr("Enter an amount"); return; }

    const tokenInfo = KNOWN_TOKENS[token] ?? { decimals: 18 };
    const amountWei = BigInt(Math.round(Number(amount) * 10 ** tokenInfo.decimals)).toString();

    setLoading(true);
    setErr("");
    setResult(null);

    try {
      const isStealthy = to.length > 42;
      let hash: string;

      if (isStealthy) {
        const cd = await core.buildStealthSend(vault.address, vault.apiKey, to, amountWei, token || undefined);
        hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      } else {
        const cd = await core.buildSend(vault.address, vault.apiKey, to, amountWei, token || undefined);
        hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      }

      haptic("success");
      setResult({ hash, url: `https://basescan.org/tx/${hash}` });
    } catch (e) {
      setErr(errMsg(e));
      haptic("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen send-screen">
      <button className="back" onClick={onBack}>← Back</button>
      <h2 className="title title--sm">Send</h2>

      <div className="field">
        <label>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Recipient
        </label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x… or stealth meta-address" />
      </div>

      <div className="field">
        <label>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Amount
        </label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" min="0" step="0.000001" />
      </div>

      <div className="field">
        <label>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Token
        </label>
        <TokenSelector value={token} onChange={setToken} />
      </div>

      <div className="quorum">
        Signing with <strong>Device</strong> + <strong>Co-signer</strong>
      </div>

      <button className="btn btn--primary" onClick={submit} disabled={loading}>
        {loading ? "Signing…" : "Sign & send"}
      </button>

      {err && <p className="err">{err}</p>}
      {result && (
        <div className="result-ok">
          Submitted
          <a href={result.url} target="_blank" rel="noopener">View on BaseScan ↗</a>
        </div>
      )}
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready(): void;
        expand(): void;
        HapticFeedback?: {
          notificationOccurred(t: "success" | "warning" | "error"): void;
        };
        BackButton?: {
          show(): void;
          hide(): void;
          onClick(cb: () => void): void;
        };
      };
    };
  }
}
