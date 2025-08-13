import { getFullnodeUrl } from "@mysten/sui/client";
import { createNetworkConfig } from "@mysten/dapp-kit";

// Get custom RPC URL from environment variable, fallback to default
const getMainnetRpcUrl = () => {
  const customRpcUrl = process.env.VITE_SUI_RPC_URL;
  if (customRpcUrl && customRpcUrl.trim() !== "") {
    console.log("🔗 Using custom RPC endpoint:", customRpcUrl);
    return customRpcUrl;
  }
  console.log("🔗 Using default Sui mainnet RPC endpoint");
  return getFullnodeUrl("mainnet");
};

const { networkConfig, useNetworkVariable, useNetworkVariables } =
  createNetworkConfig({
    devnet: {
      url: getFullnodeUrl("devnet"),
    },
    testnet: {
      url: getFullnodeUrl("testnet"),
    },
    mainnet: {
      url: getMainnetRpcUrl(),
    },
  });

export { useNetworkVariable, useNetworkVariables, networkConfig };
