import { useState, useEffect, useCallback, useRef } from "react";
import {
  createWallet,
  vaultExists,
  loadVault,
  verifyPasskey,
  getBalance,
  getStealthMetaAddress,
  buildAndSubmit,
  fetchEthPrice,
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

const SwapIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4" />
    <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
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
    return <SendScreen vault={vault} balance={balance} onBack={() => navigate("dashboard")} />;
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
        <div className="net-warn__row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Only send assets on the <strong>Base network</strong> to this address. Assets sent from another network may be permanently lost.</span>
        </div>
        <div className="net-warn__support">
          For support contact{" "}
          <a href="mailto:contact@usemarmo.xyz" className="net-warn__email">
            contact@usemarmo.xyz
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>
          </a>
        </div>
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

type SendStep = "input" | "preview";

function SendScreen({ vault, balance, onBack }: { vault: Vault; balance: BalanceResult | null; onBack: () => void }) {
  const [step, setStep] = useState<SendStep>("input");
  const [token, setToken] = useState("");
  const [amountMode, setAmountMode] = useState<"token" | "usd">("token");
  const [amountRaw, setAmountRaw] = useState("");
  const [to, setTo] = useState("");
  const [ethPrice, setEthPrice] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ hash: string; url: string } | null>(null);
  const [err, setErr] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchEthPrice().then(setEthPrice); }, []);

  useEffect(() => {
    if (step === "input") setTimeout(() => amountRef.current?.focus(), 80);
  }, [step]);

  const tokenInfo = KNOWN_TOKENS[token] ?? { symbol: "?", logo: "", decimals: 18 };
  const isUSDC = token !== "";
  const price = isUSDC ? 1 : ethPrice;
  const parsed = parseFloat(amountRaw) || 0;
  const tokenAmount = amountMode === "token" ? parsed : (price > 0 ? parsed / price : 0);
  const usdAmount = amountMode === "usd" ? parsed : parsed * price;
  const sendAmountWei = BigInt(Math.round(tokenAmount * 10 ** tokenInfo.decimals)).toString();

  function handleAmountInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*?)\./g, "$1");
    setAmountRaw(v);
  }

  function swapMode() {
    const next = amountMode === "token" ? "usd" : "token";
    if (parsed > 0 && price > 0) {
      const converted = next === "usd" ? parsed * price : parsed / price;
      setAmountRaw(converted.toFixed(next === "usd" ? 2 : 6).replace(/\.?0+$/, ""));
    }
    setAmountMode(next);
    setTimeout(() => amountRef.current?.focus(), 40);
  }

  const primaryDisplay = amountMode === "usd"
    ? `$${amountRaw || ""}`
    : (amountRaw || "");

  const secondaryDisplay = amountMode === "token"
    ? `$${usdAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${tokenAmount > 0 ? tokenAmount.toFixed(8).replace(/\.?0+$/, "") : "0"} ${tokenInfo.symbol}`;

  function goPreview() {
    if (!parsed) { setErr("Enter an amount"); return; }
    if (!to.startsWith("0x") || to.length < 10) { setErr("Enter a valid recipient address"); return; }
    setErr("");
    setStep("preview");
  }

  async function submit() {
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      const isStealthy = to.length > 42;
      let hash: string;
      if (isStealthy) {
        const cd = await core.buildStealthSend(vault.address, vault.apiKey, to, sendAmountWei, token || undefined);
        hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      } else {
        const cd = await core.buildSend(vault.address, vault.apiKey, to, sendAmountWei, token || undefined);
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

  if (step === "preview") {
    return (
      <div className="screen send-screen">
        <button className="back" onClick={() => { setStep("input"); setErr(""); }}>← Edit</button>
        <h2 className="title title--sm">Review</h2>

        <div className="preview-card">
          <div className="preview-card__label">Sending</div>
          <div className="preview-card__amount">
            {tokenAmount > 0 ? tokenAmount.toFixed(8).replace(/\.?0+$/, "") : "0"} {tokenInfo.symbol}
          </div>
          <div className="preview-card__usd">
            ~${usdAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>

          <div className="preview-card__divider" />

          <div className="preview-row">
            <span className="preview-row__key">To</span>
            <span className="preview-row__val preview-row__val--mono">{shortAddress(to)}</span>
          </div>
          <div className="preview-row">
            <span className="preview-row__key">Network</span>
            <span className="preview-row__val">Base</span>
          </div>
          <div className="preview-row">
            <span className="preview-row__key">Signing</span>
            <span className="preview-row__val">Device + Co-signer</span>
          </div>
        </div>

        {!result && (
          <button className="btn btn--primary" onClick={submit} disabled={loading}>
            {loading ? "Signing…" : "Confirm & Send"}
          </button>
        )}

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

  return (
    <div className="screen send-screen">
      <button className="back" onClick={onBack}>← Back</button>

      <div className="token-tabs">
        {Object.entries(KNOWN_TOKENS).map(([addr, tok]) => (
          <button
            key={addr}
            className={`token-tab${token === addr ? " token-tab--active" : ""}`}
            onClick={() => { setToken(addr); setAmountRaw(""); }}
          >
            <TokenLogo logo={tok.logo} symbol={tok.symbol} />
            {tok.symbol}
          </button>
        ))}
      </div>

      <div className="amount-wrap" onClick={() => amountRef.current?.focus()}>
        <div className="amount-display">
          {amountMode === "usd" && amountRaw && <span className="amount-prefix">$</span>}
          <input
            ref={amountRef}
            className="amount-input"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amountRaw}
            onChange={handleAmountInput}
          />
          {!amountRaw && amountMode === "usd" && null}
        </div>
        <div className="amount-secondary">
          <span>{secondaryDisplay}</span>
          <button className="swap-btn" type="button" onClick={(e) => { e.stopPropagation(); swapMode(); }}>
            <SwapIcon />
          </button>
        </div>
        {balance && (
          <button
            className="amount-max"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const max = isUSDC ? balance.usdcRaw : balance.ethRaw;
              const decimals = tokenInfo.decimals;
              const raw = (Number(max) / 10 ** decimals).toFixed(decimals === 18 ? 8 : 6).replace(/\.?0+$/, "");
              setAmountMode("token");
              setAmountRaw(raw);
            }}
          >
            Max
          </button>
        )}
      </div>

      <div className="field">
        <label>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Recipient
        </label>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x… or stealth meta-address"
          style={{ fontSize: "16px" }}
        />
      </div>

      <div className="quorum">
        Signing with <strong>Device</strong> + <strong>Co-signer</strong>
      </div>

      {err && <p className="err">{err}</p>}

      <button className="btn btn--primary" onClick={goPreview} disabled={!parsed || !to}>
        Preview
      </button>
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
