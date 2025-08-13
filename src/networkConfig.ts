import { getFullnodeUrl } from "@mysten/sui/client";
import { createNetworkConfig } from "@mysten/dapp-kit";

// Use Vite's native environment variables (import.meta.env) with fallback to process.env
const rpcUrl = import.meta.env.VITE_SUI_RPC_URL || process.env.VITE_SUI_RPC_URL;
// Remove quotes that JSON.stringify adds in Vite config
const cleanedRpcUrl = rpcUrl ? rpcUrl.replace(/^"(.*)"$/, "$1") : rpcUrl;
const mainnetUrl =
  cleanedRpcUrl && cleanedRpcUrl.trim() !== "" && cleanedRpcUrl !== '""'
    ? cleanedRpcUrl
    : getFullnodeUrl("mainnet");

const { networkConfig, useNetworkVariable, useNetworkVariables } =
  createNetworkConfig({
    devnet: {
      url: getFullnodeUrl("devnet"),
    },
    testnet: {
      url: getFullnodeUrl("testnet"),
    },
    mainnet: {
      url: mainnetUrl,
    },
  });

export { useNetworkVariable, useNetworkVariables, networkConfig };
