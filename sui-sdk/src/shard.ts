import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { PublicKey } from "@mysten/sui/cryptography";

export class Shard {
  readonly keypair: Ed25519Keypair;
  readonly label: string;

  constructor(keypair: Ed25519Keypair, label = "") {
    this.keypair = keypair;
    this.label = label;
  }

  static create(label = ""): Shard {
    return new Shard(Ed25519Keypair.generate(), label);
  }

  static fromSecret(secretKey: string, label = ""): Shard {
    return new Shard(Ed25519Keypair.fromSecretKey(secretKey), label);
  }

  get publicKey(): PublicKey {
    return this.keypair.getPublicKey();
  }

  get address(): string {
    return this.keypair.getPublicKey().toSuiAddress();
  }

  exportSecret(): string {
    return this.keypair.getSecretKey();
  }

  async sign(transactionBytes: Uint8Array): Promise<string> {
    const { signature } = await this.keypair.signTransaction(transactionBytes);
    return signature;
  }
}
