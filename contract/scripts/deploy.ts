import { ethers } from "hardhat";

const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address);

  const Factory = await ethers.getContractFactory("MarmoAccountFactory");
  const factory = await Factory.deploy(ENTRYPOINT_V07);
  await factory.waitForDeployment();

  console.log("MarmoAccountFactory:", await factory.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
