import { useState, useEffect, useCallback } from "react";
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
  async function copy() {
    await navigator.clipboard.writeText(vault.address);
    haptic("success");
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
              <span className="balance__eth">{balance.eth} <small>ETH</small></span>
              <span className="balance__usdc">{balance.usdc} USDC</span>
            </>
          ) : "—"}
        </div>
        <button className="addr" onClick={copy}>
          {shortAddress(vault.address)} · copy
        </button>
      </div>

      <div className="actions">
        <button className="btn btn--ghost" onClick={onReceive}>Receive</button>
        <button className="btn btn--primary" onClick={onSend}>Send</button>
      </div>

      <div className="shards">
        <div className="shard shard--on"><b>A</b><span>Device</span></div>
        <div className="shard shard--on"><b>B</b><span>Co-signer</span></div>
        <div className="shard shard--on"><b>C</b><span>Passkey</span></div>
      </div>
    </div>
  );
}

function ReceiveScreen({ vault, onBack }: { vault: Vault; onBack: () => void }) {
  const meta = getStealthMetaAddress(vault);

  async function copy() {
    await navigator.clipboard.writeText(meta);
    haptic("success");
  }

  return (
    <div className="screen send-screen">
      <button className="back" onClick={onBack}>← Back</button>
      <h2 className="title title--sm">Receive</h2>
      <p className="sub">Share your stealth meta-address. Each payment lands at a unique one-time address only you can detect.</p>
      <div className="field">
        <label>Stealth meta-address</label>
        <textarea className="meta-addr" readOnly value={meta} rows={4} />
      </div>
      <button className="btn btn--primary" onClick={copy}>Copy meta-address</button>
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

    const decimals = token === "USDC" ? 6 : 18;
    const amountWei = BigInt(Math.round(Number(amount) * 10 ** decimals)).toString();

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
        <label>Recipient</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x… or stealth meta-address" />
      </div>
      <div className="field">
        <label>Amount</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" min="0" step="0.000001" />
      </div>
      <div className="field">
        <label>Token</label>
        <select value={token} onChange={(e) => setToken(e.target.value)}>
          <option value="">ETH</option>
          <option value="USDC">USDC</option>
        </select>
      </div>

      <div className="quorum">
        <span className="dot" /> Signing with <strong>Device</strong> + <strong>Co-signer</strong>
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
