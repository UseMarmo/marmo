import { MultiSigPublicKey } from "@mysten/sui/multisig";
import type { PublicKey } from "@mysten/sui/cryptography";
import { Shard } from "./shard.js";

export interface WeightedMember {
  publicKey: PublicKey;
  weight?: number;
}

export type WalletMember = Shard | PublicKey | WeightedMember;

export interface WalletConfig {
  members: WalletMember[];
  threshold: number;
}

function normalize(member: WalletMember): { publicKey: PublicKey; weight: number } {
  if (member instanceof Shard) {
    return { publicKey: member.publicKey, weight: 1 };
  }
  if ("publicKey" in member) {
    return { publicKey: member.publicKey, weight: member.weight ?? 1 };
  }
  return { publicKey: member, weight: 1 };
}

export class MarmoWallet {
  readonly publicKey: MultiSigPublicKey;
  readonly threshold: number;

  constructor(publicKey: MultiSigPublicKey, threshold: number) {
    this.publicKey = publicKey;
    this.threshold = threshold;
  }

  static from(config: WalletConfig): MarmoWallet {
    const members = config.members.map(normalize);
    const publicKey = MultiSigPublicKey.fromPublicKeys({
      threshold: config.threshold,
      publicKeys: members,
    });
    return new MarmoWallet(publicKey, config.threshold);
  }

  static twoOfThree(a: WalletMember, b: WalletMember, c: WalletMember): MarmoWallet {
    return MarmoWallet.from({ members: [a, b, c], threshold: 2 });
  }

  get address(): string {
    return this.publicKey.toSuiAddress();
  }

  combine(signatures: string[]): string {
    return this.publicKey.combinePartialSignatures(signatures);
  }
}
