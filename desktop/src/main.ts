import "./styles.css";
import { formatEther, formatUnits } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  vaultExists, loadVault, verifyPasskey, createWallet,
  getBalance, getStealthMetaAddress, fetchWalletTokens,
  fetchTokenByAddress, saveCustomTokenAddress, shortAddress,
  fetchEthPrice, fetchTxBatch, registerStealth, scanStealthPayments,
  sweepStealthPayment, initTotpSetup, confirmTotpSetup,
  recoverFromTotp, ensureVaultBackup, buildAndSubmit,
  type Vault, type BalanceResult, type WalletToken,
  type StealthPayment, type TxFetchState, type TxRecord, TX_PAGE_SIZE,
} from "./wallet.js";
import * as core from "./core.js";

interface SwapToken { address: string; symbol: string; decimals: number; logo: string; }

const SWAP_TOKENS: SwapToken[] = [
  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC",  decimals: 6,  logo: "/usdc.png" },
  { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", symbol: "USDT",  decimals: 6,  logo: "" },
  { address: "0x4200000000000000000000000000000000000006", symbol: "WETH",  decimals: 18, logo: "/eth.png" },
  { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI",   decimals: 18, logo: "" },
  { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", symbol: "USDbC", decimals: 6,  logo: "" },
];

const TOKEN_NAMES: Record<string, string> = {
  ETH: "Ethereum", USDC: "USD Coin", USDT: "Tether USD",
  WETH: "Wrapped Ether", DAI: "Dai Stablecoin", USDbC: "USD Base Coin", cbETH: "Coinbase Wrapped ETH",
};

const BG_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map(n => `marmo_balance_${n}.jpg`);
const DEFAULT_BG = "marmo_balance_3.jpg";

const S = {
  vault:     null as Vault | null,
  balance:   null as BalanceResult | null,
  backupErr: "",
};

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function el<T extends HTMLElement>(html: string): T {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

function toast(msg: string, kind: "ok" | "err" = "ok"): void {
  const t = el(`<div class="toast toast--${kind}" style="
    position:fixed;bottom:1.2rem;left:50%;transform:translateX(-50%);
    background:${kind === "err" ? "rgba(255,80,80,0.15)" : "rgba(56,182,255,0.15)"};
    border:1px solid ${kind === "err" ? "rgba(255,80,80,0.35)" : "rgba(56,182,255,0.35)"};
    color:${kind === "err" ? "#fca5a5" : "var(--blue-2)"};
    padding:0.55rem 1.1rem;border-radius:999px;font-size:0.85rem;
    z-index:999;pointer-events:none;white-space:nowrap;
    backdrop-filter:blur(12px);transition:opacity 0.3s;">${msg}</div>`);
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 2600);
}

function mount(): HTMLElement { return document.getElementById("sm")!; }

function navigate(renderFn: () => void): void {
  const m = mount();
  const current = m.firstElementChild as HTMLElement | null;
  if (current) {
    current.classList.remove("screen-anim--in");
    current.classList.add("screen-anim--out");
    setTimeout(() => { m.innerHTML = ""; renderFn(); }, 150);
  } else {
    renderFn();
  }
}

function setScreen(html: string): void {
  const m = mount();
  m.innerHTML = `<div class="screen-anim screen-anim--in">${html}</div>`;
}

function svgCopy(sz = 14): string {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}
function svgX(sz = 16): string {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
}
function svgChev(sz = 12): string {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`;
}
function svgSpinner(sz = 14): string {
  return `<svg class="swap-fetching__spinner" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
}
function svgPaste(sz = 13): string {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="5" y="6" width="14" height="16" rx="2"/><path d="M9 2H7a2 2 0 0 0-2 2v2"/><path d="M15 2h2a2 2 0 0 1 2 2v2"/></svg>`;
}
function svgExtLink(sz = 13): string {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
}

function tokenLogo(logo: string, symbol: string, size = 20): string {
  if (!logo) return `<span class="token-logo token-logo--fallback" style="width:${size}px;height:${size}px">${symbol[0] ?? "?"}</span>`;
  return `<img src="${logo}" width="${size}" height="${size}" class="token-logo" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment('<span class=\\"token-logo token-logo--fallback\\" style=\\"width:${size}px;height:${size}px\\">${symbol[0] ?? "?"}</span>'))" />`;
}

function getTokenPrice(symbol: string, ethPrice: number): number {
  if (["USDC", "USDT", "DAI", "USDbC"].includes(symbol)) return 1;
  if (["ETH", "WETH", "cbETH"].includes(symbol)) return ethPrice;
  return 0;
}

function modal(content: string): HTMLElement {
  const overlay = el<HTMLElement>(`<div class="modal-overlay">${content}</div>`);
  document.body.appendChild(overlay);
  return overlay;
}

function closeModal(overlay: HTMLElement): void { overlay.remove(); }

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="shell">
    <header class="bar">
      <div class="bar__brand"><img src="/logo.jpg" width="26" height="26" alt="" /><span>Marmo</span></div>
      <span class="bar__net">Base</span>
    </header>
    <main id="sm"></main>
  </div>
`;

function renderLoading(): void {
  setScreen(`<div class="screen loader"><div class="spinner"></div></div>`);
}

function renderWelcome(): void {
  navigate(() => setScreen(`
    <div class="screen welcome">
      <img src="/logo.jpg" width="52" height="52" alt="Marmo" class="logo" />
      <h1 class="title">One wallet,<br />split in three.</h1>
      <p class="sub">Your device, a co-signer, and your passkey. Any two can spend. No single one ever can.</p>
      <button class="btn btn--primary" id="btn-create">Create wallet</button>
      <button class="btn btn--ghost welcome__recover" id="btn-recover">Recover existing wallet</button>
      <p class="err" id="welcome-err" style="display:none"></p>
    </div>
  `));

  document.getElementById("btn-create")!.addEventListener("click", async () => {
    const btn = document.getElementById("btn-create") as HTMLButtonElement;
    const errEl = document.getElementById("welcome-err")!;
    btn.disabled = true;
    btn.textContent = "Setting up…";
    errEl.style.display = "none";
    try {
      const v = await createWallet();
      S.vault = v;
      renderDashboard();
    } catch (e) {
      errEl.textContent = errMsg(e);
      errEl.style.display = "";
      btn.disabled = false;
      btn.textContent = "Create wallet";
    }
  });

  document.getElementById("btn-recover")!.addEventListener("click", renderRecover);
}

function renderRecover(): void {
  navigate(() => setScreen(`
    <div class="screen send-screen">
      <button class="back" id="btn-back">← Back</button>
      <h2 class="title title--sm">Recover wallet</h2>
      <p class="totp-setup__hint">Enter your wallet address and open your authenticator app for the 6-digit code.</p>

      <div class="field">
        <label>Wallet address</label>
        <div class="ca-row">
          <input class="ca-input" id="rec-addr" type="text" placeholder="0x…" autocomplete="off" spellcheck="false" />
          <button class="ca-paste-btn" id="btn-paste-addr">${svgPaste()} Paste</button>
        </div>
      </div>

      <div class="field">
        <label>Authenticator code</label>
        <input class="totp-setup__code-input" id="rec-code" type="text" inputmode="numeric" maxlength="6" placeholder="000000" />
      </div>

      <button class="btn btn--primary" id="btn-recover-submit" disabled>Recover wallet</button>
      <p class="err" id="rec-err" style="display:none"></p>
    </div>
  `));

  const addrIn = document.getElementById("rec-addr") as HTMLInputElement;
  const codeIn = document.getElementById("rec-code") as HTMLInputElement;
  const submitBtn = document.getElementById("btn-recover-submit") as HTMLButtonElement;
  const errEl = document.getElementById("rec-err")!;

  function checkReady() { submitBtn.disabled = !addrIn.value.startsWith("0x") || codeIn.value.length !== 6; }
  addrIn.addEventListener("input", checkReady);
  codeIn.addEventListener("input", () => {
    codeIn.value = codeIn.value.replace(/\D/g, "").slice(0, 6);
    checkReady();
  });

  document.getElementById("btn-paste-addr")!.addEventListener("click", async () => {
    try { addrIn.value = (await navigator.clipboard.readText()).trim(); checkReady(); } catch {}
  });

  document.getElementById("btn-back")!.addEventListener("click", renderWelcome);

  submitBtn.addEventListener("click", async () => {
    const addr = addrIn.value.trim();
    const code = codeIn.value.trim();
    if (!addr.startsWith("0x") || addr.length < 42) { errEl.textContent = "Enter your wallet address (0x…)"; errEl.style.display = ""; return; }
    if (!/^\d{6}$/.test(code)) { errEl.textContent = "Enter the 6-digit code from your authenticator app"; errEl.style.display = ""; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = "Recovering…";
    errEl.style.display = "none";
    try {
      const v = await recoverFromTotp(addr, code);
      S.vault = v;
      renderDashboard();
    } catch (e) {
      errEl.textContent = errMsg(e);
      errEl.style.display = "";
      submitBtn.disabled = false;
      submitBtn.textContent = "Recover wallet";
    }
  });
}

function openTokenDrawer(token: WalletToken, ethPrice: number): void {
  const price = getTokenPrice(token.symbol, ethPrice);
  const priceStr = price > 0 ? `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
  const overlay = modal(`
    <div class="modal-panel token-drawer" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span class="modal-title">${TOKEN_NAMES[token.symbol] ?? token.symbol}</span>
        <button class="modal-close" id="td-close">${svgX()}</button>
      </div>
      <div class="token-drawer__price">${priceStr}</div>
      <div class="token-drawer__rows">
        <div class="token-drawer__row"><span class="token-drawer__label">Symbol</span><span class="token-drawer__val">${token.symbol}</span></div>
        <div class="token-drawer__row"><span class="token-drawer__label">Name</span><span class="token-drawer__val">${TOKEN_NAMES[token.symbol] ?? token.symbol}</span></div>
        ${token.address
          ? `<button class="token-drawer__row token-drawer__row--btn" id="td-copy-ca"><span class="token-drawer__label">Contract</span><span class="token-drawer__val token-drawer__val--addr"><span id="td-ca">${token.address.slice(0, 8)}…${token.address.slice(-6)}</span>${svgCopy(14)}</span></button>`
          : `<div class="token-drawer__row"><span class="token-drawer__label">Contract</span><span class="token-drawer__val">Native token</span></div>`}
      </div>
    </div>
  `);
  overlay.addEventListener("click", () => closeModal(overlay));
  document.getElementById("td-close")!.addEventListener("click", () => closeModal(overlay));
  if (token.address) {
    document.getElementById("td-copy-ca")!.addEventListener("click", async () => {
      await navigator.clipboard.writeText(token.address);
      toast("Contract address copied");
    });
  }
}

function openAddTokenModal(walletAddress: string, onAdd: (tok: WalletToken) => void): void {
  const overlay = modal(`
    <div class="modal-panel" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span class="modal-title">Add token</span>
        <button class="modal-close" id="atm-close">${svgX()}</button>
      </div>
      <p class="modal-hint">Paste the contract address of any token you hold on Base.</p>
      <div class="ca-row">
        <input class="ca-input" id="atm-ca" placeholder="0x…" autocomplete="off" spellcheck="false" style="font-size:14px" />
        <button class="ca-paste-btn" id="atm-paste">${svgPaste()} Paste</button>
      </div>
      <div id="atm-preview"></div>
      <p class="err" id="atm-err" style="display:none;margin-top:0.6rem"></p>
      <div style="margin-top:1.2rem">
        <button class="btn btn--primary" id="atm-action" disabled>Look up</button>
      </div>
    </div>
  `);
  overlay.addEventListener("click", () => closeModal(overlay));
  document.getElementById("atm-close")!.addEventListener("click", () => closeModal(overlay));

  const caIn   = document.getElementById("atm-ca") as HTMLInputElement;
  const preEl  = document.getElementById("atm-preview")!;
  const errEl  = document.getElementById("atm-err")!;
  const actBtn = document.getElementById("atm-action") as HTMLButtonElement;
  let preview: WalletToken | null = null;

  caIn.addEventListener("input", () => {
    preview = null;
    preEl.innerHTML = "";
    errEl.style.display = "none";
    const valid = /^0x[0-9a-fA-F]{40}$/.test(caIn.value.trim());
    actBtn.disabled = !valid;
    actBtn.textContent = "Look up";
  });

  document.getElementById("atm-paste")!.addEventListener("click", async () => {
    try { caIn.value = (await navigator.clipboard.readText()).trim(); caIn.dispatchEvent(new Event("input")); } catch {}
  });

  actBtn.addEventListener("click", async () => {
    if (preview) {
      saveCustomTokenAddress(walletAddress, preview.address);
      onAdd(preview);
      closeModal(overlay);
      return;
    }
    const valid = /^0x[0-9a-fA-F]{40}$/.test(caIn.value.trim());
    if (!valid) return;
    actBtn.disabled = true;
    actBtn.textContent = "Looking up…";
    errEl.style.display = "none";
    try {
      const tok = await fetchTokenByAddress(walletAddress, caIn.value.trim());
      preview = tok;
      preEl.innerHTML = `<div class="ca-preview">${tok.logo ? `<img src="${tok.logo}" width="22" height="22" class="token-icon" alt="" />` : ""}<span class="ca-preview__sym">${tok.symbol}</span><span class="ca-preview__bal">${tok.balance} available</span></div>`;
      actBtn.disabled = false;
      actBtn.textContent = `Add ${tok.symbol}`;
    } catch {
      errEl.textContent = "Could not find a token at that address.";
      errEl.style.display = "";
      actBtn.disabled = false;
      actBtn.textContent = "Look up";
    }
  });
}

function openBgPickerModal(current: string, onSelect: (bg: string) => void): void {
  const overlay = modal(`
    <div class="modal-panel" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span class="modal-title">Card style</span>
        <button class="modal-close" id="bg-close">${svgX()}</button>
      </div>
      <div class="bg-grid">
        ${BG_OPTIONS.map(bg => `
          <button class="bg-option${bg === current ? " bg-option--active" : ""}" data-bg="${bg}" style="background-image:url('/balance_card_media/${bg}')">
            ${bg === current ? `<span class="bg-option__check"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>` : ""}
          </button>
        `).join("")}
      </div>
    </div>
  `);
  overlay.addEventListener("click", () => closeModal(overlay));
  document.getElementById("bg-close")!.addEventListener("click", () => closeModal(overlay));
  overlay.querySelectorAll<HTMLButtonElement>("[data-bg]").forEach(btn => {
    btn.addEventListener("click", () => { onSelect(btn.dataset.bg!); closeModal(overlay); });
  });
}

function openSecurityModal(): void {
  const overlay = modal(`
    <div class="modal-panel" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span class="modal-title">How Marmo protects you</span>
        <button class="modal-close" id="sec-close">${svgX()}</button>
      </div>
      <div class="modal-section">
        <div class="modal-section__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div>
          <div class="modal-section__title">2-of-3 threshold security</div>
          <p class="modal-section__body">Your signing key is split into three independent shards. Any two are needed to move funds.</p>
          <div class="shard-list">
            <div class="shard-item"><span class="shard-item__label">Device</span><span class="shard-item__desc">Stored on this device. Signs locally, never leaves.</span></div>
            <div class="shard-item"><span class="shard-item__label">Co-signer</span><span class="shard-item__desc">Held by Marmo's server. Signs blind; never sees your recipient or amount.</span></div>
            <div class="shard-item"><span class="shard-item__label">Recovery</span><span class="shard-item__desc">Your authenticator app. Used to recover if your device key is lost.</span></div>
          </div>
        </div>
      </div>
      <div class="modal-divider"></div>
      <div class="modal-section">
        <div class="modal-section__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg></div>
        <div>
          <div class="modal-section__title">Stealth addresses</div>
          <p class="modal-section__body">Every private payment lands at a unique one-time address. No two payments share an on-chain link.</p>
        </div>
      </div>
      <div class="modal-divider"></div>
      <div class="modal-section">
        <div class="modal-section__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <div>
          <div class="modal-section__title">Non-custodial</div>
          <p class="modal-section__body">Your wallet is a smart contract on Base. Marmo never holds your funds or controls your keys.</p>
        </div>
      </div>
    </div>
  `);
  overlay.addEventListener("click", () => closeModal(overlay));
  document.getElementById("sec-close")!.addEventListener("click", () => closeModal(overlay));
}

function openOfflineDrawer(onRetry: () => void): void {
  const overlay = modal(`
    <div class="modal-panel offline-drawer" onclick="event.stopPropagation()">
      <img src="/icons8-without-internet-96.png" width="52" height="52" class="offline-drawer__icon" alt="" />
      <h3 class="offline-drawer__title">No internet connection</h3>
      <p class="offline-drawer__body">We couldn't get real-time prices. Your funds are safe — this only affects displayed USD values.</p>
      <div class="offline-drawer__actions">
        <button class="btn btn--primary" id="od-retry">Try again</button>
        <button class="btn btn--ghost" id="od-dismiss">Dismiss</button>
      </div>
    </div>
  `);
  overlay.addEventListener("click", () => closeModal(overlay));
  document.getElementById("od-retry")!.addEventListener("click", () => { closeModal(overlay); onRetry(); });
  document.getElementById("od-dismiss")!.addEventListener("click", () => closeModal(overlay));
}

function renderDashboard(): void {
  if (!S.vault) return;
  const vault = S.vault;
  let cardBg = localStorage.getItem("marmo_card_bg") ?? DEFAULT_BG;
  let dashTab: "tokens" | "history" = "tokens";
  let tokens: WalletToken[] = [];
  let ethPrice = 0;
  let priceOffline = false;
  let txBuffer: TxRecord[] = [];
  let txState: TxFetchState | null = null;
  let txShown = 0;
  let txLoading = false;
  let txLoaded = false;
  let bannerDismissed = false;

  navigate(() => {
    setScreen(`
      <div class="screen dashboard" id="dash">
        <div class="card" id="dash-card" style="background-image:url('/balance_card_media/${cardBg}')" role="button" aria-label="Refresh balance">
          <div class="card__top">
            <span class="card__label">Marmo Wallet</span>
            <div class="card__actions">
              <button class="help-btn" id="btn-bg" aria-label="Card style"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="help-btn" id="btn-sec" aria-label="Security info"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg></button>
            </div>
          </div>
          <div class="balance" id="dash-balance">
            <span class="balance__usd">$ —</span>
            <span class="balance__eth"><img src="/eth.png" width="18" height="18" class="token-icon" alt="" /> —</span>
          </div>
          <button class="addr" id="btn-copy-addr">
            ${shortAddress(vault.address)}
            <span class="addr__icon" id="addr-icon">${svgCopy(12)}</span>
          </button>
        </div>

        <div class="actions">
          <div class="actions__row">
            <button class="btn btn--ghost" id="btn-receive"><img src="/icons8-recieve-96.png" width="18" height="18" alt="" /> Receive</button>
            <button class="btn btn--primary" id="btn-send"><img src="/icons8-send-96.png" width="18" height="18" alt="" /> Send</button>
          </div>
          <button class="btn btn--ghost actions__swap" id="btn-swap"><img src="/icons8-swap-96.png" width="18" height="18" alt="" /> Swap</button>
        </div>

        <div id="dash-banners"></div>

        <div class="dash-tabs" id="dash-tabs">
          <div class="receive-tabs" style="margin-bottom:0">
            <button class="receive-tab active" id="tab-tokens"><img src="/icons8-tokens-96.png" width="15" height="15" alt="" /> Tokens</button>
            <button class="receive-tab" id="tab-history"><img src="/icons8-history-96.png" width="15" height="15" alt="" /> History</button>
          </div>
          <div class="dash-panel-viewport">
            <div class="dash-panel dash-panel--right" id="dash-panel-content">
              <div class="dash-token-list" id="token-list"><p class="dash-empty">Loading…</p></div>
            </div>
          </div>
        </div>
      </div>
    `);

    attachDashboard();
    loadBalance();
    loadTokens();
  });

  function attachDashboard() {
    document.getElementById("dash-card")!.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("#btn-bg") || target.closest("#btn-sec") || target.closest("#btn-copy-addr")) return;
      loadBalance(true);
    });
    document.getElementById("btn-bg")!.addEventListener("click", (e) => {
      e.stopPropagation();
      openBgPickerModal(cardBg, (bg) => {
        cardBg = bg;
        localStorage.setItem("marmo_card_bg", bg);
        const card = document.getElementById("dash-card");
        if (card) card.style.backgroundImage = `url('/balance_card_media/${bg}')`;
      });
    });
    document.getElementById("btn-sec")!.addEventListener("click", (e) => { e.stopPropagation(); openSecurityModal(); });
    document.getElementById("btn-copy-addr")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(vault.address);
      const icon = document.getElementById("addr-icon");
      if (icon) { icon.textContent = "✓"; setTimeout(() => { if (icon) icon.innerHTML = svgCopy(12); }, 1400); }
    });
    document.getElementById("btn-receive")!.addEventListener("click", renderReceive);
    document.getElementById("btn-send")!.addEventListener("click", renderSend);
    document.getElementById("btn-swap")!.addEventListener("click", renderSwap);

    document.getElementById("tab-tokens")!.addEventListener("click", () => switchTab("tokens"));
    document.getElementById("tab-history")!.addEventListener("click", () => switchTab("history"));
  }

  function renderBanners() {
    const banners = document.getElementById("dash-banners");
    if (!banners) return;
    let html = "";
    if (S.backupErr) {
      html += `<button class="backup-err-banner" id="btn-retry-backup"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Recovery backup failed: ${S.backupErr} — click to retry</button>`;
    }
    if (!vault.totpEnabled && !bannerDismissed) {
      html += `
        <div class="totp-banner">
          <div class="totp-banner__top-row">
            <div class="totp-banner__icon-morph">
              <img src="/icons8-google-authenticator-96.png" class="totp-morph-a" width="28" height="28" alt="" />
              <img src="/icons8-microsoft-authenticator-96.png" class="totp-morph-b" width="28" height="28" alt="" />
            </div>
            <button class="totp-banner__dismiss" id="btn-dismiss-totp" aria-label="Dismiss">${svgX(14)}</button>
          </div>
          <div class="totp-banner__body">
            <span class="totp-banner__title">Secure your recovery</span>
            <span class="totp-banner__sub">Set up an authenticator app so you can recover your wallet if you lose this device. Takes 30 seconds.</span>
          </div>
          <div class="totp-banner__footer">
            <button class="btn btn--primary totp-banner__cta" id="btn-setup-totp">Set up</button>
          </div>
        </div>`;
    }
    banners.innerHTML = html;
    document.getElementById("btn-retry-backup")?.addEventListener("click", () => {
      S.backupErr = "";
      ensureVaultBackup(vault).catch(e => { S.backupErr = errMsg(e); renderBanners(); });
      renderBanners();
    });
    document.getElementById("btn-dismiss-totp")?.addEventListener("click", () => { bannerDismissed = true; renderBanners(); });
    document.getElementById("btn-setup-totp")?.addEventListener("click", renderSetupTotp);
  }

  async function loadBalance(force = false) {
    if (force) {
      try { localStorage.removeItem("marmo_eth_price_cache"); } catch {}
    }
    try {
      const [bal, priceResult] = await Promise.all([
        getBalance(vault.address),
        fetchEthPrice(),
      ]);
      S.balance = bal;
      ethPrice = priceResult.price;
      priceOffline = priceResult.failed && priceResult.price === 0;
      updateBalanceUI();
      if (priceOffline) openOfflineDrawer(() => loadBalance(true));
      renderBanners();
    } catch { updateBalanceUI(); }
  }

  function updateBalanceUI() {
    const balEl = document.getElementById("dash-balance");
    if (!balEl) return;
    const bal = S.balance;
    if (!bal) { balEl.innerHTML = `<span class="balance__usd">$ —</span><span class="balance__eth"><img src="/eth.png" width="18" height="18" class="token-icon" alt="" /> —</span>`; return; }
    balEl.innerHTML = `
      <span class="balance__usd">$ ${bal.usdValue}</span>
      <span class="balance__eth"><img src="/eth.png" width="18" height="18" class="token-icon" alt="" /> ${bal.eth} <small class="balance__eth-usd">($${bal.ethUsdValue})</small></span>
    `;
  }

  async function loadTokens() {
    try {
      const toks = await fetchWalletTokens(vault.address);
      tokens = toks;
      if (dashTab === "tokens") renderTokenList();
    } catch {}
  }

  function renderTokenList() {
    const listEl = document.getElementById("token-list");
    if (!listEl) return;
    const visible = tokens.filter(t => parseFloat(t.balance) > 0);
    if (visible.length === 0) {
      listEl.innerHTML = `<p class="dash-empty">No tokens yet</p><p class="dash-basescan-note">Not seeing a token? <button class="dash-add-token-link" id="btn-add-tok">Add token</button></p>`;
      document.getElementById("btn-add-tok")?.addEventListener("click", () => {
        openAddTokenModal(vault.address, (tok) => {
          if (!tokens.find(t => t.address.toLowerCase() === tok.address.toLowerCase())) tokens = [...tokens, tok];
          renderTokenList();
        });
      });
      return;
    }
    listEl.innerHTML = visible.map((tok, idx) => {
      const price = getTokenPrice(tok.symbol, ethPrice);
      const usdVal = price > 0 ? (parseFloat(tok.balance) * price) : null;
      const logo = tok.logo
        ? `<img src="${tok.logo}" width="36" height="36" class="dash-token-item__logo" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment('<div class=\\"dash-token-item__logo dash-token-item__logo--placeholder\\">${tok.symbol[0]}</div>'))" />`
        : `<div class="dash-token-item__logo dash-token-item__logo--placeholder">${tok.symbol[0]}</div>`;
      return `
        <button class="dash-token-item" data-tok-idx="${idx}">
          <div class="dash-token-item__left">
            ${logo}
            <div class="dash-token-item__info">
              <span class="dash-token-item__name">${TOKEN_NAMES[tok.symbol] ?? tok.symbol}</span>
              <span class="dash-token-item__price">${price > 0 ? `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</span>
            </div>
          </div>
          <div class="dash-token-item__right">
            <span class="dash-token-item__balance">${tok.balance}</span>
            <span class="dash-token-item__usd">${usdVal != null ? `$${usdVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}</span>
          </div>
        </button>`;
    }).join("") + `<p class="dash-basescan-note">Not seeing a token? <button class="dash-add-token-link" id="btn-add-tok">Add token</button></p>`;
    listEl.querySelectorAll<HTMLButtonElement>("[data-tok-idx]").forEach(btn => {
      btn.addEventListener("click", () => {
        const tok = visible[parseInt(btn.dataset.tokIdx!)];
        if (tok) openTokenDrawer(tok, ethPrice);
      });
    });
    document.getElementById("btn-add-tok")?.addEventListener("click", () => {
      openAddTokenModal(vault.address, (tok) => {
        if (!tokens.find(t => t.address.toLowerCase() === tok.address.toLowerCase())) tokens = [...tokens, tok];
        renderTokenList();
      });
    });
  }

  async function loadMoreTx() {
    if (txBuffer.length - txShown >= TX_PAGE_SIZE) {
      txShown += TX_PAGE_SIZE;
      renderTxList();
      return;
    }
    const txDone = txState ? txState.txDone && txState.tokenDone : false;
    if (txDone && txLoaded) {
      txShown = Math.min(txShown + TX_PAGE_SIZE, txBuffer.length);
      renderTxList();
      return;
    }
    txLoading = true;
    renderTxList();
    let buffer = txBuffer;
    let state = txState;
    while (buffer.length - txShown < TX_PAGE_SIZE) {
      const batch = await fetchTxBatch(vault.address, state);
      const seen = new Set(buffer.map(t => t.hash + (t.tokenSymbol ?? "")));
      buffer = [...buffer, ...batch.items.filter(t => !seen.has(t.hash + (t.tokenSymbol ?? "")))]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      state = batch.state;
      if (state.txDone && state.tokenDone) break;
    }
    txBuffer = buffer;
    txState = state;
    txShown = Math.min(txShown + TX_PAGE_SIZE, buffer.length);
    txLoading = false;
    txLoaded = true;
    renderTxList();
  }

  function renderTxList() {
    const listEl = document.getElementById("token-list");
    if (!listEl) return;
    const txDone = txState ? txState.txDone && txState.tokenDone : false;
    if (txLoading && txBuffer.length === 0) { listEl.innerHTML = `<p class="dash-empty">Loading…</p>`; return; }
    if (txLoaded && txBuffer.length === 0 && !txLoading) {
      listEl.innerHTML = `<p class="dash-empty">No transactions yet.<br /><a class="dash-basescan-link" href="https://basescan.org/address/${vault.address}" target="_blank" rel="noopener">View on Basescan ↗</a></p>`;
      return;
    }
    const shown = txBuffer.slice(0, txShown);
    listEl.innerHTML = shown.map(tx => {
      const out = tx.from.toLowerCase() === vault.address.toLowerCase();
      const amount = tx.isToken && tx.tokenAmount && tx.tokenSymbol
        ? `${parseFloat(formatUnits(BigInt(tx.tokenAmount), parseInt(tx.tokenDecimal ?? "18"))).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${tx.tokenSymbol}`
        : tx.value && tx.value !== "0" ? `${parseFloat(formatEther(BigInt(tx.value))).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH` : null;
      const known = (tx.value !== "0" && tx.value !== "") || tx.isToken;
      const icon = !known
        ? `<span class="dash-tx-item__unknown">?</span>`
        : out
          ? `<img src="/icons8-top-right-96.png" width="18" height="18" alt="out" />`
          : `<img src="/icons8-bottom-left-100.png" width="18" height="18" alt="in" />`;
      return `
        <a class="dash-tx-item" href="https://basescan.org/tx/${tx.hash}" target="_blank" rel="noopener">
          <div class="dash-tx-item__icon">${icon}</div>
          <div class="dash-tx-item__body">
            <span class="dash-tx-item__hash">${tx.hash.slice(0, 10)}…${tx.hash.slice(-6)}</span>
            ${amount ? `<span class="dash-tx-item__amount">${out ? "-" : "+"}${amount}</span>` : ""}
          </div>
          ${svgExtLink(13)}
        </a>`;
    }).join("");
    if (!txLoading && (txShown < txBuffer.length || !txDone) && txBuffer.length > 0) {
      listEl.insertAdjacentHTML("beforeend", `<button class="btn btn--ghost dash-load-more" id="btn-load-more">Load more</button>`);
      document.getElementById("btn-load-more")?.addEventListener("click", loadMoreTx);
    }
    if (!txLoading && txBuffer.length > 0) {
      listEl.insertAdjacentHTML("beforeend", `<p class="dash-basescan-note">Not seeing a transaction? <a class="dash-basescan-link" href="https://basescan.org/address/${vault.address}" target="_blank" rel="noopener">View full history on Basescan ↗</a></p>`);
    }
  }

  function switchTab(tab: "tokens" | "history") {
    if (tab === dashTab) return;
    const slideDir = tab === "history" ? "right" : "left";
    dashTab = tab;
    document.getElementById("tab-tokens")?.classList.toggle("active", tab === "tokens");
    document.getElementById("tab-history")?.classList.toggle("active", tab === "history");
    const viewport = document.querySelector(".dash-panel-viewport");
    if (!viewport) return;
    const newPanel = document.createElement("div");
    newPanel.className = `dash-panel dash-panel--${slideDir}`;
    newPanel.id = "dash-panel-content";
    const inner = document.createElement("div");
    inner.className = tab === "tokens" ? "dash-token-list" : "dash-tx-list";
    inner.id = "token-list";
    newPanel.appendChild(inner);
    viewport.innerHTML = "";
    viewport.appendChild(newPanel);
    if (tab === "tokens") { renderTokenList(); }
    else if (!txLoaded) { loadMoreTx(); }
    else { renderTxList(); }
  }
}

function renderReceive(): void {
  if (!S.vault) return;
  const vault = S.vault;
  let tab: "standard" | "private" = "standard";
  const meta = getStealthMetaAddress(vault);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(vault.address)}&color=e9f0f8&bgcolor=141b24&margin=10&qzone=1`;
  let scanning = false;
  let registered = false;
  let cooldown = 0;
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;
  let payments: StealthPayment[] | null = null;
  let hideTiny = true;
  let sweeping: string | null = null;

  navigate(() => {
    setScreen(`
      <div class="screen send-screen" id="receive-screen">
        <button class="back" id="btn-back">← Back</button>
        <h2 class="title title--sm">Receive</h2>
        <div class="receive-tabs">
          <button class="receive-tab active" id="rtab-std">Standard</button>
          <button class="receive-tab" id="rtab-prv"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.3rem"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Private</button>
        </div>
        <div class="dash-panel-viewport">
          <div class="dash-panel dash-panel--right" id="rec-panel">
            ${standardTabHTML()}
          </div>
        </div>
      </div>
    `);
    attachReceive();
  });

  function standardTabHTML(): string {
    return `
      <div class="qr-wrap">
        <img src="${qrUrl}" width="220" height="220" alt="Wallet address QR code" class="qr-img" />
        <button class="qr-addr" id="btn-copy-addr">${shortAddress(vault.address)} ${svgCopy(12)}</button>
      </div>
      <div class="net-warn">
        <div class="net-warn__row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Only send assets on the <strong>Base network</strong> to this address. Assets sent from another network may be permanently lost.</span>
        </div>
        <div class="net-warn__support">For support contact <a href="mailto:contact@usemarmo.xyz" class="net-warn__email">contact@usemarmo.xyz</a></div>
      </div>`;
  }

  function privateTabHTML(): string {
    const scanLabel = scanning ? `${svgSpinner(13)} Scanning…` : cooldown > 0 ? `Scan again in ${cooldown}s` : "Scan for payments";
    const paymentsHTML = renderPaymentsHTML();
    return `
      <div class="stealth-explain"><p>Share your stealth meta-address so senders can pay you privately. Each payment lands at a unique one-time address. Only you can detect and claim it.</p></div>
      <div class="stealth-meta-card">
        <div class="stealth-meta-card__label">Your stealth meta-address</div>
        <div class="stealth-meta-card__addr">${meta.slice(0, 20)}…${meta.slice(-10)}</div>
        <button class="btn btn--ghost" id="btn-copy-meta" style="margin-top:0.75rem;width:100%">${svgCopy(14)} Copy full meta-address</button>
      </div>
      <div class="stealth-scan-section">
        <span class="stealth-scan-section__title">Incoming private payments</span>
        <button class="btn btn--ghost" id="btn-scan" style="width:100%" ${scanning || cooldown > 0 ? "disabled" : ""}>${scanLabel}</button>
        <div id="payments-area">${paymentsHTML}</div>
      </div>`;
  }

  function renderPaymentsHTML(): string {
    if (!payments) return "";
    if (payments.length === 0) return `<p class="stealth-scan-empty">No private payments found in the last ~50k blocks.</p>`;
    const DUST_ETH = 100_000_000_000_000n;
    const visible = hideTiny ? payments.filter(p => {
      if (p.tokens.length > 0 && p.tokens.some(t => parseFloat(t.balance) >= (t.decimals <= 6 ? 0.005 : 0.000005))) return true;
      return p.ethRaw >= DUST_ETH;
    }) : payments;
    if (visible.length === 0) return `<p class="stealth-scan-empty">All payments are dust amounts. Toggle off to see them.</p>`;
    const toggleHtml = `
      <div class="stealth-meta-row" style="margin-bottom:0.5rem">
        <span></span>
        <label class="tiny-toggle">
          <span class="tiny-toggle__label">Hide tiny amounts</span>
          <button role="switch" aria-checked="${hideTiny}" class="toggle-pill${hideTiny ? " on" : ""}" id="toggle-tiny"></button>
        </label>
      </div>`;
    return toggleHtml + `<div class="stealth-payment-list">` + visible.map(p => `
      <div class="stealth-payment" data-addr="${p.stealthAddress}">
        <div class="stealth-payment__assets">
          ${p.ethRaw > 0n ? `<span class="stealth-payment__eth">${p.ethBalance} ETH</span>` : ""}
          ${p.tokens.map(t => `<span class="stealth-payment__eth">${parseFloat(t.balance).toFixed(t.decimals <= 6 ? 2 : 5).replace(/\.?0+$/, "")} ${t.symbol}</span>`).join("")}
          <span class="stealth-payment__addr">${shortAddress(p.stealthAddress)}</span>
        </div>
        <button class="btn btn--primary stealth-payment__claim" data-sweep="${p.stealthAddress}" ${sweeping === p.stealthAddress ? "disabled" : ""}>
          ${sweeping === p.stealthAddress ? "Claiming…" : "Claim"}
        </button>
      </div>`).join("") + `</div>`;
  }

  function attachReceive() {
    document.getElementById("btn-back")!.addEventListener("click", renderDashboard);
    document.getElementById("rtab-std")!.addEventListener("click", () => switchReceiveTab("standard"));
    document.getElementById("rtab-prv")!.addEventListener("click", () => switchReceiveTab("private"));
    attachPanelListeners();
  }

  function attachPanelListeners() {
    if (tab === "standard") {
      document.getElementById("btn-copy-addr")?.addEventListener("click", async () => {
        await navigator.clipboard.writeText(vault.address);
        toast("Address copied");
      });
    } else {
      document.getElementById("btn-copy-meta")?.addEventListener("click", async () => {
        await navigator.clipboard.writeText(meta);
        toast("Meta-address copied");
      });
      document.getElementById("btn-scan")?.addEventListener("click", scan);
      document.getElementById("toggle-tiny")?.addEventListener("click", () => {
        hideTiny = !hideTiny;
        updatePaymentsArea();
      });
      attachSweepListeners();
    }
  }

  function attachSweepListeners() {
    document.querySelectorAll<HTMLButtonElement>("[data-sweep]").forEach(btn => {
      btn.addEventListener("click", () => {
        const addr = btn.dataset.sweep!;
        const p = payments?.find(x => x.stealthAddress === addr);
        if (!p) return;
        sweep(p);
      });
    });
  }

  function updatePaymentsArea() {
    const area = document.getElementById("payments-area");
    if (area) { area.innerHTML = renderPaymentsHTML(); }
    document.getElementById("toggle-tiny")?.addEventListener("click", () => { hideTiny = !hideTiny; updatePaymentsArea(); });
    attachSweepListeners();
  }

  function switchReceiveTab(next: "standard" | "private") {
    if (next === tab) return;
    const dir = next === "private" ? "right" : "left";
    tab = next;
    document.getElementById("rtab-std")?.classList.toggle("active", tab === "standard");
    document.getElementById("rtab-prv")?.classList.toggle("active", tab === "private");
    const viewport = document.querySelector(".dash-panel-viewport");
    if (!viewport) return;
    const panel = document.createElement("div");
    panel.className = `dash-panel dash-panel--${dir}`;
    panel.id = "rec-panel";
    panel.innerHTML = tab === "standard" ? standardTabHTML() : privateTabHTML();
    viewport.innerHTML = "";
    viewport.appendChild(panel);
    attachPanelListeners();
  }

  async function scan() {
    if (scanning || cooldown > 0) return;
    scanning = true;
    refreshScanBtn();
    try {
      if (!registered) { await registerStealth(vault); registered = true; }
      const found = await scanStealthPayments(vault);
      payments = found;
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      scanning = false;
      if (cooldownTimer) clearInterval(cooldownTimer);
      cooldown = 30;
      cooldownTimer = setInterval(() => {
        cooldown = Math.max(0, cooldown - 1);
        if (cooldown === 0 && cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
        refreshScanBtn();
      }, 1000);
      updatePaymentsArea();
    }
  }

  function refreshScanBtn() {
    const btn = document.getElementById("btn-scan") as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = scanning || cooldown > 0;
    btn.innerHTML = scanning ? `${svgSpinner(13)} Scanning…` : cooldown > 0 ? `Scan again in ${cooldown}s` : "Scan for payments";
  }

  async function sweep(p: StealthPayment) {
    sweeping = p.stealthAddress;
    updatePaymentsArea();
    attachSweepListeners();
    try {
      const hashes = await sweepStealthPayment(vault, p);
      navigate(() => setScreen(`
        <div class="screen send-screen tx-result">
          <img src="/icons8-success-96.png" class="tx-result__icon" alt="" />
          <h2 class="tx-result__title">Claimed!</h2>
          <p class="tx-result__sub">Your funds have been moved to your main wallet.</p>
          <div class="claim-result__links">
            ${hashes.map((h, i) => `<a class="btn btn--ghost claim-result__link" href="https://basescan.org/tx/${h}" target="_blank" rel="noopener">${hashes.length > 1 ? `Transaction ${i + 1}` : "View on Basescan"} ↗</a>`).join("")}
          </div>
          <button class="btn btn--ghost" id="btn-done">Done</button>
        </div>
      `));
      document.getElementById("btn-done")?.addEventListener("click", renderDashboard);
    } catch (e) {
      sweeping = null;
      toast(errMsg(e), "err");
      updatePaymentsArea();
    }
  }
}

function renderSend(): void {
  if (!S.vault) return;
  const vault = S.vault;
  let tab: "standard" | "private" = "standard";
  let tokens: WalletToken[] = [{ address: "", symbol: "ETH", decimals: 18, balance: "0", logo: "/eth.png" }];
  let selectedToken = "";
  let amountMode: "token" | "usd" = "token";
  let amountRaw = "";
  let to = "";
  let ethPrice = 0;
  let loading = false;
  let step: "input" | "preview" | "result" = "input";
  let txHash = "";
  let txErr = "";

  fetchEthPrice().then(r => { ethPrice = r.price; });
  fetchWalletTokens(vault.address).then(toks => { tokens = toks; });

  function getTokenInfo() { return tokens.find(t => t.address === selectedToken) ?? tokens[0]; }
  function parsed() { return parseFloat(amountRaw) || 0; }
  function tokenAmount() {
    const tok = getTokenInfo();
    const isStable = tok && (["USDC","USDT","DAI","USDbC"].includes(tok.symbol));
    const price = isStable ? 1 : ethPrice;
    return amountMode === "token" ? parsed() : (price > 0 ? parsed() / price : 0);
  }
  function usdAmount() {
    const tok = getTokenInfo();
    const isStable = tok && (["USDC","USDT","DAI","USDbC"].includes(tok.symbol));
    const price = isStable ? 1 : ethPrice;
    return amountMode === "usd" ? parsed() : parsed() * price;
  }
  function overBalance() {
    const tok = getTokenInfo();
    return tokenAmount() > 0 && parseFloat(tok?.balance || "0") > 0 && tokenAmount() > parseFloat(tok?.balance || "0");
  }

  navigate(() => { renderInputStep(); });

  function renderInputStep() {
    const tok = getTokenInfo();
    const secondaryDisplay = amountMode === "token"
      ? `$${usdAmount().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${tokenAmount() > 0 ? tokenAmount().toFixed(8).replace(/\.?0+$/, "") : "0"} ${tok?.symbol ?? ""}`;
    const prefix = amountMode === "usd" && amountRaw ? `<span class="amount-prefix">$</span>` : "";

    setScreen(`
      <div class="screen send-screen screen-anim screen-anim--in">
        <button class="back" id="btn-back">← Back</button>
        <div class="receive-tabs">
          <button class="receive-tab${tab === "standard" ? " active" : ""}" id="stab-std">Standard</button>
          <button class="receive-tab${tab === "private" ? " active" : ""}" id="stab-prv">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.3rem"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Private
          </button>
        </div>
        <div class="field">
          <label>Token</label>
          <div class="token-field-row">
            <div class="token-selector" id="tok-sel-wrap">
              <button type="button" class="token-selector__trigger" id="tok-trigger">
                ${tokenLogo(tok?.logo ?? "", tok?.symbol ?? "", 20)}
                <span>${tok?.symbol ?? "Select"}</span>
                ${svgChev()}
              </button>
              <div class="token-selector__menu" id="tok-menu" style="display:none">
                ${tokens.map(t => `
                  <button type="button" class="token-selector__option${selectedToken === t.address ? " token-selector__option--active" : ""}" data-tok="${t.address}">
                    ${tokenLogo(t.logo, t.symbol, 20)}
                    <span>${t.symbol}</span>
                    <span class="token-selector__bal">${t.balance}</span>
                  </button>`).join("")}
              </div>
            </div>
            <button class="add-token-btn" id="btn-add-tok" aria-label="Add token">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>
        <div class="amount-wrap" id="amount-wrap">
          <div class="amount-display">
            ${prefix}
            <input id="amount-input" class="amount-input${overBalance() ? " amount-input--over" : ""}" type="text" inputmode="decimal" placeholder="0" value="${amountRaw}" />
          </div>
          <div class="amount-secondary">
            <span>${secondaryDisplay}</span>
            <button class="swap-btn" type="button" id="btn-swap-mode">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
            </button>
          </div>
          <button class="amount-max" type="button" id="btn-max">Max</button>
        </div>
        <div class="field" id="to-field">
          <label>${tab === "standard" ? "Recipient" : "Recipient stealth meta-address"}</label>
          <div class="ca-row">
            <input class="ca-input" id="to-input" value="${to}" placeholder="${tab === "standard" ? "0x…" : "0x… (134 chars)"}" style="font-size:${tab === "standard" ? "14" : "12"}px" autocomplete="off" spellcheck="false" />
            <button class="ca-paste-btn" id="btn-paste-to">${svgPaste()} Paste</button>
          </div>
          ${tab === "private" ? `<p class="send-private-hint">The recipient shares this from their Receive &gt; Private tab.</p>` : ""}
        </div>
        <div class="quorum">Signing with <strong>Device</strong> + <strong>Co-signer</strong></div>
        <p class="err" id="send-err" style="display:none"></p>
        <button class="btn btn--primary" id="btn-preview" ${!parsed() || !to || overBalance() ? "disabled" : ""}>Preview</button>
      </div>
    `);
    attachInputListeners();
  }

  function attachInputListeners() {
    document.getElementById("btn-back")!.addEventListener("click", renderDashboard);
    document.getElementById("stab-std")!.addEventListener("click", () => { tab = "standard"; to = ""; renderInputStep(); });
    document.getElementById("stab-prv")!.addEventListener("click", () => { tab = "private"; to = ""; renderInputStep(); });

    const amtIn = document.getElementById("amount-input") as HTMLInputElement;
    amtIn.focus();
    amtIn.addEventListener("input", () => {
      amountRaw = amtIn.value.replace(/[^0-9.]/g, "").replace(/(\..*?)\./g, "$1");
      amtIn.value = amountRaw;
      amtIn.classList.toggle("amount-input--over", overBalance());
      updatePreviewBtn();
      updateSecondary();
    });
    document.getElementById("amount-wrap")!.addEventListener("click", () => amtIn.focus());
    document.getElementById("btn-swap-mode")!.addEventListener("click", (e) => {
      e.stopPropagation();
      const next: "token" | "usd" = amountMode === "token" ? "usd" : "token";
      if (parsed() > 0 && ethPrice > 0) {
        const converted = next === "usd" ? parsed() * ethPrice : parsed() / ethPrice;
        amountRaw = converted.toFixed(next === "usd" ? 2 : 6).replace(/\.?0+$/, "");
      }
      amountMode = next;
      renderInputStep();
    });
    document.getElementById("btn-max")!.addEventListener("click", (e) => {
      e.stopPropagation();
      amountMode = "token";
      amountRaw = getTokenInfo()?.balance ?? "0";
      renderInputStep();
    });

    const toIn = document.getElementById("to-input") as HTMLInputElement;
    toIn.addEventListener("input", () => { to = toIn.value.trim(); updatePreviewBtn(); });
    document.getElementById("btn-paste-to")!.addEventListener("click", async () => {
      try { to = (await navigator.clipboard.readText()).trim(); toIn.value = to; updatePreviewBtn(); } catch {}
    });

    document.getElementById("btn-preview")!.addEventListener("click", goPreview);
    document.getElementById("btn-add-tok")!.addEventListener("click", () => {
      openAddTokenModal(vault.address, (tok) => {
        if (!tokens.find(t => t.address === tok.address)) tokens = [...tokens, tok];
        selectedToken = tok.address;
        amountRaw = "";
        renderInputStep();
      });
    });

    const trigger = document.getElementById("tok-trigger")!;
    const menu    = document.getElementById("tok-menu")!;
    let menuOpen  = false;
    trigger.addEventListener("click", () => {
      menuOpen = !menuOpen;
      menu.style.display = menuOpen ? "block" : "none";
    });
    document.addEventListener("mousedown", function outside(e) {
      if (!document.getElementById("tok-sel-wrap")?.contains(e.target as Node)) {
        menuOpen = false;
        if (menu) menu.style.display = "none";
        document.removeEventListener("mousedown", outside);
      }
    });
    menu.querySelectorAll<HTMLButtonElement>("[data-tok]").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedToken = btn.dataset.tok!;
        amountRaw = "";
        menuOpen = false;
        renderInputStep();
      });
    });
  }

  function updateSecondary() {
    const tok = getTokenInfo();
    const isStable = tok && (["USDC","USDT","DAI","USDbC"].includes(tok.symbol));
    const price = isStable ? 1 : ethPrice;
    const secondary = amountMode === "token"
      ? `$${(parsed() * price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${tokenAmount() > 0 ? tokenAmount().toFixed(8).replace(/\.?0+$/, "") : "0"} ${tok?.symbol ?? ""}`;
    const secEl = document.querySelector<HTMLElement>(".amount-secondary span");
    if (secEl) secEl.textContent = secondary;
  }

  function updatePreviewBtn() {
    const btn = document.getElementById("btn-preview") as HTMLButtonElement | null;
    if (btn) btn.disabled = !parsed() || !to || overBalance();
  }

  function goPreview() {
    if (!parsed()) { showSendErr("Enter an amount"); return; }
    if (tab === "standard") {
      if (!to.startsWith("0x") || to.length !== 42) { showSendErr("Enter a valid 0x address"); return; }
    } else {
      if (!to.startsWith("0x") || to.length !== 134) { showSendErr("Enter a valid stealth meta-address (134 chars)"); return; }
    }
    const tok = getTokenInfo();
    const ta  = tokenAmount();
    const ua  = usdAmount();
    setScreen(`
      <div class="screen send-screen screen-anim screen-anim--in">
        <button class="back" id="btn-edit">← Edit</button>
        <h2 class="title title--sm">Review</h2>
        <div class="preview-card">
          <div class="preview-card__label">Sending</div>
          <div class="preview-card__amount">${ta > 0 ? ta.toFixed(8).replace(/\.?0+$/, "") : "0"} ${tok?.symbol}</div>
          <div class="preview-card__usd">~$${ua.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="preview-card__divider"></div>
          <div class="preview-row">
            <span class="preview-row__key">To</span>
            ${tab === "private"
              ? `<span class="preview-row__val preview-row__val--private"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Private recipient</span>`
              : `<span class="preview-row__val preview-row__val--mono">${shortAddress(to)}</span>`}
          </div>
          ${tab === "private" ? `<div class="preview-row"><span class="preview-row__key">Privacy</span><span class="preview-row__val">One-time stealth address</span></div>` : ""}
          <div class="preview-row"><span class="preview-row__key">Network</span><span class="preview-row__val">Base</span></div>
          <div class="preview-row"><span class="preview-row__key">Signing</span><span class="preview-row__val">Device + Co-signer</span></div>
        </div>
        <button class="btn btn--primary" id="btn-confirm" ${loading ? "disabled" : ""}>${loading ? "Signing…" : "Confirm & Send"}</button>
        <p class="err" id="send-err" style="display:none"></p>
      </div>
    `);
    document.getElementById("btn-edit")!.addEventListener("click", () => renderInputStep());
    document.getElementById("btn-confirm")!.addEventListener("click", submitSend);
  }

  async function submitSend() {
    loading = true;
    const confirmBtn = document.getElementById("btn-confirm") as HTMLButtonElement | null;
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Signing…"; }
    const tok = getTokenInfo();
    const ta = tokenAmount();
    const decimals = tok?.decimals ?? 18;
    const amountWei = BigInt(Math.round(ta * 10 ** decimals)).toString();
    const serverKey = privateKeyToAddress(vault.shardAPrivKey);
    try {
      let hash: string;
      if (tab === "private") {
        const cd = await core.buildStealthSend(serverKey, vault.apiKey, to, amountWei, selectedToken || undefined);
        hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      } else {
        const cd = await core.buildSend(serverKey, vault.apiKey, to, amountWei, selectedToken || undefined);
        hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      }
      txHash = hash;
      txErr  = "";
      renderSendResult();
    } catch (e) {
      txHash = "";
      txErr  = errMsg(e);
      renderSendResult();
    } finally {
      loading = false;
    }
  }

  function renderSendResult() {
    const ok = !!txHash && !txErr;
    const short = ok ? `${txHash.slice(0, 10)}…${txHash.slice(-8)}` : "";
    const title = ok ? (tab === "private" ? "Sent privately!" : "Sent!") : "Transaction Failed";
    setScreen(`
      <div class="screen send-screen tx-result screen-anim screen-anim--in">
        <img src="${ok ? "/icons8-success-96.png" : "/icons8-fail-96.png"}" class="tx-result__icon" alt="" />
        <h2 class="tx-result__title">${title}</h2>
        ${ok ? `
          <div class="tx-result__hash-row">
            <span class="tx-result__hash">${short}</span>
            <button class="tx-result__copy" id="btn-copy-hash" aria-label="Copy">${svgCopy(15)}</button>
          </div>
          <a class="btn btn--primary tx-result__basescan" href="https://basescan.org/tx/${txHash}" target="_blank" rel="noopener">Open in Basescan ↗</a>
        ` : `
          <p class="tx-result__err">${txErr}</p>
          <button class="btn btn--primary" id="btn-retry">Try Again</button>
        `}
        <button class="btn btn--ghost" id="btn-close">Close</button>
      </div>
    `);
    document.getElementById("btn-close")!.addEventListener("click", renderDashboard);
    document.getElementById("btn-copy-hash")?.addEventListener("click", () => navigator.clipboard.writeText(txHash));
    document.getElementById("btn-retry")?.addEventListener("click", submitSend);
  }

  function showSendErr(msg: string) {
    const e = document.getElementById("send-err");
    if (e) { e.textContent = msg; e.style.display = ""; }
  }
}

function renderSwap(): void {
  if (!S.vault) return;
  const vault = S.vault;
  let tokenIn: SwapToken  = SWAP_TOKENS[0];
  let tokenOut: SwapToken = SWAP_TOKENS[2];
  let amountRaw = "";
  let quote: { amountOut: string; fee: number } | null = null;
  let quoting = false;
  let loading  = false;
  let slippage  = 50;
  let walletTokens: WalletToken[] = [];
  let ethPrice: number | null = null;
  let quoteTimer: ReturnType<typeof setTimeout> | null = null;
  let allTokens = [...SWAP_TOKENS];

  fetchWalletTokens(vault.address).then(t => { walletTokens = t; });
  fetchEthPrice().then(r => { ethPrice = r.price; });

  navigate(() => { renderSwapInput(); });

  function balanceOf(tok: SwapToken) {
    return walletTokens.find(t => t.address.toLowerCase() === tok.address.toLowerCase())?.balance ?? null;
  }
  function usdLabel(tok: SwapToken, bal: string): string | null {
    const n = parseFloat(bal);
    if (!n) return null;
    const stables = new Set(["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","0xfde4c96c8593536e31f229ea8f37b2ada2699bb2","0x50c5725949a6f0c72e6c4a641f24049a917db0cb","0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca"]);
    if (stables.has(tok.address.toLowerCase())) return `$${n.toFixed(2)}`;
    if (tok.address.toLowerCase() === "0x4200000000000000000000000000000000000006" && ethPrice) return `$${(n * ethPrice).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    return null;
  }
  function parsed() { return parseFloat(amountRaw) || 0; }
  function amountIn() { return parsed() > 0 ? BigInt(Math.round(parsed() * 10 ** tokenIn.decimals)).toString() : "0"; }
  function overSwap() {
    const bal = balanceOf(tokenIn);
    return bal !== null && parsed() > 0 && parseFloat(bal) > 0 && parsed() > parseFloat(bal);
  }
  function outFormatted() {
    if (!quote) return "";
    return (Number(BigInt(quote.amountOut)) / 10 ** tokenOut.decimals)
      .toFixed(tokenOut.decimals <= 6 ? 4 : 6).replace(/\.?0+$/, "");
  }

  function scheduleQuote() {
    quote = null;
    if (!parsed() || tokenIn.address === tokenOut.address) { updateQuoteArea(); return; }
    if (quoteTimer) clearTimeout(quoteTimer);
    quoting = true;
    updateQuoteArea();
    quoteTimer = setTimeout(async () => {
      try {
        const q = await core.getQuote(tokenIn.address, tokenOut.address, amountIn());
        quote = q;
      } catch { quote = null; }
      quoting = false;
      updateQuoteArea();
    }, 600);
  }

  function renderSwapInput() {
    const balIn  = balanceOf(tokenIn);
    const balOut = balanceOf(tokenOut);
    const usdIn  = balIn  ? usdLabel(tokenIn,  balIn)  : null;
    const usdOut = balOut ? usdLabel(tokenOut, balOut) : null;
    setScreen(`
      <div class="screen send-screen screen-anim screen-anim--in">
        <button class="back" id="btn-back">← Back</button>
        <div class="swap-header">
          <h2 class="title title--sm">Swap</h2>
          <div class="swap-powered">
            <span>powered by</span>
            <img src="/icons8-uniswap-64.png" alt="Uniswap" class="swap-uniswap-logo" />
          </div>
        </div>
        <div class="swap-panel">
          <div class="swap-side">
            <div class="swap-side__header">
              <span class="swap-side__label">You pay</span>
              ${balIn ? `<span class="swap-side__bal">${balIn} ${tokenIn.symbol}${usdIn ? ` <span class="swap-side__usd">(${usdIn})</span>` : ""}</span>` : ""}
            </div>
            <div class="swap-side__row">
              <button class="swap-tok-btn" id="btn-pick-in">
                ${tokenIn.logo ? `<img src="${tokenIn.logo}" width="24" height="24" class="swap-tok-logo" alt="" />` : `<div class="swap-tok-logo swap-tok-logo--fallback" style="width:24px;height:24px">${tokenIn.symbol[0]}</div>`}
                <span>${tokenIn.symbol}</span>
                ${svgChev(12)}
              </button>
              <input id="swap-in" class="swap-amount-input${overSwap() ? " swap-amount-input--over" : ""}" type="text" inputmode="decimal" placeholder="0" value="${amountRaw}" />
            </div>
            ${balIn && parseFloat(balIn) > 0 ? `
              <div class="swap-pct-row">
                <button class="swap-pct-btn" data-pct="0.5">50%</button>
                <button class="swap-pct-btn" data-pct="0.75">75%</button>
                <button class="swap-pct-btn" data-pct="1">Max</button>
              </div>` : ""}
          </div>
          <button class="swap-flip-btn" id="btn-flip">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
          </button>
          <div class="swap-side">
            <div class="swap-side__header">
              <span class="swap-side__label">You receive</span>
              ${balOut ? `<span class="swap-side__bal">${balOut} ${tokenOut.symbol}${usdOut ? ` <span class="swap-side__usd">(${usdOut})</span>` : ""}</span>` : ""}
            </div>
            <div class="swap-side__row">
              <button class="swap-tok-btn" id="btn-pick-out">
                ${tokenOut.logo ? `<img src="${tokenOut.logo}" width="24" height="24" class="swap-tok-logo" alt="" />` : `<div class="swap-tok-logo swap-tok-logo--fallback" style="width:24px;height:24px">${tokenOut.symbol[0]}</div>`}
                <span>${tokenOut.symbol}</span>
                ${svgChev(12)}
              </button>
              <div class="swap-amount-out" id="swap-out-val">
                ${outFormatted() || `<span class="swap-amount-out__empty">·</span>`}
              </div>
            </div>
          </div>
        </div>
        <div id="quote-area">${quoteAreaHTML()}</div>
        <button class="btn btn--primary" id="btn-swap-submit" ${loading || !quote || parsed() <= 0 || overSwap() ? "disabled" : ""}>
          ${loading ? "Swapping…" : `<img src="/icons8-swap-96-2.png" width="18" height="18" alt="" style="vertical-align:middle;margin-right:0.35rem" />Swap`}
        </button>
        <div class="swap-slippage-row">
          <button class="swap-slippage-toggle" id="btn-slippage">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 0 0 4.93 19.07M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            Slippage: ${slippage / 100}%
          </button>
        </div>
      </div>
    `);
    attachSwapListeners();
  }

  function quoteAreaHTML(): string {
    if (quoting) return `<div class="swap-fetching">${svgSpinner(14)} Fetching quote…</div>`;
    if (!quote) return "";
    const rate = (Number(BigInt(quote.amountOut)) / 10 ** tokenOut.decimals / parsed()).toFixed(4);
    return `
      <div class="swap-fees">
        <div class="swap-fees__row"><span class="swap-fees__label">Marmo Privacy Fee</span><span class="swap-fees__val">0.75%</span></div>
        <div class="swap-fees__row"><span class="swap-fees__label">Uniswap Pool Fee</span><span class="swap-fees__val">${(quote.fee / 100).toFixed(2)}%</span></div>
        <div class="swap-fees__row swap-fees__row--rate"><span class="swap-fees__label">Rate</span><span class="swap-fees__val">1 ${tokenIn.symbol} ≈ ${rate} ${tokenOut.symbol}</span></div>
      </div>`;
  }

  function updateQuoteArea() {
    const qArea   = document.getElementById("quote-area");
    const outVal  = document.getElementById("swap-out-val");
    const subBtn  = document.getElementById("btn-swap-submit") as HTMLButtonElement | null;
    if (qArea) qArea.innerHTML = quoteAreaHTML();
    if (outVal) outVal.innerHTML = outFormatted() || `<span class="swap-amount-out__empty">·</span>`;
    if (subBtn) subBtn.disabled = loading || !quote || parsed() <= 0 || overSwap();
  }

  function attachSwapListeners() {
    document.getElementById("btn-back")!.addEventListener("click", renderDashboard);

    const swapIn = document.getElementById("swap-in") as HTMLInputElement;
    swapIn.addEventListener("input", () => {
      amountRaw = swapIn.value.replace(/[^0-9.]/g, "").replace(/(\..*?)\./g, "$1");
      swapIn.classList.toggle("swap-amount-input--over", overSwap());
      scheduleQuote();
    });

    document.querySelectorAll<HTMLButtonElement>("[data-pct]").forEach(btn => {
      btn.addEventListener("click", () => {
        const bal = balanceOf(tokenIn);
        if (!bal) return;
        const pct = parseFloat(btn.dataset.pct!);
        amountRaw = (parseFloat(bal) * pct).toFixed(tokenIn.decimals).replace(/\.?0+$/, "");
        renderSwapInput();
        scheduleQuote();
      });
    });

    document.getElementById("btn-flip")!.addEventListener("click", () => {
      [tokenIn, tokenOut] = [tokenOut, tokenIn];
      amountRaw = "";
      quote = null;
      renderSwapInput();
    });

    document.getElementById("btn-pick-in")!.addEventListener("click", () => openSwapTokenModal("in"));
    document.getElementById("btn-pick-out")!.addEventListener("click", () => openSwapTokenModal("out"));

    document.getElementById("btn-swap-submit")!.addEventListener("click", submitSwap);
    document.getElementById("btn-slippage")!.addEventListener("click", openSlippageModal);
  }

  function openSwapTokenModal(side: "in" | "out") {
    const exclude = side === "in" ? tokenIn.address : tokenOut.address;
    const overlay = modal(`
      <div class="modal-panel" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">Select token</span>
          <button class="modal-close" id="stm-close">${svgX()}</button>
        </div>
        <div class="ca-row">
          <input class="ca-input" id="stm-search" placeholder="Search or paste contract address" autocomplete="off" spellcheck="false" style="font-size:14px" />
          <button class="ca-paste-btn" id="stm-paste">${svgPaste()} Paste</button>
        </div>
        <div class="swap-token-list" id="stm-list"></div>
      </div>
    `);
    overlay.addEventListener("click", () => closeModal(overlay));
    document.getElementById("stm-close")!.addEventListener("click", () => closeModal(overlay));

    const searchIn = document.getElementById("stm-search") as HTMLInputElement;
    const listEl   = document.getElementById("stm-list")!;

    function renderList(q: string) {
      const filtered = allTokens.filter(t =>
        t.address !== exclude &&
        (t.symbol.toLowerCase().includes(q.toLowerCase()) || t.address.toLowerCase().includes(q.toLowerCase()))
      );
      listEl.innerHTML = filtered.length === 0
        ? `<p class="modal-hint" style="margin-top:0.75rem">No tokens found.</p>`
        : filtered.map(t => `
          <button class="swap-token-item" data-tok-addr="${t.address}">
            ${t.logo ? `<img src="${t.logo}" width="36" height="36" class="swap-tok-logo" alt="" />` : `<div class="swap-tok-logo swap-tok-logo--fallback" style="width:36px;height:36px">${t.symbol[0]}</div>`}
            <div class="swap-token-item__info">
              <span class="swap-token-item__sym">${t.symbol}</span>
              <span class="swap-token-item__addr">${t.address.slice(0, 6)}…${t.address.slice(-4)}</span>
            </div>
          </button>`).join("");
      listEl.querySelectorAll<HTMLButtonElement>("[data-tok-addr]").forEach(btn => {
        btn.addEventListener("click", () => {
          const tok = allTokens.find(t => t.address === btn.dataset.tokAddr!);
          if (!tok) return;
          if (side === "in") { if (tok.address === tokenOut.address) tokenOut = tokenIn; tokenIn = tok; }
          else               { if (tok.address === tokenIn.address)  tokenIn  = tokenOut; tokenOut = tok; }
          amountRaw = ""; quote = null;
          closeModal(overlay);
          renderSwapInput();
        });
      });
    }

    renderList("");
    searchIn.focus();
    searchIn.addEventListener("input", () => {
      const q = searchIn.value;
      renderList(q);
      if (/^0x[0-9a-fA-F]{40}$/.test(q.trim())) {
        fetchTokenByAddress(vault.address, q.trim())
          .then(tok => {
            const st: SwapToken = { address: tok.address, symbol: tok.symbol, decimals: tok.decimals, logo: "" };
            if (!allTokens.find(t => t.address === st.address)) allTokens = [...allTokens, st];
            renderList(q);
          }).catch(() => {});
      }
    });
    document.getElementById("stm-paste")!.addEventListener("click", async () => {
      try { searchIn.value = (await navigator.clipboard.readText()).trim(); searchIn.dispatchEvent(new Event("input")); } catch {}
    });
  }

  function openSlippageModal() {
    const overlay = modal(`
      <div class="modal-panel" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">Slippage tolerance</span>
          <button class="modal-close" id="slip-close">${svgX()}</button>
        </div>
        <p class="modal-hint">Your swap reverts if the price moves more than this from the quoted rate.</p>
        <div class="swap-slippage-opts">
          ${[25, 50, 100, 200].map(bps => `<button class="swap-slippage-opt${slippage === bps ? " active" : ""}" data-bps="${bps}">${bps / 100}%</button>`).join("")}
        </div>
        <div class="ca-row" style="margin-top:0.9rem">
          <input class="ca-input" id="slip-custom" type="text" inputmode="decimal" placeholder="Custom % (e.g. 1.5)" autocomplete="off" style="font-size:14px" />
        </div>
        <button class="btn btn--primary" id="slip-done" style="margin-top:1rem">Done</button>
      </div>
    `);
    overlay.addEventListener("click", () => closeModal(overlay));
    document.getElementById("slip-close")!.addEventListener("click", () => closeModal(overlay));
    document.getElementById("slip-done")!.addEventListener("click", () => closeModal(overlay));
    overlay.querySelectorAll<HTMLButtonElement>("[data-bps]").forEach(btn => {
      btn.addEventListener("click", () => {
        slippage = parseInt(btn.dataset.bps!);
        overlay.querySelectorAll<HTMLButtonElement>("[data-bps]").forEach(b => b.classList.toggle("active", b === btn));
        const slipBtn = document.getElementById("btn-slippage");
        if (slipBtn) slipBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg> Slippage: ${slippage / 100}%`;
      });
    });
    const customIn = document.getElementById("slip-custom") as HTMLInputElement;
    customIn.addEventListener("input", () => {
      const v = parseFloat(customIn.value.replace(/[^0-9.]/g, ""));
      if (v > 0 && v <= 50) { slippage = Math.round(v * 100); overlay.querySelectorAll("[data-bps]").forEach(b => b.classList.remove("active")); }
    });
  }

  async function submitSwap() {
    loading = true;
    const submitBtn = document.getElementById("btn-swap-submit") as HTMLButtonElement | null;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = "Swapping…"; }
    try {
      const cosignKey = privateKeyToAddress(vault.shardAPrivKey);
      const cd   = await core.buildSwap(cosignKey, vault.apiKey, tokenIn.address, tokenOut.address, amountIn(), slippage);
      const hash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
      const short = `${hash.slice(0, 10)}…${hash.slice(-8)}`;
      setScreen(`
        <div class="screen send-screen tx-result screen-anim screen-anim--in">
          <img src="/icons8-success-96.png" class="tx-result__icon" alt="" />
          <h2 class="tx-result__title">Swapped!</h2>
          <div class="tx-result__hash-row">
            <span class="tx-result__hash">${short}</span>
            <button class="tx-result__copy" id="btn-copy-hash">${svgCopy(15)}</button>
          </div>
          <a class="btn btn--primary tx-result__basescan" href="https://basescan.org/tx/${hash}" target="_blank" rel="noopener">Open in Basescan ↗</a>
          <button class="btn btn--ghost" id="btn-close">Close</button>
        </div>
      `);
      document.getElementById("btn-close")!.addEventListener("click", renderDashboard);
      document.getElementById("btn-copy-hash")?.addEventListener("click", () => navigator.clipboard.writeText(hash));
    } catch (e) {
      setScreen(`
        <div class="screen send-screen tx-result screen-anim screen-anim--in">
          <img src="/icons8-fail-96.png" class="tx-result__icon" alt="" />
          <h2 class="tx-result__title">Swap Failed</h2>
          <p class="tx-result__err">${errMsg(e)}</p>
          <button class="btn btn--primary" id="btn-retry">Try Again</button>
          <button class="btn btn--ghost" id="btn-close">Close</button>
        </div>
      `);
      document.getElementById("btn-retry")!.addEventListener("click", () => { loading = false; renderSwapInput(); });
      document.getElementById("btn-close")!.addEventListener("click", renderDashboard);
    } finally {
      loading = false;
    }
  }
}

function renderSetupTotp(): void {
  if (!S.vault) return;
  const vault = S.vault;
  let step: "qr" | "confirm" = "qr";
  let totpData: { secret: string; uri: string } | null = null;
  let code = "";
  let loading = false;

  navigate(() => {
    renderTotpStep();
    initTotpSetup(vault).then(d => {
      totpData = d;
      renderTotpStep();
    }).catch(e => {
      const err = document.getElementById("totp-err");
      if (err) { err.textContent = errMsg(e); err.style.display = ""; }
    });
  });

  function qrUrl(): string {
    if (!totpData) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpData.uri)}&color=e9f0f8&bgcolor=141b24&margin=10&qzone=1`;
  }

  function renderTotpStep() {
    if (step === "qr") {
      setScreen(`
        <div class="screen send-screen screen-anim screen-anim--in">
          <button class="back" id="btn-back">← Back</button>
          <h2 class="title title--sm">Set up recovery</h2>
          <p class="totp-setup__hint">Scan this QR code with Google Authenticator, Microsoft Authenticator, or Authy. This links your wallet to your authenticator app so you can recover access if you lose this device.</p>
          ${!totpData ? `<div style="display:flex;justify-content:center;padding:2rem 0">${svgSpinner(28)}</div>` : `
            <div class="totp-setup__qr-wrap">
              <img src="${qrUrl()}" width="200" height="200" class="totp-setup__qr" alt="Authenticator QR code" />
            </div>
            <div class="totp-setup__manual">
              <span class="totp-setup__manual-label">Or enter manually</span>
              <button class="totp-setup__secret" id="btn-copy-secret">${totpData.secret} ${svgCopy(14)}</button>
            </div>`}
          <p class="err" id="totp-err" style="display:none"></p>
          <button class="btn btn--primary" id="btn-scanned" ${!totpData ? "disabled" : ""}>I scanned it</button>
          <button class="btn btn--ghost" id="btn-skip">Skip for now</button>
        </div>
      `);
      document.getElementById("btn-back")!.addEventListener("click", renderDashboard);
      document.getElementById("btn-skip")!.addEventListener("click", renderDashboard);
      document.getElementById("btn-copy-secret")?.addEventListener("click", () => {
        if (totpData) { navigator.clipboard.writeText(totpData.secret); toast("Secret copied"); }
      });
      document.getElementById("btn-scanned")!.addEventListener("click", () => { step = "confirm"; renderTotpStep(); });
    } else {
      setScreen(`
        <div class="screen send-screen screen-anim screen-anim--in">
          <button class="back" id="btn-back">← Back</button>
          <h2 class="title title--sm">Set up recovery</h2>
          <p class="totp-setup__hint">Open your authenticator app and enter the 6-digit code for Marmo to confirm the link.</p>
          <input class="totp-setup__code-input" id="totp-code" type="text" inputmode="numeric" maxlength="6" placeholder="000000" value="${code}" autofocus />
          <p class="err" id="totp-err" style="display:none"></p>
          <button class="btn btn--primary" id="btn-confirm" ${loading || code.length !== 6 ? "disabled" : ""}>${loading ? "Verifying…" : "Confirm"}</button>
          <button class="btn btn--ghost" id="btn-back-step">← Back</button>
        </div>
      `);
      const codeIn = document.getElementById("totp-code") as HTMLInputElement;
      const confirmBtn = document.getElementById("btn-confirm") as HTMLButtonElement;
      codeIn.addEventListener("input", () => {
        code = codeIn.value.replace(/\D/g, "").slice(0, 6);
        codeIn.value = code;
        confirmBtn.disabled = loading || code.length !== 6;
      });
      document.getElementById("btn-back")!.addEventListener("click", renderDashboard);
      document.getElementById("btn-back-step")!.addEventListener("click", () => { step = "qr"; renderTotpStep(); });
      confirmBtn.addEventListener("click", async () => {
        if (!/^\d{6}$/.test(code)) return;
        loading = true;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Verifying…";
        const errEl = document.getElementById("totp-err")!;
        errEl.style.display = "none";
        try {
          const updated = await confirmTotpSetup(vault, code);
          S.vault = updated;
          renderDashboard();
        } catch (e) {
          errEl.textContent = errMsg(e);
          errEl.style.display = "";
          loading = false;
          confirmBtn.disabled = false;
          confirmBtn.textContent = "Confirm";
        }
      });
    }
  }
}

async function boot(): Promise<void> {
  renderLoading();
  if (await vaultExists().catch(() => false)) {
    try {
      const v = await loadVault();
      await verifyPasskey(v.credentialId);
      S.vault = v;
      if (v.totpEnabled) {
        ensureVaultBackup(v).catch(e => { S.backupErr = errMsg(e); });
      }
      renderDashboard();
      return;
    } catch {
      renderWelcome();
      return;
    }
  }
  renderWelcome();
}

boot();
