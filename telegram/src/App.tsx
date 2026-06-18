import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { privateKeyToAddress } from "viem/accounts";
import { formatEther, formatUnits } from "viem";
import {
  createWallet,
  vaultExists,
  loadVault,
  verifyPasskey,
  getBalance,
  getStealthMetaAddress,
  buildAndSubmit,
  fetchEthPrice,
  type PriceResult,
  fetchWalletTokens,
  fetchTokenByAddress,
  saveCustomTokenAddress,
  shortAddress,
  registerStealth,
  scanStealthPayments,
  sweepStealthPayment,
  initTotpSetup,
  confirmTotpSetup,
  recoverFromTotp,
  ensureVaultBackup,
  type Vault,
  type BalanceResult,
  type WalletToken,
  type StealthPayment,
  type TxRecord,
  type TxFetchState,
  fetchTxBatch,
  TX_PAGE_SIZE,
} from "./wallet.js";
import * as core from "./core.js";

type Screen = "loading" | "welcome" | "dashboard" | "send" | "receive" | "swap" | "setup-totp" | "recover";

const SCRAMBLE = "0123456789";

function useScramble(value: string | null): string {
  const [display, setDisplay] = useState("");
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const target = value ?? "0.00";
    let iter = 0;

    const tick = () => {
      if (value === null) {
        setDisplay(target.split("").map(ch =>
          /\d/.test(ch) ? SCRAMBLE[Math.floor(Math.random() * 10)] : ch
        ).join(""));
        raf.current = requestAnimationFrame(tick);
      } else {
        const len = target.length;
        setDisplay(target.split("").map((ch, i) => {
          if (i < Math.floor(iter)) return ch;
          return /\d/.test(ch) ? SCRAMBLE[Math.floor(Math.random() * 10)] : ch;
        }).join(""));
        iter += len / 14;
        if (Math.floor(iter) < len) {
          raf.current = requestAnimationFrame(tick);
        } else {
          setDisplay(target);
        }
      }
    };
    tick();
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value]);

  return display;
}

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

function SetupTotpScreen({ vault, onDone, onBack }: { vault: Vault; onDone: (v: Vault) => void; onBack: () => void }) {
  const [step, setStep] = useState<"qr" | "confirm">("qr");
  const [totpData, setTotpData] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    initTotpSetup(vault).then(setTotpData).catch(e => setErr(errMsg(e)));
  }, []);

  async function confirm() {
    if (!/^\d{6}$/.test(code)) { setErr("Enter the 6-digit code from your app"); return; }
    setLoading(true);
    setErr("");
    try {
      const updated = await confirmTotpSetup(vault, code);
      haptic("success");
      onDone(updated);
    } catch (e) {
      haptic("error");
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  const qrUrl = totpData
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpData.uri)}&color=e9f0f8&bgcolor=141b24&margin=10&qzone=1`
    : null;

  return (
    <div className="screen send-screen">
      <button className="back" onClick={onBack}>← Back</button>
      <h2 className="title title--sm">Set up recovery</h2>

      {step === "qr" && (
        <>
          <p className="totp-setup__hint">Scan this QR code with Google Authenticator, Microsoft Authenticator, or Authy. This links your wallet to your authenticator app so you can recover access if you lose this device.</p>

          {!totpData && !err && (
            <div style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}>
              <svg className="swap-fetching__spinner" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue-2)" strokeWidth="2" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            </div>
          )}

          {qrUrl && (
            <div className="totp-setup__qr-wrap">
              <img src={qrUrl} width={200} height={200} className="totp-setup__qr" alt="Authenticator QR code" />
            </div>
          )}

          {totpData && (
            <div className="totp-setup__manual">
              <span className="totp-setup__manual-label">Or enter manually</span>
              <button className="totp-setup__secret" onClick={() => { navigator.clipboard.writeText(totpData.secret); haptic("success"); }}>
                {totpData.secret}
                <CopyIcon />
              </button>
            </div>
          )}

          {err && <p className="err">{err}</p>}

          <button className="btn btn--primary" onClick={() => setStep("confirm")} disabled={!totpData}>
            I scanned it
          </button>
          <button className="btn btn--ghost" onClick={onBack}>Skip for now</button>
        </>
      )}

      {step === "confirm" && (
        <>
          <p className="totp-setup__hint">Open your authenticator app and enter the 6-digit code for Marmo to confirm the link.</p>

          <input
            className="totp-setup__code-input"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            autoFocus
          />

          {err && <p className="err">{err}</p>}

          <button className="btn btn--primary" onClick={confirm} disabled={loading || code.length !== 6}>
            {loading ? "Verifying…" : "Confirm"}
          </button>
          <button className="btn btn--ghost" onClick={() => { setStep("qr"); setCode(""); setErr(""); }}>← Back</button>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [anim, setAnim] = useState<"in" | "out">("in");
  const [vault, setVault] = useState<Vault | null>(null);
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [error, setError] = useState("");
  const [backupErr, setBackupErr] = useState("");

  const navigate = useCallback((s: Screen) => {
    setError("");
    setScreen(prev => {
      if (prev === "loading") return s;
      setAnim("out");
      setTimeout(() => { setScreen(s); setAnim("in"); }, 150);
      return prev;
    });
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
        if (v.totpEnabled) {
          ensureVaultBackup(v).catch((e) => {
            console.error("[backup]", e);
            setBackupErr(errMsg(e));
          });
        }
      } catch {
        navigate("welcome");
      }
    })();
  }, [navigate]);

  function refreshBalance() {
    if (!vault) return;
    setBalance(null);
    getBalance(vault.address).then(setBalance).catch(() => null);
  }

  useEffect(() => {
    if (screen === "dashboard" && vault) {
      getBalance(vault.address).then(setBalance).catch(() => null);
    }
  }, [screen, vault]);

  let content: ReactNode = null;

  if (screen === "loading") {
    content = <div className="loader"><div className="spinner" /></div>;
  } else if (screen === "welcome") {
    content = (
      <WelcomeScreen
        onCreated={(v) => { setVault(v); navigate("dashboard"); }}
        onRecover={() => navigate("recover")}
      />
    );
  } else if (screen === "recover") {
    content = (
      <RecoverScreen
        onRecovered={(v) => { setVault(v); navigate("dashboard"); }}
        onBack={() => navigate("welcome")}
      />
    );
  } else if (screen === "dashboard" && vault) {
    content = (
      <DashboardScreen
        vault={vault}
        balance={balance}
        onSend={() => navigate("send")}
        onReceive={() => navigate("receive")}
        onSwap={() => navigate("swap")}
        onRefresh={refreshBalance}
        onSetupTotp={() => navigate("setup-totp")}
        backupErr={backupErr}
        onRetryBackup={() => {
          setBackupErr("");
          ensureVaultBackup(vault).catch((e) => setBackupErr(errMsg(e)));
        }}
      />
    );
  } else if (screen === "send" && vault) {
    content = <SendScreen vault={vault} balance={balance} onBack={() => navigate("dashboard")} />;
  } else if (screen === "receive" && vault) {
    content = <ReceiveScreen vault={vault} onBack={() => navigate("dashboard")} />;
  } else if (screen === "swap" && vault) {
    content = <SwapScreen vault={vault} onBack={() => navigate("dashboard")} />;
  } else if (screen === "setup-totp" && vault) {
    content = (
      <SetupTotpScreen
        vault={vault}
        onDone={(updatedVault) => { setVault(updatedVault); navigate("dashboard"); }}
        onBack={() => navigate("dashboard")}
      />
    );
  }

  return (
    <div key={screen} className={`screen-anim screen-anim--${anim}`}>
      {content}
    </div>
  );
}

function WelcomeScreen({ onCreated, onRecover }: { onCreated: (v: Vault) => void; onRecover: () => void }) {
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
      <button className="btn btn--ghost welcome__recover" onClick={onRecover} disabled={loading}>
        Recover existing wallet
      </button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

type RecoverResult = { ok: true; vault: Vault } | { ok: false; err: string };

function RecoverScreen({ onRecovered, onBack }: { onRecovered: (v: Vault) => void; onBack: () => void }) {
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecoverResult | null>(null);

  async function recover() {
    const trimmed = address.trim();
    if (!trimmed.startsWith("0x") || trimmed.length < 42) { setResult({ ok: false, err: "Enter your wallet address (0x…)" }); return; }
    if (!/^\d{6}$/.test(code)) { setResult({ ok: false, err: "Enter the 6-digit code from your authenticator app" }); return; }
    setLoading(true);
    try {
      const v = await recoverFromTotp(trimmed, code);
      haptic("success");
      setResult({ ok: true, vault: v });
    } catch (e) {
      haptic("error");
      setResult({ ok: false, err: errMsg(e) });
    } finally {
      setLoading(false);
    }
  }

  async function paste() {
    const text = await navigator.clipboard.readText().catch(() => "");
    if (text) setAddress(text.trim());
  }

  if (result?.ok) {
    return (
      <div className="screen send-screen" style={{ justifyContent: "center" }}>
        <div className="tx-result" style={{ paddingTop: 0 }}>
          <img src="/icons8-success-96.png" className="tx-result__icon" alt="" />
          <p className="tx-result__title">Wallet recovered</p>
          <p className="tx-result__sub">Your wallet is restored on this device and ready to use.</p>
          <button className="btn btn--primary" style={{ width: "100%" }} onClick={() => onRecovered(result.vault)}>
            Go to wallet
          </button>
        </div>
      </div>
    );
  }

  if (result && !result.ok) {
    return (
      <div className="screen send-screen" style={{ justifyContent: "center" }}>
        <div className="tx-result" style={{ paddingTop: 0 }}>
          <img src="/icons8-fail-96.png" className="tx-result__icon" alt="" />
          <p className="tx-result__title">Recovery failed</p>
          <p className="tx-result__err">{result.err}</p>
          <button className="btn btn--primary" style={{ width: "100%" }} onClick={() => setResult(null)}>
            Try again
          </button>
          <button className="btn btn--ghost" style={{ width: "100%" }} onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen send-screen">
      <button className="back" onClick={onBack}>← Back</button>
      <h2 className="title title--sm">Recover wallet</h2>
      <p className="totp-setup__hint">Enter your wallet address and open your authenticator app for the 6-digit code.</p>

      <div className="field">
        <label>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          Wallet address
        </label>
        <div className="ca-row">
          <input
            className="ca-input"
            type="text"
            placeholder="0x…"
            value={address}
            onChange={e => setAddress(e.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="ca-paste-btn" onClick={paste}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
            Paste
          </button>
        </div>
      </div>

      <div className="field">
        <label>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
          Authenticator code
        </label>
        <input
          className="totp-setup__code-input"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </div>

      <button className="btn btn--primary" onClick={recover} disabled={loading || !address || code.length !== 6}>
        {loading ? "Recovering…" : "Recover wallet"}
      </button>
    </div>
  );
}

const BG_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map(n => `marmo_balance_${n}.jpg`);
const DEFAULT_BG = "marmo_balance_3.jpg";

function BgPickerDrawer({ current, onSelect, onClose }: {
  current: string;
  onSelect: (bg: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Card style</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="bg-grid">
          {BG_OPTIONS.map(bg => (
            <button
              key={bg}
              className={`bg-option${bg === current ? " bg-option--active" : ""}`}
              onClick={() => onSelect(bg)}
              style={{ backgroundImage: `url('/balance_card_media/${bg}')` }}
            >
              {bg === current && (
                <span className="bg-option__check">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SecurityModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">How Marmo protects you</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="modal-section">
          <div className="modal-section__icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div>
            <div className="modal-section__title">2-of-3 threshold security</div>
            <p className="modal-section__body">Your signing key is split into three independent shards. Any two are needed to move funds. No single shard can do anything alone.</p>
            <div className="shard-list">
              <div className="shard-item">
                <span className="shard-item__label">Device</span>
                <span className="shard-item__desc">Stored on this device. Signs locally, never leaves.</span>
              </div>
              <div className="shard-item">
                <span className="shard-item__label">Co-signer</span>
                <span className="shard-item__desc">Held by Marmo's server. Signs blind; it never sees your recipient or amount, only a hash.</span>
              </div>
              <div className="shard-item">
                <span className="shard-item__label">Passkey</span>
                <span className="shard-item__desc">In your device's secure enclave. Used for recovery if your device key is lost.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-divider" />

        <div className="modal-section">
          <div className="modal-section__icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          </div>
          <div>
            <div className="modal-section__title">Stealth addresses</div>
            <p className="modal-section__body">Every payment sent to your Marmo wallet lands at a unique one-time address derived from your public meta-address. No two payments share an on-chain link. An outside observer cannot tell they went to the same wallet.</p>
          </div>
        </div>

        <div className="modal-divider" />

        <div className="modal-section">
          <div className="modal-section__icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div>
            <div className="modal-section__title">Non-custodial</div>
            <p className="modal-section__body">Your wallet is a smart contract on Base. Marmo never holds your funds or controls your keys. If Marmo disappeared tomorrow, your assets are still yours, recoverable with any two shards.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardScreen({
  vault,
  balance,
  onSend,
  onReceive,
  onSwap,
  onRefresh,
  onSetupTotp,
  backupErr,
  onRetryBackup,
}: {
  vault: Vault;
  balance: BalanceResult | null;
  onSend: () => void;
  onReceive: () => void;
  onSwap: () => void;
  onRefresh: () => void;
  onSetupTotp: () => void;
  backupErr: string;
  onRetryBackup: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [dashTab, setDashTab] = useState<"tokens" | "history">("tokens");
  const [tokens, setTokens] = useState<WalletToken[]>([]);
  const [ethPrice, setEthPrice] = useState(0);
  const [priceOffline, setPriceOffline] = useState(false);
  const [selectedToken, setSelectedToken] = useState<WalletToken | null>(null);
  const [showAddToken, setShowAddToken] = useState(false);
  const [txBuffer, setTxBuffer] = useState<TxRecord[]>([]);
  const [txShown, setTxShown] = useState(0);
  const [txState, setTxState] = useState<TxFetchState | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txLoaded, setTxLoaded] = useState(false);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");
  const scrambledUsd = useScramble(balance?.usdValue ?? null);
  const scrambledEth = useScramble(balance?.eth ?? null);
  const scrambledEthUsd = useScramble(balance?.ethUsdValue ?? null);
  const [cardBg, setCardBg] = useState<string>(
    () => localStorage.getItem("marmo_card_bg") ?? DEFAULT_BG
  );

  useEffect(() => {
    let stale = false;
    fetchWalletTokens(vault.address).then(t => { if (!stale) setTokens(t); });
    loadPrice(false);
    return () => { stale = true; };
  }, [vault.address]);

  async function loadPrice(forceRefresh: boolean) {
    if (forceRefresh) {
      try { localStorage.removeItem("marmo_eth_price_cache"); } catch {}
    }
    const result = await fetchEthPrice();
    setEthPrice(result.price);
    if (result.failed && result.price === 0) {
      setPriceOffline(true);
    } else {
      setPriceOffline(false);
    }
  }

  useEffect(() => {
    if (dashTab !== "history" || txLoaded) return;
    loadMoreTx();
  }, [dashTab]);

  const txDone = txState ? txState.txDone && txState.tokenDone : false;

  async function loadMoreTx() {
    if (txBuffer.length - txShown >= TX_PAGE_SIZE) {
      setTxShown(s => s + TX_PAGE_SIZE);
      return;
    }
    if (txDone && txLoaded) {
      setTxShown(s => Math.min(s + TX_PAGE_SIZE, txBuffer.length));
      return;
    }
    setTxLoading(true);
    let buffer = txBuffer;
    let state = txState;
    while (buffer.length - txShown < TX_PAGE_SIZE) {
      const batch = await fetchTxBatch(vault.address, state);
      const seen = new Set(buffer.map(t => t.hash + t.tokenSymbol));
      buffer = [...buffer, ...batch.items.filter(t => !seen.has(t.hash + t.tokenSymbol))]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      state = batch.state;
      if (state.txDone && state.tokenDone) break;
    }
    setTxBuffer(buffer);
    setTxState(state);
    setTxShown(s => Math.min(s + TX_PAGE_SIZE, buffer.length));
    setTxLoaded(true);
    setTxLoading(false);
  }

  function switchTab(tab: "tokens" | "history") {
    if (tab === dashTab) return;
    setSlideDir(tab === "history" ? "right" : "left");
    setDashTab(tab);
  }

  function selectBg(bg: string) {
    setCardBg(bg);
    localStorage.setItem("marmo_card_bg", bg);
    setShowBgPicker(false);
  }

  async function copy() {
    await navigator.clipboard.writeText(vault.address);
    haptic("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="screen dashboard">
      {showHelp && <SecurityModal onClose={() => setShowHelp(false)} />}
      {showBgPicker && <BgPickerDrawer current={cardBg} onSelect={selectBg} onClose={() => setShowBgPicker(false)} />}
      {priceOffline && <OfflineDrawer onDismiss={() => setPriceOffline(false)} onRetry={() => loadPrice(true)} />}
      <div className="card" style={{ backgroundImage: `url('/balance_card_media/${cardBg}')` }} onClick={() => { onRefresh(); loadPrice(true); }} role="button" aria-label="Refresh balance">
        <div className="card__top">
          <span className="card__label">Marmo Wallet</span>
          <div className="card__actions">
            <button className="help-btn" onClick={e => { e.stopPropagation(); setShowBgPicker(true); }} aria-label="Card style">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button className="help-btn" onClick={e => { e.stopPropagation(); setShowHelp(true); }} aria-label="Security info">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>
            </button>
          </div>
        </div>
        <div className="balance">
          <span className="balance__usd">$ {scrambledUsd}</span>
          <span className="balance__eth">
            <img src="/eth.png" width={18} height={18} className="token-icon" alt="" />
            {scrambledEth}
            {balance?.ethUsdValue && <small className="balance__eth-usd"> (${scrambledEthUsd})</small>}
          </span>
        </div>
        <button className="addr" onClick={e => { e.stopPropagation(); copy(); }}>
          {shortAddress(vault.address)}
          <span className="addr__icon">{copied ? "✓" : <CopyIcon />}</span>
        </button>
      </div>

      <div className="actions">
        <div className="actions__row">
          <button className="btn btn--ghost" onClick={onReceive}>
            <img src="/icons8-recieve-96.png" width={18} height={18} alt="" />
            Receive
          </button>
          <button className="btn btn--primary" onClick={onSend}>
            <img src="/icons8-send-96.png" width={18} height={18} alt="" />
            Send
          </button>
        </div>
        <button className="btn btn--ghost actions__swap" onClick={onSwap}>
          <img src="/icons8-swap-96.png" width={18} height={18} alt="" />
          Swap
        </button>
      </div>

      {backupErr && (
        <button className="backup-err-banner" onClick={onRetryBackup}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Recovery backup failed: {backupErr} — tap to retry
        </button>
      )}

      {!vault.totpEnabled && !bannerDismissed && (
        <div className="totp-banner">
          <div className="totp-banner__top-row">
            <div className="totp-banner__icon-morph">
              <img src="/icons8-google-authenticator-96.png" className="totp-morph-a" width={28} height={28} alt="" />
              <img src="/icons8-microsoft-authenticator-96.png" className="totp-morph-b" width={28} height={28} alt="" />
            </div>
            <button className="totp-banner__dismiss" onClick={() => setBannerDismissed(true)} aria-label="Dismiss">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="totp-banner__body">
            <span className="totp-banner__title">Secure your recovery</span>
            <span className="totp-banner__sub">Set up an authenticator app so you can recover your wallet if you lose this device. Takes 30 seconds.</span>
          </div>
          <div className="totp-banner__footer">
            <button className="btn btn--primary totp-banner__cta" onClick={onSetupTotp}>Set up</button>
          </div>
        </div>
      )}

      <div className="dash-tabs">
        <div className="receive-tabs" style={{ marginBottom: 0 }}>
          <button className={`receive-tab${dashTab === "tokens" ? " active" : ""}`} onClick={() => switchTab("tokens")}>
            <img src="/icons8-tokens-96.png" width={15} height={15} alt="" />
            Tokens
          </button>
          <button className={`receive-tab${dashTab === "history" ? " active" : ""}`} onClick={() => switchTab("history")}>
            <img src="/icons8-history-96.png" width={15} height={15} alt="" />
            History
          </button>
        </div>

        <div className="dash-panel-viewport">
          <div key={dashTab} className={`dash-panel dash-panel--${slideDir}`}>
            {dashTab === "tokens" && (
              <div className="dash-token-list">
                {tokens.filter(t => parseFloat(t.balance) > 0).map(token => {
                  const price = getTokenPrice(token.symbol, ethPrice);
                  const usdVal = price > 0 ? (parseFloat(token.balance) * price) : null;
                  return (
                    <button key={token.address || "eth"} className="dash-token-item" onClick={() => setSelectedToken(token)}>
                      <div className="dash-token-item__left">
                        {token.logo ? <img src={token.logo} width={36} height={36} className="dash-token-item__logo" alt="" /> : <div className="dash-token-item__logo dash-token-item__logo--placeholder">{token.symbol[0]}</div>}
                        <div className="dash-token-item__info">
                          <span className="dash-token-item__name">{TOKEN_NAMES[token.symbol] ?? token.symbol}</span>
                          <span className="dash-token-item__price">{price > 0 ? `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}</span>
                        </div>
                      </div>
                      <div className="dash-token-item__right">
                        <span className="dash-token-item__balance">{token.balance}</span>
                        <span className="dash-token-item__usd">{usdVal != null ? `$${usdVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}</span>
                      </div>
                    </button>
                  );
                })}
                {tokens.every(t => parseFloat(t.balance) === 0) && (
                  <p className="dash-empty">No tokens yet</p>
                )}
                <p className="dash-basescan-note">
                  Not seeing a token?{" "}
                  <button className="dash-add-token-link" onClick={() => setShowAddToken(true)}>Add token</button>
                </p>
              </div>
            )}

            {dashTab === "history" && (
              <div className="dash-tx-list">
                {txBuffer.slice(0, txShown).map(tx => {
                  const out = tx.from.toLowerCase() === vault.address.toLowerCase();
                  const known = (tx.value !== "0" && tx.value !== "") || tx.isToken;
                  const amount = tx.isToken && tx.tokenAmount && tx.tokenSymbol
                    ? `${parseFloat(formatUnits(BigInt(tx.tokenAmount), parseInt(tx.tokenDecimal ?? "18"))).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${tx.tokenSymbol}`
                    : tx.value && tx.value !== "0" ? `${parseFloat(formatEther(BigInt(tx.value))).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH` : null;
                  return (
                    <a key={tx.hash + (tx.tokenSymbol ?? "")} className="dash-tx-item" href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noopener">
                      <div className="dash-tx-item__icon">
                        {!known
                          ? <span className="dash-tx-item__unknown">?</span>
                          : out
                            ? <img src="/icons8-top-right-96.png" width={18} height={18} alt="out" />
                            : <img src="/icons8-bottom-left-100.png" width={18} height={18} alt="in" />
                        }
                      </div>
                      <div className="dash-tx-item__body">
                        <span className="dash-tx-item__hash">{tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}</span>
                        {amount && <span className="dash-tx-item__amount">{out ? "-" : "+"}{amount}</span>}
                      </div>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dash-tx-item__ext"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  );
                })}
                {txLoaded && txBuffer.length === 0 && !txLoading && (
                  <p className="dash-empty">
                    No transactions yet.<br />
                    Not seeing a transaction?{" "}
                    <a className="dash-basescan-link" href={`https://basescan.org/address/${vault.address}`} target="_blank" rel="noopener">View full history on Basescan ↗</a>
                  </p>
                )}
                {txLoading && <p className="dash-empty">Loading…</p>}
                {!txLoading && (txShown < txBuffer.length || !txDone) && txBuffer.length > 0 && (
                  <button className="btn btn--ghost dash-load-more" onClick={loadMoreTx}>Load more</button>
                )}
                {!txLoading && txBuffer.length > 0 && (
                  <p className="dash-basescan-note">
                    Not seeing a transaction?{" "}
                    <a className="dash-basescan-link" href={`https://basescan.org/address/${vault.address}`} target="_blank" rel="noopener">View full history on Basescan ↗</a>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedToken && <TokenDrawer token={selectedToken} ethPrice={ethPrice} onClose={() => setSelectedToken(null)} />}
      {showAddToken && (
        <AddTokenModal
          walletAddress={vault.address}
          onAdd={(tok) => setTokens(prev => prev.some(t => t.address.toLowerCase() === tok.address.toLowerCase()) ? prev : [...prev, tok])}
          onClose={() => setShowAddToken(false)}
        />
      )}
    </div>
  );
}

const TOKEN_NAMES: Record<string, string> = {
  ETH:   "Ethereum",
  USDC:  "USD Coin",
  USDT:  "Tether USD",
  WETH:  "Wrapped Ether",
  DAI:   "Dai Stablecoin",
  USDbC: "USD Base Coin",
  cbETH: "Coinbase Wrapped ETH",
};

function getTokenPrice(symbol: string, ethPrice: number): number {
  if (["USDC", "USDT", "DAI", "USDbC"].includes(symbol)) return 1;
  if (["ETH", "WETH", "cbETH"].includes(symbol)) return ethPrice;
  return 0;
}

function TokenDrawer({ token, ethPrice, onClose }: { token: WalletToken; ethPrice: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const price = getTokenPrice(token.symbol, ethPrice);

  async function copyCA() {
    if (!token.address) return;
    await navigator.clipboard.writeText(token.address);
    haptic("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel token-drawer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{TOKEN_NAMES[token.symbol] ?? token.symbol}</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="token-drawer__price">
          {price > 0 ? `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
        </div>

        <div className="token-drawer__rows">
          <div className="token-drawer__row">
            <span className="token-drawer__label">Symbol</span>
            <span className="token-drawer__val">{token.symbol}</span>
          </div>
          <div className="token-drawer__row">
            <span className="token-drawer__label">Name</span>
            <span className="token-drawer__val">{TOKEN_NAMES[token.symbol] ?? token.symbol}</span>
          </div>
          {token.address ? (
            <button className="token-drawer__row token-drawer__row--btn" onClick={copyCA}>
              <span className="token-drawer__label">Contract</span>
              <span className="token-drawer__val token-drawer__val--addr">
                {token.address.slice(0, 8)}…{token.address.slice(-6)}
                <span className="token-drawer__copy">{copied ? "✓" : <CopyIcon />}</span>
              </span>
            </button>
          ) : (
            <div className="token-drawer__row">
              <span className="token-drawer__label">Contract</span>
              <span className="token-drawer__val">Native token</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OfflineDrawer({ onDismiss, onRetry }: { onDismiss: () => void; onRetry: () => void }) {
  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal-panel offline-drawer" onClick={e => e.stopPropagation()}>
        <img src="/icons8-without-internet-96.png" width={52} height={52} className="offline-drawer__icon" alt="" />
        <h3 className="offline-drawer__title">No internet connection</h3>
        <p className="offline-drawer__body">
          We couldn't get real-time prices for your tokens. Your funds are safe — this only affects displayed USD values. Check your connection and try again.
        </p>
        <div className="offline-drawer__actions">
          <button className="btn btn--primary" onClick={() => { onRetry(); onDismiss(); }}>Try again</button>
          <button className="btn btn--ghost" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

type ClaimResult = { ok: true; hashes: string[] } | { ok: false; err: string };

function ReceiveScreen({ vault, onBack }: { vault: Vault; onBack: () => void }) {
  const [tab, setTab] = useState<"standard" | "private">("standard");
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");

  function switchReceiveTab(next: "standard" | "private") {
    if (next === tab) return;
    setSlideDir(next === "private" ? "right" : "left");
    setTab(next);
  }

  const [scanning, setScanning] = useState(false);
  const [payments, setPayments] = useState<StealthPayment[] | null>(null);
  const [scanErr, setScanErr] = useState("");
  const [sweeping, setSweeping] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);

  const [registered, setRegistered] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [showStealthHelp, setShowStealthHelp] = useState(false);
  const [hideTiny, setHideTiny] = useState(true);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown > 0]);

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

  async function scan() {
    if (scanning || cooldown > 0) return;
    setScanning(true);
    setScanErr("");
    setPayments(null);
    try {
      if (!registered) {
        await registerStealth(vault);
        setRegistered(true);
      }
      const found = await scanStealthPayments(vault);
      setPayments(found);
    } catch (e) {
      setScanErr(errMsg(e));
    } finally {
      setScanning(false);
      setCooldown(30);
    }
  }

  async function sweep(p: StealthPayment) {
    setSweeping(p.stealthAddress);
    try {
      const hashes = await sweepStealthPayment(vault, p);
      haptic("success");
      setClaimResult({ ok: true, hashes });
    } catch (e) {
      haptic("error");
      setClaimResult({ ok: false, err: errMsg(e) });
    } finally {
      setSweeping(null);
    }
  }

  if (claimResult) {
    return (
      <div className="screen send-screen tx-result">
        <img
          src={claimResult.ok ? "/icons8-success-96.png" : "/icons8-fail-96.png"}
          className="tx-result__icon"
          alt=""
        />
        <h2 className="tx-result__title">{claimResult.ok ? "Claimed!" : "Claim Failed"}</h2>

        {claimResult.ok ? (
          <>
            <p className="tx-result__sub">Your funds have been moved to your main wallet.</p>
            <div className="claim-result__links">
              {claimResult.hashes.map((h, i) => (
                <a key={h} className="btn btn--ghost claim-result__link" href={`https://basescan.org/tx/${h}`} target="_blank" rel="noopener">
                  {claimResult.hashes.length > 1 ? `Transaction ${i + 1}` : "View on Basescan"} ↗
                </a>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="tx-result__err">{claimResult.err}</p>
            <button className="btn btn--primary" onClick={() => setClaimResult(null)}>Try Again</button>
          </>
        )}

        <button className="btn btn--ghost" onClick={() => setClaimResult(null)}>
          {claimResult.ok ? "Done" : "Back"}
        </button>
      </div>
    );
  }

  return (
    <div className="screen send-screen">
      <button className="back" onClick={onBack}>← Back</button>
      <h2 className="title title--sm">Receive</h2>

      <div className="receive-tabs">
        <button className={`receive-tab${tab === "standard" ? " active" : ""}`} onClick={() => switchReceiveTab("standard")}>Standard</button>
        <button className={`receive-tab${tab === "private" ? " active" : ""}`} onClick={() => switchReceiveTab("private")}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:"0.3rem"}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Private
        </button>
      </div>

      <div className="dash-panel-viewport">
      <div key={tab} className={`dash-panel dash-panel--${slideDir}`}>
      {tab === "standard" && (
        <>
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
        </>
      )}

      {tab === "private" && (
        <>
          <div className="stealth-explain">
            <p>Share your stealth meta-address so senders can pay you privately. Each payment lands at a unique one-time address. Only you can detect and claim it.</p>
          </div>

          <div className="stealth-meta-card">
            <div className="stealth-meta-card__label">Your stealth meta-address</div>
            <div className="stealth-meta-card__addr">{meta.slice(0, 20)}…{meta.slice(-10)}</div>
            <button className="btn btn--ghost" onClick={copyMeta} style={{ marginTop: "0.75rem", width: "100%" }}>
              <CopyIcon /> Copy full meta-address
            </button>
          </div>

          {showStealthHelp && (
            <div className="modal-overlay" onClick={() => setShowStealthHelp(false)}>
              <div className="modal-panel" onClick={e => e.stopPropagation()}>
                <div className="modal-panel__handle" />
                <h3 className="modal-panel__title">How private payments work</h3>
                <div className="stealth-help-body">
                  <div className="stealth-help-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    <p>The sender used your stealth meta-address to generate a unique one-time address that only you can detect. Nobody watching the blockchain can link it to you.</p>
                  </div>
                  <div className="stealth-help-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <p>Scanning checks recent blockchain activity and uses your private keys to find payments meant for you. Nothing is shared with any server during this check.</p>
                  </div>
                  <div className="stealth-help-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
                    <p><strong>Claiming</strong> moves the funds from that one-time address into your main wallet. It is the final step to access what was sent to you privately.</p>
                  </div>
                  <div className="stealth-help-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    <p><strong>Hide tiny amounts</strong> filters out leftover dust — trace amounts of ETH (under 0.0001 ETH) left behind after claiming. These are a side-effect of how gas fees work and have no real value.</p>
                  </div>
                </div>
                <button className="btn btn--ghost" style={{ width: "100%", marginTop: "0.5rem" }} onClick={() => setShowStealthHelp(false)}>Got it</button>
              </div>
            </div>
          )}

          <div className="stealth-scan-section">
            <span className="stealth-scan-section__title">Incoming private payments</span>
            <button className="btn btn--ghost" onClick={scan} disabled={scanning || cooldown > 0} style={{ width: "100%" }}>
              {scanning
                ? <><svg className="swap-fetching__spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{marginRight:"0.35rem"}}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Scanning…</>
                : cooldown > 0 ? `Scan again in ${cooldown}s`
                : "Scan for payments"}
            </button>

            {payments && payments.length > 0 && (
              <div className="stealth-meta-row">
                <button className="stealth-help-btn" onClick={() => setShowStealthHelp(true)} aria-label="How does this work?">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  How does this work?
                </button>
                <label className="tiny-toggle">
                  <span className="tiny-toggle__label">Hide tiny amounts</span>
                  <button
                    role="switch"
                    aria-checked={hideTiny}
                    className={`toggle-pill${hideTiny ? " on" : ""}`}
                    onClick={() => setHideTiny(v => !v)}
                  />
                </label>
              </div>
            )}

            {scanErr && <p className="err">{scanErr}</p>}

            {payments !== null && payments.length === 0 && (
              <p className="stealth-scan-empty">No private payments found in the last ~50k blocks.</p>
            )}

            {payments && payments.length > 0 && (() => {
              const DUST_ETH = 100_000_000_000_000n;
              const DUST_STABLE = 0.005;
              const DUST_OTHER = 0.000005;
              const visible = hideTiny
                ? payments.filter(p => {
                    if (p.tokens.length > 0) {
                      const allTokensDust = p.tokens.every(t => {
                        const threshold = t.decimals <= 6 ? DUST_STABLE : DUST_OTHER;
                        return parseFloat(t.balance) < threshold;
                      });
                      if (!allTokensDust) return true;
                    }
                    return p.ethRaw >= DUST_ETH || (p.tokens.length > 0 && p.tokens.some(t => {
                      const threshold = t.decimals <= 6 ? DUST_STABLE : DUST_OTHER;
                      return parseFloat(t.balance) >= threshold;
                    }));
                  })
                : payments;
              return visible.length === 0 ? (
                <p className="stealth-scan-empty">All payments are dust amounts. Toggle off "Hide tiny amounts" to see them.</p>
              ) : (
                <div className="stealth-payment-list">
                  {visible.map(p => (
                    <div key={p.stealthAddress} className="stealth-payment">
                      <div className="stealth-payment__assets">
                        {p.ethRaw > 0n && <span className="stealth-payment__eth">{p.ethBalance} ETH</span>}
                        {p.tokens.map(t => (
                          <span key={t.address} className="stealth-payment__eth">
                            {parseFloat(t.balance).toFixed(t.decimals <= 6 ? 2 : 5).replace(/\.?0+$/, "")} {t.symbol}
                          </span>
                        ))}
                        <span className="stealth-payment__addr">{shortAddress(p.stealthAddress)}</span>
                      </div>
                      <button
                        className="btn btn--primary stealth-payment__claim"
                        onClick={() => sweep(p)}
                        disabled={sweeping === p.stealthAddress}
                      >
                        {sweeping === p.stealthAddress ? "Claiming…" : "Claim"}
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </>
      )}
      </div>
      </div>
    </div>
  );
}

function TokenLogo({ logo, symbol }: { logo: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) return <span className="token-logo token-logo--fallback">?</span>;
  return <img src={logo} width={20} height={20} className="token-logo" alt={symbol} onError={() => setFailed(true)} />;
}

function TokenSelector({ value, onChange, tokens }: {
  value: string;
  onChange: (v: string) => void;
  tokens: WalletToken[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = tokens.find(t => t.address === value) ?? tokens[0];

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
        {current && <TokenLogo logo={current.logo} symbol={current.symbol} />}
        <span>{current?.symbol ?? "Select"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="token-selector__menu">
          {tokens.map((tok) => (
            <button
              key={tok.address}
              type="button"
              className={`token-selector__option${value === tok.address ? " token-selector__option--active" : ""}`}
              onClick={() => { onChange(tok.address); setOpen(false); }}
            >
              <TokenLogo logo={tok.logo} symbol={tok.symbol} />
              <span>{tok.symbol}</span>
              <span className="token-selector__bal">{tok.balance}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddTokenModal({ walletAddress, onAdd, onClose }: {
  walletAddress: string;
  onAdd: (token: WalletToken) => void;
  onClose: () => void;
}) {
  const [ca, setCa] = useState("");
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<WalletToken | null>(null);
  const [err, setErr] = useState("");

  const isValid = /^0x[0-9a-fA-F]{40}$/.test(ca.trim());

  async function lookup() {
    if (!isValid) return;
    setFetching(true);
    setErr("");
    setPreview(null);
    try {
      const tok = await fetchTokenByAddress(walletAddress, ca.trim());
      setPreview(tok);
    } catch {
      setErr("Could not find a token at that address.");
    } finally {
      setFetching(false);
    }
  }

  function paste() {
    const apply = (text: string | null) => {
      const val = text?.trim() ?? "";
      if (val) { setCa(val); setPreview(null); setErr(""); }
      else setErr("Nothing in clipboard. Long-press the field and tap Paste.");
    };

    navigator.clipboard.readText().then(apply).catch(() => {
      const tg = (window as { Telegram?: { WebApp?: { readTextFromClipboard?: (cb: (t: string | null) => void) => void } } }).Telegram?.WebApp;
      if (tg?.readTextFromClipboard) tg.readTextFromClipboard(apply);
      else setErr("Long-press the field below and tap Paste.");
    });
  }

  function confirm() {
    if (!preview) return;
    saveCustomTokenAddress(walletAddress, preview.address);
    onAdd(preview);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Add token</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <p className="modal-hint">Paste the contract address of any token you hold on Base.</p>
        <div className="ca-row">
          <input
            className="ca-input"
            placeholder="0x…"
            value={ca}
            onChange={e => { setCa(e.target.value); setPreview(null); setErr(""); }}
            onPaste={e => {
              const text = e.clipboardData.getData("text").trim();
              if (text) { e.preventDefault(); setCa(text); setPreview(null); setErr(""); }
            }}
            style={{ fontSize: "16px" }}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="ca-paste-btn" onClick={paste}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="5" y="6" width="14" height="16" rx="2"/><path d="M9 2H7a2 2 0 0 0-2 2v2"/><path d="M15 2h2a2 2 0 0 1 2 2v2"/></svg>
            Paste
          </button>
        </div>
        {err && <p className="err" style={{ marginTop: "0.6rem" }}>{err}</p>}
        {preview && (
          <div className="ca-preview">
            {preview.logo && <img src={preview.logo} width={22} height={22} className="token-icon" alt="" />}
            <span className="ca-preview__sym">{preview.symbol}</span>
            <span className="ca-preview__bal">{preview.balance} available</span>
          </div>
        )}
        <div style={{ marginTop: "1.2rem" }}>
          {!preview ? (
            <button className="btn btn--primary" onClick={lookup} disabled={!isValid || fetching} style={{ width: "100%" }}>
              {fetching ? "Looking up…" : "Look up"}
            </button>
          ) : (
            <button className="btn btn--primary" onClick={confirm} style={{ width: "100%" }}>
              Add {preview.symbol}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type TxResult = { ok: true; hash: string } | { ok: false; message: string };

type SendStep = "input" | "preview" | "result";

function SendScreen({ vault, balance, onBack }: { vault: Vault; balance: BalanceResult | null; onBack: () => void }) {
  const [tab, setTab] = useState<"standard" | "private">("standard");
  const [step, setStep] = useState<SendStep>("input");
  const [anim, setAnim] = useState<"in" | "out">("in");
  const [tokens, setTokens] = useState<WalletToken[]>([{ address: "", symbol: "ETH", decimals: 18, balance: "0", logo: "/eth.png" }]);
  const [token, setToken] = useState("");
  const [showAddToken, setShowAddToken] = useState(false);
  const [amountMode, setAmountMode] = useState<"token" | "usd">("token");
  const [amountRaw, setAmountRaw] = useState("");
  const [to, setTo] = useState("");
  const [ethPrice, setEthPrice] = useState(0);
  const [loading, setLoading] = useState(false);
  const [txResult, setTxResult] = useState<TxResult | null>(null);
  const [err, setErr] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchEthPrice().then(r => setEthPrice(r.price));
    fetchWalletTokens(vault.address).then(setTokens);
  }, [vault.address]);

  useEffect(() => {
    if (step === "input") setTimeout(() => amountRef.current?.focus(), 80);
  }, [step]);

  function goStep(s: SendStep) {
    setAnim("out");
    setTimeout(() => { setStep(s); setAnim("in"); }, 150);
  }

  const tokenInfo = tokens.find(t => t.address === token) ?? tokens[0];
  const isStablecoin = token !== "" && (tokenInfo.symbol === "USDC" || tokenInfo.symbol === "USDT" || tokenInfo.symbol === "DAI");
  const price = isStablecoin ? 1 : ethPrice;
  const parsed = parseFloat(amountRaw) || 0;
  const tokenAmount = amountMode === "token" ? parsed : (price > 0 ? parsed / price : 0);
  const usdAmount = amountMode === "usd" ? parsed : parsed * price;
  const decimals = tokenInfo?.decimals ?? 18;
  const sendAmountWei = BigInt(Math.round(tokenAmount * 10 ** decimals)).toString();
  const overBalance = tokenAmount > 0 && parseFloat(tokenInfo.balance || "0") > 0 && tokenAmount > parseFloat(tokenInfo.balance);

  useEffect(() => {
    if (overBalance) try { navigator.vibrate?.(120); } catch {}
  }, [overBalance]);

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
    if (tab === "standard") {
      if (!to.startsWith("0x") || to.length !== 42) { setErr("Enter a valid 0x address"); return; }
    } else {
      if (!to.startsWith("0x") || to.length !== 134) { setErr("Enter a valid stealth meta-address (134 chars)"); return; }
    }
    setErr("");
    goStep("preview");
  }

  async function submit() {
    setLoading(true);
    setErr("");
    setTxResult(null);
    try {
      const serverKey = privateKeyToAddress(vault.shardAPrivKey);
      let hash: string;
      if (tab === "private") {
        const cd = await core.buildStealthSend(serverKey, vault.apiKey, to, sendAmountWei, token || undefined);
        hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      } else {
        const cd = await core.buildSend(serverKey, vault.apiKey, to, sendAmountWei, token || undefined);
        hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      }
      haptic("success");
      setTxResult({ ok: true, hash });
      goStep("result");
    } catch (e) {
      haptic("error");
      setTxResult({ ok: false, message: errMsg(e) });
      goStep("result");
    } finally {
      setLoading(false);
    }
  }

  if (step === "result" && txResult) {
    const short = txResult.ok ? `${txResult.hash.slice(0, 10)}…${txResult.hash.slice(-8)}` : "";
    const sentTitle = txResult.ok ? (tab === "private" ? "Sent privately!" : "Sent!") : "Transaction Failed";
    return (
      <div key="result" className={`screen send-screen tx-result screen-anim screen-anim--${anim}`}>
        <img
          src={txResult.ok ? "/icons8-success-96.png" : "/icons8-fail-96.png"}
          className="tx-result__icon"
          alt=""
        />
        <h2 className="tx-result__title">{sentTitle}</h2>

        {txResult.ok ? (
          <>
            <div className="tx-result__hash-row">
              <span className="tx-result__hash">{short}</span>
              <button className="tx-result__copy" onClick={() => navigator.clipboard.writeText(txResult.hash)} aria-label="Copy tx hash">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
            <a className="btn btn--primary tx-result__basescan" href={`https://basescan.org/tx/${txResult.hash}`} target="_blank" rel="noopener">
              Open in Basescan ↗
            </a>
          </>
        ) : (
          <>
            <p className="tx-result__err">{txResult.message}</p>
            <button className="btn btn--primary" onClick={submit} disabled={loading}>
              {loading ? "Retrying…" : "Try Again"}
            </button>
          </>
        )}

        <button className="btn btn--ghost" onClick={onBack}>Close</button>
      </div>
    );
  }

  if (step === "preview") {
    return (
      <div key="preview" className={`screen send-screen screen-anim screen-anim--${anim}`}>
        <button className="back" onClick={() => { goStep("input"); setErr(""); }}>← Edit</button>
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
            {tab === "private"
              ? <span className="preview-row__val preview-row__val--private">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  Private recipient
                </span>
              : <span className="preview-row__val preview-row__val--mono">{shortAddress(to)}</span>
            }
          </div>
          {tab === "private" && (
            <div className="preview-row">
              <span className="preview-row__key">Privacy</span>
              <span className="preview-row__val">One-time stealth address</span>
            </div>
          )}
          <div className="preview-row">
            <span className="preview-row__key">Network</span>
            <span className="preview-row__val">Base</span>
          </div>
          <div className="preview-row">
            <span className="preview-row__key">Signing</span>
            <span className="preview-row__val">Device + Co-signer</span>
          </div>
        </div>

        <button className="btn btn--primary" onClick={submit} disabled={loading}>
          {loading ? "Signing…" : "Confirm & Send"}
        </button>

        {err && <p className="err">{err}</p>}
      </div>
    );
  }

  return (
    <div key="input" className={`screen send-screen screen-anim screen-anim--${anim}`}>
      {showAddToken && (
        <AddTokenModal
          walletAddress={vault.address}
          onAdd={(tok) => {
            setTokens(prev => prev.find(t => t.address === tok.address) ? prev : [...prev, tok]);
            setToken(tok.address);
            setAmountRaw("");
          }}
          onClose={() => setShowAddToken(false)}
        />
      )}
      <button className="back" onClick={onBack}>← Back</button>

      <div className="receive-tabs">
        <button className={`receive-tab${tab === "standard" ? " active" : ""}`} onClick={() => { setTab("standard"); setTo(""); setErr(""); }}>Standard</button>
        <button className={`receive-tab${tab === "private" ? " active" : ""}`} onClick={() => { setTab("private"); setTo(""); setErr(""); }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:"0.3rem"}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Private
        </button>
      </div>

      <div className="field">
        <label>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Token
        </label>
        <div className="token-field-row">
          <TokenSelector value={token} onChange={(v) => { setToken(v); setAmountRaw(""); }} tokens={tokens} />
          <button className="add-token-btn" onClick={() => setShowAddToken(true)} aria-label="Add token">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>

      <div className="amount-wrap" onClick={() => amountRef.current?.focus()}>
        <div className="amount-display">
          {amountMode === "usd" && amountRaw && <span className="amount-prefix">$</span>}
          <input
            ref={amountRef}
            className={`amount-input${overBalance ? " amount-input--over" : ""}`}
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
        {tokenInfo && (
          <button
            className="amount-max"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAmountMode("token");
              setAmountRaw(tokenInfo.balance);
            }}
          >
            Max
          </button>
        )}
      </div>

      {tab === "standard" ? (
        <div className="field">
          <label>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Recipient
          </label>
          <div className="ca-row">
            <input
              className="ca-input"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              onPaste={(e) => { const t = e.clipboardData.getData("text").trim(); if (t) { e.preventDefault(); setTo(t); } }}
              placeholder="0x…"
              style={{ fontSize: "16px" }}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="ca-paste-btn" onClick={async () => {
              try { setTo((await navigator.clipboard.readText()).trim()); }
              catch { setErr("Nothing in clipboard. Long-press the field and tap Paste."); }
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="5" y="6" width="14" height="16" rx="2"/><path d="M9 2H7a2 2 0 0 0-2 2v2"/><path d="M15 2h2a2 2 0 0 1 2 2v2"/></svg>
              Paste
            </button>
          </div>
        </div>
      ) : (
        <div className="field">
          <label>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Recipient stealth meta-address
          </label>
          <div className="ca-row">
            <input
              className="ca-input"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              onPaste={(e) => { const t = e.clipboardData.getData("text").trim(); if (t) { e.preventDefault(); setTo(t); } }}
              placeholder="0x… (134 chars)"
              style={{ fontSize: "13px" }}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="ca-paste-btn" onClick={async () => {
              try { setTo((await navigator.clipboard.readText()).trim()); }
              catch { setErr("Nothing in clipboard. Long-press the field and tap Paste."); }
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="5" y="6" width="14" height="16" rx="2"/><path d="M9 2H7a2 2 0 0 0-2 2v2"/><path d="M15 2h2a2 2 0 0 1 2 2v2"/></svg>
              Paste
            </button>
          </div>
          <p className="send-private-hint">The recipient shares this from their Receive &gt; Private tab.</p>
        </div>
      )}

      <div className="quorum">
        Signing with <strong>Device</strong> + <strong>Co-signer</strong>
      </div>

      {err && <p className="err">{err}</p>}

      <button className="btn btn--primary" onClick={goPreview} disabled={!parsed || !to || overBalance}>
        Preview
      </button>
    </div>
  );
}

interface SwapToken { address: string; symbol: string; decimals: number; logo: string; }

const SWAP_TOKENS: SwapToken[] = [
  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC",  decimals: 6,  logo: "/usdc.png" },
  { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", symbol: "USDT",  decimals: 6,  logo: "" },
  { address: "0x4200000000000000000000000000000000000006", symbol: "WETH",  decimals: 18, logo: "/eth.png" },
  { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI",   decimals: 18, logo: "" },
  { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", symbol: "USDbC", decimals: 6,  logo: "" },
];

function SwapTokenLogo({ logo, symbol, size = 28 }: { logo: string; symbol: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (logo && !err) {
    return <img src={logo} width={size} height={size} className="swap-tok-logo" alt="" onError={() => setErr(true)} />;
  }
  return (
    <div className="swap-tok-logo swap-tok-logo--fallback" style={{ width: size, height: size }}>
      {symbol[0] ?? "?"}
    </div>
  );
}

function SwapTokenModal({
  walletAddress, exclude, onSelect, onClose,
}: { walletAddress: string; exclude: string; onSelect: (t: SwapToken) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [extra, setExtra] = useState<SwapToken | null>(null);
  const [looking, setLooking] = useState(false);

  const isCA = /^0x[0-9a-fA-F]{40}$/.test(search.trim());

  useEffect(() => {
    if (!isCA) { setExtra(null); return; }
    setLooking(true);
    fetchTokenByAddress(walletAddress, search.trim())
      .then(tok => setExtra(tok ? { address: tok.address, symbol: tok.symbol, decimals: tok.decimals, logo: "" } : null))
      .catch(() => setExtra(null))
      .finally(() => setLooking(false));
  }, [search, walletAddress]);

  function paste() {
    const apply = (text: string | null) => {
      const val = text?.trim() ?? "";
      if (val) setSearch(val);
    };
    navigator.clipboard.readText().then(apply).catch(() => {
      const tg = (window as { Telegram?: { WebApp?: { readTextFromClipboard?: (cb: (t: string | null) => void) => void } } }).Telegram?.WebApp;
      if (tg?.readTextFromClipboard) tg.readTextFromClipboard(apply);
    });
  }

  const base = SWAP_TOKENS.filter(t =>
    t.address !== exclude &&
    (t.symbol.toLowerCase().includes(search.toLowerCase()) || t.address.toLowerCase().includes(search.toLowerCase()))
  );
  const list: SwapToken[] = extra ? [extra, ...base.filter(t => t.address !== extra.address)] : base;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Select token</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="ca-row">
          <input
            className="ca-input"
            placeholder="Search or paste contract address"
            value={search}
            autoFocus
            style={{ fontSize: "16px" }}
            autoComplete="off"
            spellCheck={false}
            onChange={e => setSearch(e.target.value)}
            onPaste={e => {
              const text = e.clipboardData.getData("text").trim();
              if (text) { e.preventDefault(); setSearch(text); }
            }}
          />
          <button className="ca-paste-btn" onClick={paste}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="5" y="6" width="14" height="16" rx="2"/><path d="M9 2H7a2 2 0 0 0-2 2v2"/><path d="M15 2h2a2 2 0 0 1 2 2v2"/></svg>
            Paste
          </button>
        </div>

        {looking && <p className="modal-hint" style={{ marginTop: "0.75rem" }}>Looking up token…</p>}

        <div className="swap-token-list">
          {list.map(t => (
            <button key={t.address} className="swap-token-item" onClick={() => { onSelect(t); onClose(); }}>
              <SwapTokenLogo logo={t.logo} symbol={t.symbol} size={36} />
              <div className="swap-token-item__info">
                <span className="swap-token-item__sym">{t.symbol}</span>
                <span className="swap-token-item__addr">{t.address.slice(0, 6)}…{t.address.slice(-4)}</span>
              </div>
            </button>
          ))}
          {list.length === 0 && !looking && <p className="modal-hint" style={{ marginTop: "0.75rem" }}>No tokens found.</p>}
        </div>
      </div>
    </div>
  );
}

const STABLE_ADDRESSES = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
]);
const WETH_BASE = "0x4200000000000000000000000000000000000006";

async function fetchEthUsdPrice(): Promise<number | null> {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const d = await r.json() as { ethereum?: { usd?: number } };
    return d.ethereum?.usd ?? null;
  } catch { return null; }
}

function usdLabel(address: string, balance: string, ethPrice: number | null): string | null {
  const bal = parseFloat(balance);
  if (!bal) return null;
  if (STABLE_ADDRESSES.has(address.toLowerCase())) return `$${bal.toFixed(2)}`;
  if (address.toLowerCase() === WETH_BASE && ethPrice) {
    return `$${(bal * ethPrice).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return null;
}

function SwapScreen({ vault, onBack }: { vault: Vault; onBack: () => void }) {
  const [allTokens, setAllTokens] = useState<SwapToken[]>(SWAP_TOKENS);
  const [tokenIn, setTokenIn] = useState<SwapToken>(SWAP_TOKENS[0]);
  const [tokenOut, setTokenOut] = useState<SwapToken>(SWAP_TOKENS[2]);
  const [picker, setPicker] = useState<"in" | "out" | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [quote, setQuote] = useState<{ amountOut: string; fee: number } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [step, setStep] = useState<"input" | "result">("input");
  const [loading, setLoading] = useState(false);
  const [txResult, setTxResult] = useState<TxResult | null>(null);
  const [walletTokens, setWalletTokens] = useState<WalletToken[]>([]);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [slippage, setSlippage] = useState(50);
  const [showSlippage, setShowSlippage] = useState(false);
  const [slippageCustom, setSlippageCustom] = useState("");

  useEffect(() => {
    fetchWalletTokens(vault.address).then(setWalletTokens).catch(() => {});
    fetchEthUsdPrice().then(setEthPrice).catch(() => {});
  }, [vault.address]);

  const parsed = parseFloat(amountRaw) || 0;
  const amountIn = parsed > 0 ? BigInt(Math.round(parsed * 10 ** tokenIn.decimals)).toString() : "0";

  const balanceIn = walletTokens.find(t => t.address.toLowerCase() === tokenIn.address.toLowerCase())?.balance ?? null;
  const balanceOut = walletTokens.find(t => t.address.toLowerCase() === tokenOut.address.toLowerCase())?.balance ?? null;
  const overSwap = balanceIn !== null && parsed > 0 && parseFloat(balanceIn) > 0 && parsed > parseFloat(balanceIn);

  useEffect(() => {
    if (overSwap) try { navigator.vibrate?.(120); } catch {}
  }, [overSwap]);

  useEffect(() => {
    setQuote(null);
    if (!parsed || tokenIn.address === tokenOut.address) return;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await core.getQuote(tokenIn.address, tokenOut.address, amountIn);
        setQuote(q);
      } catch { setQuote(null); }
      finally { setQuoting(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [amountRaw, tokenIn.address, tokenOut.address]);

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountRaw("");
    setQuote(null);
  }

  function selectToken(side: "in" | "out", tok: SwapToken) {
    const merged = allTokens.find(t => t.address === tok.address) ? allTokens : [...allTokens, tok];
    setAllTokens(merged);
    if (side === "in") {
      setTokenIn(tok);
      if (tok.address === tokenOut.address) setTokenOut(tokenIn);
    } else {
      setTokenOut(tok);
      if (tok.address === tokenIn.address) setTokenIn(tokenOut);
    }
    setAmountRaw("");
    setQuote(null);
  }

  async function submit() {
    setLoading(true);
    try {
      const cosignKey = privateKeyToAddress(vault.shardAPrivKey);
      const cd = await core.buildSwap(cosignKey, vault.apiKey, tokenIn.address, tokenOut.address, amountIn, slippage);
      const hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      haptic("success");
      setTxResult({ ok: true, hash });
    } catch (e) {
      haptic("error");
      setTxResult({ ok: false, message: errMsg(e) });
    } finally {
      setLoading(false);
      setStep("result");
    }
  }

  const outAmount = quote
    ? (Number(BigInt(quote.amountOut)) / 10 ** tokenOut.decimals)
        .toFixed(tokenOut.decimals <= 6 ? 4 : 6).replace(/\.?0+$/, "")
    : "";

  if (step === "result" && txResult) {
    const short = txResult.ok ? `${txResult.hash.slice(0, 10)}…${txResult.hash.slice(-8)}` : "";
    return (
      <div className="screen send-screen tx-result">
        <img src={txResult.ok ? "/icons8-success-96.png" : "/icons8-fail-96.png"} className="tx-result__icon" alt="" />
        <h2 className="tx-result__title">{txResult.ok ? "Swapped!" : "Swap Failed"}</h2>
        {txResult.ok ? (
          <>
            <div className="tx-result__hash-row">
              <span className="tx-result__hash">{short}</span>
              <button className="tx-result__copy" onClick={() => navigator.clipboard.writeText(txResult.hash)} aria-label="Copy">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
            <a className="btn btn--primary tx-result__basescan" href={`https://basescan.org/tx/${txResult.hash}`} target="_blank" rel="noopener">Open in Basescan ↗</a>
          </>
        ) : (
          <>
            <p className="tx-result__err">{txResult.message}</p>
            <button className="btn btn--primary" onClick={submit} disabled={loading}>{loading ? "Retrying…" : "Try Again"}</button>
          </>
        )}
        <button className="btn btn--ghost" onClick={onBack}>Close</button>
      </div>
    );
  }

  return (
    <div className="screen send-screen">
      {picker && (
        <SwapTokenModal
          walletAddress={vault.address}
          exclude={picker === "in" ? tokenIn.address : tokenOut.address}
          onSelect={tok => selectToken(picker, tok)}
          onClose={() => setPicker(null)}
        />
      )}

      <button className="back" onClick={onBack}>← Back</button>

      <div className="swap-header">
        <h2 className="title title--sm">Swap</h2>
        <div className="swap-powered">
          <span>powered by</span>
          <img src="/icons8-uniswap-64.png" alt="Uniswap" className="swap-uniswap-logo" />
        </div>
      </div>

      <div className="swap-panel">
        <div className="swap-side">
          <div className="swap-side__header">
            <span className="swap-side__label">You pay</span>
            {balanceIn && (
              <span className="swap-side__bal">
                {balanceIn} {tokenIn.symbol}
                {usdLabel(tokenIn.address, balanceIn, ethPrice) && <span className="swap-side__usd"> ({usdLabel(tokenIn.address, balanceIn, ethPrice)})</span>}
              </span>
            )}
          </div>
          <div className="swap-side__row">
            <button className="swap-tok-btn" onClick={() => setPicker("in")}>
              <SwapTokenLogo logo={tokenIn.logo} symbol={tokenIn.symbol} size={24} />
              <span>{tokenIn.symbol}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <input
              className={`swap-amount-input${overSwap ? " swap-amount-input--over" : ""}`}
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amountRaw}
              onChange={e => setAmountRaw(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*?)\./g, "$1"))}
            />
          </div>
          {balanceIn && parseFloat(balanceIn) > 0 && (
            <div className="swap-pct-row">
              {([["50%", 0.5], ["75%", 0.75], ["Max", 1]] as [string, number][]).map(([label, pct]) => (
                <button key={label} className="swap-pct-btn" onClick={() => {
                  const val = parseFloat(balanceIn) * pct;
                  setAmountRaw(val.toFixed(tokenIn.decimals).replace(/\.?0+$/, ""));
                  setQuote(null);
                }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="swap-flip-btn" onClick={flip} aria-label="Flip tokens">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
          </svg>
        </button>

        <div className="swap-side">
          <div className="swap-side__header">
            <span className="swap-side__label">You receive</span>
            {balanceOut && (
              <span className="swap-side__bal">
                {balanceOut} {tokenOut.symbol}
                {usdLabel(tokenOut.address, balanceOut, ethPrice) && <span className="swap-side__usd"> ({usdLabel(tokenOut.address, balanceOut, ethPrice)})</span>}
              </span>
            )}
          </div>
          <div className="swap-side__row">
            <button className="swap-tok-btn" onClick={() => setPicker("out")}>
              <SwapTokenLogo logo={tokenOut.logo} symbol={tokenOut.symbol} size={24} />
              <span>{tokenOut.symbol}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div className="swap-amount-out">
              {outAmount || <span className="swap-amount-out__empty">·</span>}
            </div>
          </div>
        </div>
      </div>

      {quoting && (
        <div className="swap-fetching">
          <svg className="swap-fetching__spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          Fetching quote…
        </div>
      )}

      {quote && !quoting && (
        <div className="swap-fees">
          <div className="swap-fees__row">
            <span className="swap-fees__label">Marmo Privacy Fee</span>
            <span className="swap-fees__val">0.75%</span>
          </div>
          <div className="swap-fees__row">
            <span className="swap-fees__label">Uniswap Pool Fee</span>
            <span className="swap-fees__val">{(quote.fee / 100).toFixed(2)}%</span>
          </div>
          <div className="swap-fees__row swap-fees__row--rate">
            <span className="swap-fees__label">Rate</span>
            <span className="swap-fees__val">1 {tokenIn.symbol} ≈ {(Number(BigInt(quote.amountOut)) / 10 ** tokenOut.decimals / parsed).toFixed(4)} {tokenOut.symbol}</span>
          </div>
        </div>
      )}

      <button className="btn btn--primary" onClick={submit} disabled={loading || !quote || parsed <= 0 || overSwap}>
        {loading
          ? "Swapping…"
          : <><img src="/icons8-swap-96-2.png" width={18} height={18} alt="" style={{ verticalAlign: "middle", marginRight: "0.35rem" }} />Swap</>}
      </button>

      <div className="swap-slippage-row">
        <button className="swap-slippage-toggle" onClick={() => setShowSlippage(s => !s)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 0 0 4.93 19.07M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          Slippage: {slippage / 100}%
        </button>
      </div>

      {showSlippage && (
        <div className="modal-overlay" onClick={() => setShowSlippage(false)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Slippage tolerance</span>
              <button className="modal-close" onClick={() => setShowSlippage(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <p className="modal-hint">Your swap reverts if the price moves more than this from the quoted rate.</p>
            <div className="swap-slippage-opts">
              {[25, 50, 100, 200].map(bps => (
                <button
                  key={bps}
                  className={`swap-slippage-opt${slippage === bps && !slippageCustom ? " active" : ""}`}
                  onClick={() => { setSlippage(bps); setSlippageCustom(""); }}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
            <div className="ca-row" style={{ marginTop: "0.9rem" }}>
              <input
                className="ca-input"
                type="text"
                inputMode="decimal"
                placeholder="Custom % (e.g. 1.5)"
                value={slippageCustom}
                style={{ fontSize: "16px" }}
                autoComplete="off"
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  setSlippageCustom(v);
                  const n = parseFloat(v);
                  if (n > 0 && n <= 50) setSlippage(Math.round(n * 100));
                }}
              />
            </div>
            <button className="btn btn--primary" style={{ marginTop: "1rem" }} onClick={() => setShowSlippage(false)}>
              Done
            </button>
          </div>
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
        disableVerticalSwipes?(): void;
        viewportStableHeight?: number;
        viewportHeight?: number;
        onEvent?(event: string, cb: () => void): void;
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
