import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, Wallet } from "ethers";
import { MarmoAccount, MarmoAccountFactory } from "../typechain-types";

const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

function buildPackedUserOp(sender: string, signature: string) {
  return {
    sender,
    nonce: 0n,
    initCode: "0x",
    callData: "0x",
    accountGasLimits: ethers.zeroPadValue("0x0001", 32),
    preVerificationGas: 0n,
    gasFees: ethers.zeroPadValue("0x0001", 32),
    paymasterAndData: "0x",
    signature,
  };
}

async function signUserOpHash(hash: string, wallets: Wallet[]): Promise<string> {
  const sigs = await Promise.all(wallets.map((w) => w.signMessage(ethers.getBytes(hash))));
  return "0x" + sigs.map((s) => s.slice(2)).join("");
}

describe("MarmoAccount", function () {
  let factory: MarmoAccountFactory;
  let entryPoint: Signer;
  let shardA: Wallet;
  let shardB: Wallet;
  let shardC: Wallet;
  let account: MarmoAccount;
  let owners: [string, string, string];

  beforeEach(async function () {
    shardA = Wallet.createRandom();
    shardB = Wallet.createRandom();
    shardC = Wallet.createRandom();
    owners = [shardA.address, shardB.address, shardC.address];

    const [deployer] = await ethers.getSigners();
    entryPoint = deployer;

    const Factory = await ethers.getContractFactory("MarmoAccountFactory");
    factory = await Factory.deploy(await entryPoint.getAddress()) as MarmoAccountFactory;

    const tx = await factory.createAccount(owners, 0n);
    await tx.wait();

    const accountAddr = await factory.predictAddress(owners, 0n);
    account = await ethers.getContractAt("MarmoAccount", accountAddr) as MarmoAccount;

    await deployer.sendTransaction({ to: accountAddr, value: ethers.parseEther("1") });
  });

  async function callValidateUserOp(sigs: Wallet[]) {
    const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("test-op-hash"));
    const signature = await signUserOpHash(userOpHash, sigs);
    const userOp = buildPackedUserOp(await account.getAddress(), signature);
    return account.connect(entryPoint).validateUserOp.staticCall(userOp, userOpHash, 0n);
  }

  it("A+B can spend", async function () {
    const result = await callValidateUserOp([shardA, shardB]);
    expect(result).to.equal(0n);
  });

  it("B+C can spend", async function () {
    const result = await callValidateUserOp([shardB, shardC]);
    expect(result).to.equal(0n);
  });

  it("A+C can spend", async function () {
    const result = await callValidateUserOp([shardA, shardC]);
    expect(result).to.equal(0n);
  });

  it("single shard is rejected", async function () {
    const stranger = Wallet.createRandom();
    const result = await callValidateUserOp([shardA, stranger]);
    expect(result).to.equal(1n);
  });

  it("duplicate signer reverts", async function () {
    const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("test-op-hash"));
    const sig = await shardA.signMessage(ethers.getBytes(userOpHash));
    const combined = sig + sig.slice(2);
    const userOp = buildPackedUserOp(await account.getAddress(), combined);
    await expect(
      account.connect(entryPoint).validateUserOp(userOp, userOpHash, 0n)
    ).to.be.revertedWithCustomError(account, "DuplicateSigner");
  });

  it("non-entrypoint reverts", async function () {
    const [, other] = await ethers.getSigners();
    const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const signature = await signUserOpHash(userOpHash, [shardA, shardB]);
    const userOp = buildPackedUserOp(await account.getAddress(), signature);
    await expect(
      account.connect(other).validateUserOp(userOp, userOpHash, 0n)
    ).to.be.revertedWithCustomError(account, "NotEntryPoint");
  });

  it("factory deploys deterministically", async function () {
    const predicted = await factory.predictAddress(owners, 0n);
    expect(await account.getAddress()).to.equal(predicted);

    const tx = await factory.createAccount(owners, 0n);
    await tx.wait();
    expect(await factory.predictAddress(owners, 0n)).to.equal(predicted);
  });

  it("factory deploys different salt to different address", async function () {
    const addr0 = await factory.predictAddress(owners, 0n);
    const addr1 = await factory.predictAddress(owners, 1n);
    expect(addr0).to.not.equal(addr1);
  });
});
