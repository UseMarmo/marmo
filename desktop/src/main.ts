import "./styles.css";
import {
  createWallet,
  vaultExists,
  loadVault,
  connectDrive,
  isDriveConnected,
  getBalanceSui,
  requestFaucet,
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
        <span class="bar__net">testnet</span>
      </header>
      <main class="screen">${body}</main>
    </div>
  `;
}

function toast(message: string, kind: "ok" | "err" = "ok"): void {
  const t = el(`<div class="toast toast--${kind}">${message}</div>`);
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
        Marmo creates three shards across a drive, a co-signer, and a recovery login.
        Any two can spend. No single one ever can.
      </p>
      <button class="btn btn--primary btn--lg" data-create>Create my wallet</button>
      <p class="fine">A 2-of-3 multisig wallet on Sui. You will save your drive shard to a USB drive.</p>
    </section>
  `);

  app.querySelector("[data-create]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Generating shards…";
    try {
      const created = await createWallet();
      vault = created.vault;
      toast(created.driveSaved ? "Wallet created. Drive shard saved." : "Wallet created. Save your drive shard soon.");
      renderDashboard();
    } catch (err) {
      toast(message(err), "err");
      btn.disabled = false;
      btn.textContent = "Create my wallet";
    }
  });
}

function renderDashboard(): void {
  if (!vault) return;
  const connected = isDriveConnected();

  app.innerHTML = chrome(`
    <section class="dash">
      <div class="card card--balance">
        <div class="card__row">
          <span class="card__label">Marmo Wallet</span>
          <span class="pill pill--multisig">2-of-3</span>
        </div>
        <div class="balance" data-balance>—</div>
        <button class="addr" data-addr title="Copy address">
          <code>${shortAddress(vault.address)}</code><span>copy</span>
        </button>
        <div class="card__actions">
          <button class="btn btn--ghost" data-faucet>Get testnet SUI</button>
          <button class="btn btn--primary" data-send ${connected ? "" : "disabled"}>Send</button>
        </div>
      </div>

      <div class="drive ${connected ? "drive--on" : "drive--off"}" data-drive-row>
        <div class="drive__icon">${connected ? "✓" : "!"}</div>
        <div class="drive__copy">
          <strong>${connected ? "Drive shard connected" : "Drive shard not connected"}</strong>
          <span>${connected ? "Quorum ready: Drive + Co-signer" : "Plug in your USB and load the shard to sign"}</span>
        </div>
        ${connected ? "" : '<button class="btn btn--dark" data-connect>Connect drive</button>'}
      </div>

      <div class="shard-list">
        <div class="shard-row shard-row--on"><b>A</b><div><strong>Drive</strong><span>${connected ? "connected" : "offline"}</span></div></div>
        <div class="shard-row shard-row--on"><b>B</b><div><strong>Co-signer</strong><span>ready</span></div></div>
        <div class="shard-row"><b>C</b><div><strong>Recovery</strong><span>zkLogin · resting</span></div></div>
      </div>
    </section>
  `);

  refreshBalance();

  app.querySelector("[data-addr]")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(vault!.address);
    toast("Address copied");
  });

  app.querySelector("[data-faucet]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Requesting…";
    try {
      await requestFaucet(vault!.address);
      toast("Faucet sent. Balance updates shortly.");
      setTimeout(refreshBalance, 4000);
    } catch (err) {
      toast(message(err), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Get testnet SUI";
    }
  });

  app.querySelector("[data-connect]")?.addEventListener("click", async () => {
    try {
      const ok = await connectDrive();
      if (ok) {
        toast("Drive connected");
        renderDashboard();
      }
    } catch (err) {
      toast(message(err), "err");
    }
  });

  app.querySelector("[data-send]")?.addEventListener("click", renderSend);
}

function renderSend(): void {
  if (!vault) return;
  app.innerHTML = chrome(`
    <section class="send">
      <button class="back" data-back>← Back</button>
      <h2 class="title title--sm">Send SUI</h2>
      <label class="field">
        <span>Recipient</span>
        <input type="text" placeholder="0x…" data-to />
      </label>
      <label class="field">
        <span>Amount (SUI)</span>
        <input type="number" min="0" step="0.01" placeholder="0.00" data-amount />
      </label>
      <div class="quorum">
        <span class="quorum__dot"></span> Will sign with <b>Drive</b> + <b>Co-signer</b>
      </div>
      <button class="btn btn--primary btn--lg" data-submit>Sign &amp; send</button>
      <div class="result" data-result></div>
    </section>
  `);

  app.querySelector("[data-back]")?.addEventListener("click", renderDashboard);

  app.querySelector("[data-submit]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const to = app.querySelector<HTMLInputElement>("[data-to]")!.value.trim();
    const amount = Number(app.querySelector<HTMLInputElement>("[data-amount]")!.value);
    const result = app.querySelector<HTMLElement>("[data-result]")!;

    if (!to.startsWith("0x") || to.length < 10) return toast("Enter a valid address", "err");
    if (!(amount > 0)) return toast("Enter an amount", "err");

    btn.disabled = true;
    btn.textContent = "Signing 2 of 3…";
    result.innerHTML = "";
    try {
      const r = await send(vault!, to, amount);
      result.innerHTML = `
        <div class="result__ok">
          <strong>Sent ✓</strong>
          <span>Status: ${r.status}</span>
          <a href="${r.explorer}" target="_blank" rel="noopener">View on explorer ↗</a>
        </div>`;
      toast("Transaction confirmed");
    } catch (err) {
      result.innerHTML = `<div class="result__err">${message(err)}</div>`;
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
    const sui = await getBalanceSui(vault.address);
    node.innerHTML = `${sui.toLocaleString(undefined, { maximumFractionDigits: 4 })} <small>SUI</small>`;
  } catch {
    node.textContent = "—";
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function boot(): Promise<void> {
  try {
    if (await vaultExists()) {
      vault = await loadVault();
      renderDashboard();
      return;
    }
  } catch {
    vault = null;
  }
  renderWelcome();
}

boot();
