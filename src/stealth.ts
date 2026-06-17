import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, bytesToHex, hexToBytes } from "viem";
import { publicKeyToAddress } from "viem/accounts";

export interface StealthMetaAddress {
  spendPub: `0x${string}`;
  viewPub: `0x${string}`;
}

export interface StealthResult {
  stealthAddress: `0x${string}`;
  ephemeralPubKey: `0x${string}`;
  viewTag: number;
}

export function parseMetaAddress(raw: string): StealthMetaAddress {
  const hex = raw.replace(/^0x/, "");
  if (hex.length !== 132) throw new Error("stealth meta-address must be 66 bytes (spendPub || viewPub)");
  return {
    spendPub: `0x${hex.slice(0, 66)}`,
    viewPub: `0x${hex.slice(66)}`,
  };
}

export function encodeMetaAddress(spendPub: `0x${string}`, viewPub: `0x${string}`): `0x${string}` {
  return `0x${spendPub.slice(2)}${viewPub.slice(2)}`;
}

export function computeStealthAddress(meta: StealthMetaAddress): StealthResult {
  const r = secp256k1.utils.randomPrivateKey();
  const rBig = BigInt(bytesToHex(r));

  const R = secp256k1.ProjectivePoint.fromPrivateKey(r);

  const V = secp256k1.ProjectivePoint.fromHex(meta.viewPub.slice(2));
  const S = V.multiply(rBig);

  const Sx = S.toAffine().x;
  const SxBytes = numberToBytes32(Sx);

  const h = keccak256(SxBytes);
  const hBig = BigInt(h) % secp256k1.CURVE.n;

  const P = secp256k1.ProjectivePoint.fromHex(meta.spendPub.slice(2));
  const hG = secp256k1.ProjectivePoint.BASE.multiply(hBig);
  const Pstealth = P.add(hG);

  const stealthAddress = publicKeyToAddress(bytesToHex(Pstealth.toRawBytes(false)));
  const ephemeralPubKey = bytesToHex(R.toRawBytes(true));
  const viewTag = parseInt(h.slice(2, 4), 16);

  return { stealthAddress, ephemeralPubKey, viewTag };
}

function numberToBytes32(n: bigint): Uint8Array {
  return hexToBytes(`0x${n.toString(16).padStart(64, "0")}`);
}
