import { encodeFunctionData, decodeFunctionResult, parseAbi } from "viem";
import { publicClient, NETWORK } from "./chain.js";
import { resolveToken, listTokens } from "./tokens.js";
export { listTokens };

const QUOTER_V2: Record<string, `0x${string}`> = {
  base: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  "base-sepolia": "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
};

const SWAP_ROUTER: Record<string, `0x${string}`> = {
  base: "0x2626664c2603336E57B271c5C0b26F421741e481",
  "base-sepolia": "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
};

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const ACCOUNT_ABI = parseAbi([
  "function execute(address dest, uint256 value, bytes data) external",
  "function executeBatch(address[] dest, uint256[] values, bytes[] data) external",
]);


export async function quoteExactIn(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  fee?: number;
}): Promise<{ amountOut: bigint; fee: number }> {
  const tokenIn = resolveToken(params.tokenIn === "ETH" ? "WETH" : params.tokenIn);
  const tokenOut = resolveToken(params.tokenOut === "ETH" ? "WETH" : params.tokenOut);
  const fee = params.fee ?? 500;
  const quoter = QUOTER_V2[NETWORK];
  if (!quoter) throw new Error(`quoter not configured for network "${NETWORK}"`);

  const calldata = encodeFunctionData({
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn: params.amountIn, fee, sqrtPriceLimitX96: 0n }],
  });

  const raw = await publicClient.call({ to: quoter, data: calldata });
  if (!raw.data) throw new Error("no data returned from quoter");

  const decoded = decodeFunctionResult({
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    data: raw.data,
  }) as [bigint, bigint, number, bigint];

  return { amountOut: decoded[0], fee };
}

export function buildSwapCalldata(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
  fee: number;
  recipient: `0x${string}`;
}): { callData: `0x${string}`; value: bigint } {
  const isEthIn = params.tokenIn.toUpperCase() === "ETH";
  const tokenIn = resolveToken(isEthIn ? "WETH" : params.tokenIn);
  const tokenOut = resolveToken(params.tokenOut === "ETH" ? "WETH" : params.tokenOut);
  const router = SWAP_ROUTER[NETWORK];
  if (!router) throw new Error(`swap router not configured for network "${NETWORK}"`);

  const swapData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn,
      tokenOut,
      fee: params.fee,
      recipient: params.recipient,
      amountIn: params.amountIn,
      amountOutMinimum: params.amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    }],
  });

  if (isEthIn) {
    return {
      callData: encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: "execute",
        args: [router, params.amountIn, swapData],
      }),
      value: params.amountIn,
    };
  }

  const approveData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [router, params.amountIn],
  });

  return {
    callData: encodeFunctionData({
      abi: ACCOUNT_ABI,
      functionName: "executeBatch",
      args: [[tokenIn, router], [0n, 0n], [approveData, swapData]],
    }),
    value: 0n,
  };
}
