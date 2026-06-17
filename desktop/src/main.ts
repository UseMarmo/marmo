import "./styles.css";
import {
  createWallet,
  vaultExists,
  loadVault,
  verifyPasskey,
  getBalance,
  getStealthMetaAddress,
  send,
  shortAddress,
  type Vault,
} from "./wallet.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
let vault: Vault | null = null;

function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function chrome(body: string): string {
  return `
    <div class="shell">
      <header class="bar">
        <div class="bar__brand"><img src="/logo.png" width="26" height="26" alt="" /><span>Marmo</span></div>
        <span class="bar__net">Base</span>
      </header>
      <main class="screen">${body}</main>
    </div>
  `;
}

function toast(msg: string, kind: "ok" | "err" = "ok"): void {
  const t = el(`<div class="toast toast--${kind}">${msg}</div>`);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("is-in"));
  setTimeout(() => {
    t.classList.remove("is-in");
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

function renderWelcome(): void {
  app.innerHTML = chrome(`
    <section class="welcome">
      <h1 class="title">One wallet,<br />split in three.</h1>
      <p class="sub">
        Marmo creates three shards across your device, a co-signer, and your passkey.
        Any two can spend. No single one ever can.
      </p>
      <button class="btn btn--primary btn--lg" data-create>Create my wallet</button>
      <p class="fine">A 2-of-3 smart account on Base. You will register a passkey during setup.</p>
    </section>
  `);

  app.querySelector("[data-create]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Generating shards…";
    try {
      const created = await createWallet();
      vault = created.vault;
      toast("Wallet created. Passkey registered.");
      renderDashboard();
    } catch (err) {
      toast(errMsg(err), "err");
      btn.disabled = false;
      btn.textContent = "Create my wallet";
    }
  });
}

function renderDashboard(): void {
  if (!vault) return;

  app.innerHTML = chrome(`
    <section class="dash">
      <div class="card card--balance">
        <div class="card__row">
          <span class="card__label">Marmo Wallet</span>
          <span class="pill pill--multisig">2-of-3</span>
        </div>
        <div class="balance" data-balance>-</div>
        <button class="addr" data-addr title="Copy address">
          <code>${shortAddress(vault.address)}</code><span>copy</span>
        </button>
        <div class="card__actions">
          <button class="btn btn--ghost" data-receive>Receive</button>
          <button class="btn btn--primary" data-send>Send</button>
        </div>
      </div>

      <div class="shard-list">
        <div class="shard-row shard-row--on"><b>A</b><div><strong>Device</strong><span>this app</span></div></div>
        <div class="shard-row shard-row--on"><b>B</b><div><strong>Co-signer</strong><span>ready</span></div></div>
        <div class="shard-row shard-row--on"><b>C</b><div><strong>Passkey</strong><span>registered</span></div></div>
      </div>
    </section>
  `);

  refreshBalance();

  app.querySelector("[data-addr]")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(vault!.address);
    toast("Address copied");
  });

  app.querySelector("[data-receive]")?.addEventListener("click", renderReceive);
  app.querySelector("[data-send]")?.addEventListener("click", renderSend);
}

function renderReceive(): void {
  if (!vault) return;
  const meta = getStealthMetaAddress(vault);

  app.innerHTML = chrome(`
    <section class="send">
      <button class="back" data-back>← Back</button>
      <h2 class="title title--sm">Receive</h2>
      <p class="sub" style="font-size:0.88rem;margin-bottom:1rem;">
        Share your stealth meta-address so senders can pay you privately. Each payment
        goes to a fresh one-time address that only you can detect.
      </p>
      <label class="field">
        <span>Stealth meta-address (ERC-5564)</span>
        <textarea class="meta-addr" rows="3" readonly>${meta}</textarea>
      </label>
      <button class="btn btn--primary" data-copy>Copy meta-address</button>
      <p class="fine" style="margin-top:0.9rem;">Regular address: <code>${shortAddress(vault.address)}</code></p>
    </section>
  `);

  app.querySelector("[data-back]")?.addEventListener("click", renderDashboard);
  app.querySelector("[data-copy]")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(meta);
    toast("Meta-address copied");
  });
}

function renderSend(): void {
  if (!vault) return;
  app.innerHTML = chrome(`
    <section class="send">
      <button class="back" data-back>← Back</button>
      <h2 class="title title--sm">Send</h2>
      <label class="field">
        <span>Recipient (address or stealth meta-address)</span>
        <input type="text" placeholder="0x…" data-to />
      </label>
      <label class="field">
        <span>Amount</span>
        <input type="number" min="0" step="0.000001" placeholder="0.00" data-amount />
      </label>
      <label class="field">
        <span>Token</span>
        <select data-token>
          <option value="">ETH</option>
          <option value="USDC">USDC</option>
        </select>
      </label>
      <div class="quorum">
        <span class="quorum__dot"></span> Will sign with <b>Device</b> + <b>Co-signer</b>
      </div>
      <button class="btn btn--primary btn--lg" data-submit>Sign &amp; send</button>
      <div class="result" data-result></div>
    </section>
  `);

  app.querySelector("[data-back]")?.addEventListener("click", renderDashboard);

  app.querySelector("[data-submit]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const toInput = app.querySelector<HTMLInputElement>("[data-to]")!.value.trim();
    const amountInput = app.querySelector<HTMLInputElement>("[data-amount]")!.value.trim();
    const token = app.querySelector<HTMLSelectElement>("[data-token]")!.value || undefined;
    const resultEl = app.querySelector<HTMLElement>("[data-result]")!;

    if (!toInput.startsWith("0x") || toInput.length < 10) return toast("Enter a valid address", "err");
    if (!amountInput || Number(amountInput) <= 0) return toast("Enter an amount", "err");

    const decimals = token === "USDC" ? 6 : 18;
    const amountWei = BigInt(Math.round(Number(amountInput) * 10 ** decimals)).toString();

    btn.disabled = true;
    btn.textContent = "Signing 2 of 3…";
    resultEl.innerHTML = "";

    try {
      const isStealthRecipient = toInput.length > 42;
      let explorerUrl: string;

      if (isStealthRecipient) {
        const { stealthSend } = await import("./wallet.js");
        const sr = await stealthSend(vault!, toInput, amountWei, token);
        toast(`Stealth send to ${shortAddress(sr.stealthAddress)}`);
        explorerUrl = sr.explorer;
      } else {
        const r = await send(vault!, toInput, amountWei, token);
        toast("Transaction submitted");
        explorerUrl = r.explorer;
      }

      resultEl.innerHTML = `
        <div class="result__ok">
          <strong>Submitted</strong>
          <a href="${explorerUrl}" target="_blank" rel="noopener">View on BaseScan ↗</a>
        </div>`;
    } catch (err) {
      resultEl.innerHTML = `<div class="result__err">${errMsg(err)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign & send";
    }
  });
}

async function refreshBalance(): Promise<void> {
  if (!vault) return;
  const node = app.querySelector<HTMLElement>("[data-balance]");
  if (!node) return;
  try {
    const bal = await getBalance(vault.address);
    node.innerHTML = `${bal.eth} <small>ETH</small><br><span class="balance-usdc">${bal.usdc} USDC</span>`;
  } catch {
    node.textContent = "-";
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function boot(): Promise<void> {
  if (await vaultExists().catch(() => false)) {
    try {
      vault = await loadVault();
      await verifyPasskey(vault.credentialId);
      renderDashboard();
      return;
    } catch {
      toast("Passkey required to unlock", "err");
    }
  }
  renderWelcome();
}

boot();
