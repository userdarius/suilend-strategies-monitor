import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { SuilendClient } from "@suilend/sdk";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import {
  Button,
  Card,
  Container,
  Flex,
  Heading,
  Text,
  TextArea,
  Badge,
} from "@radix-ui/themes";
import { CONTRACTS, TYPES, STRATEGY_TYPES, RESERVE_INDICES } from "./constants";

// Utility functions for decimal formatting
const formatTokenAmount = (
  rawValue: string | number | bigint | any,
  decimals: number = 9,
): string => {
  let value: bigint;

  if (typeof rawValue === "bigint") {
    value = rawValue;
  } else if (typeof rawValue === "string") {
    value = BigInt(rawValue);
  } else if (typeof rawValue === "number") {
    value = BigInt(rawValue);
  } else if (
    rawValue &&
    typeof rawValue === "object" &&
    rawValue.value !== undefined
  ) {
    // Handle Suilend SDK Decimal objects which have a .value property with BigInt
    value = rawValue.value;
  } else if (rawValue && typeof rawValue === "object" && rawValue.toString) {
    // Handle other objects that can be converted to string
    value = BigInt(rawValue.toString());
  } else {
    // Fallback for any other type
    value = BigInt(String(rawValue));
  }

  const divisor = BigInt(10 ** decimals);
  const tokens = Number(value) / Number(divisor);
  return tokens.toFixed(6);
};

export function VaultTest() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  // Vault State
  const [vaultId, setVaultId] = useState<string>("");
  const [managerCapId, setManagerCapId] = useState<string>("");
  const [vaultShareId, setVaultShareId] = useState<string>("");
  const [depositAmount, setDepositAmount] = useState<string>("100000000"); // 0.1 SUI
  const [managementFee, setManagementFee] = useState<string>("100"); // 1%
  const [performanceFee, setPerformanceFee] = useState<string>("1000"); // 10%
  const [vaultData, setVaultData] = useState<any>(null);

  // 3x sSUI/SUI Strategy State
  const [targetLeverage, setTargetLeverage] = useState<string>("3.0");
  const [leverageSteps, setLeverageSteps] = useState<number>(0);
  const [currentLeverage, setCurrentLeverage] = useState<string>("1.0");
  const [ssuiCollateral, setSsuiCollateral] = useState<string>("0");
  const [suiDebt, setSuiDebt] = useState<string>("0");

  const addResult = (message: string) => {
    setResult(
      (prev) => prev + "\n" + new Date().toLocaleTimeString() + ": " + message,
    );
  };

  const executeTransaction = async (tx: Transaction, description: string) => {
    if (!account) {
      addResult("❌ No wallet connected");
      return null;
    }

    setLoading(true);
    addResult(`🔄 ${description}...`);

    return new Promise((resolve, reject) => {
      signAndExecute(
        { transaction: tx as any },
        {
          onSuccess: (result) => {
            addResult(`✅ ${description} successful!`);
            addResult(`Transaction: ${result.digest}`);
            addResult("💡 Use 'Fetch My Objects' to see newly created objects");
            setLoading(false);
            resolve(result);
          },
          onError: (error) => {
            addResult(`❌ ${description} failed: ${error.message}`);
            setLoading(false);
            reject(error);
          },
        },
      );
    });
  };

  // === Vault Functions ===

  const createVault = async () => {
    const tx = new Transaction();
    tx.setGasBudget(50_000_000);

    const [vault, managerCap] = tx.moveCall({
      target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::create_vault`,
      typeArguments: [TYPES.LENDING_MARKET_TYPE],
      arguments: [
        tx.object(CONTRACTS.LENDING_MARKET_ID),
        tx.pure.u8(STRATEGY_TYPES.SUI_LOOPING_SSUI),
        tx.pure.u64(managementFee), // management fee in basis points
        tx.pure.u64(performanceFee), // performance fee in basis points
      ],
    });

    // Transfer vault and manager cap to user
    tx.transferObjects([vault, managerCap], account!.address);

    await executeTransaction(tx, "🏗️ Create Vault");
  };

  const depositToVault = async () => {
    if (!vaultId || !depositAmount) {
      addResult("❌ Need vault ID and deposit amount");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(60_000_000);

    try {
      // Refresh price feeds
      addResult("🔄 Refreshing price feeds...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      await suilendClient.refreshAll(tx, undefined, [TYPES.SUI_COIN_TYPE]);
      addResult("✅ Price feeds refreshed");

      // Split coins for deposit
      const [depositCoin] = tx.splitCoins(tx.gas, [BigInt(depositAmount)]);

      // Deposit to vault
      const vaultShare = tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::deposit`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI),
          depositCoin,
          tx.object(CONTRACTS.CLOCK_ID),
        ],
      });

      tx.transferObjects([vaultShare], account!.address);

      await executeTransaction(
        tx,
        `💰 Deposit ${formatTokenAmount(depositAmount, 9)} SUI to Vault`,
      );
    } catch (error) {
      addResult(`❌ Vault deposit failed: ${error}`);
    }
  };

  const withdrawFromVault = async () => {
    if (!vaultId || !vaultShareId) {
      addResult("❌ Need vault ID and vault share ID");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(60_000_000);

    try {
      // Refresh price feeds
      addResult("🔄 Refreshing price feeds...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      await suilendClient.refreshAll(tx, undefined, [TYPES.SUI_COIN_TYPE]);
      addResult("✅ Price feeds refreshed");

      // Withdraw from vault
      const withdrawnCoins = tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::withdraw`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(vaultShareId),
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI),
          tx.object(CONTRACTS.CLOCK_ID),
        ],
      });

      tx.transferObjects([withdrawnCoins], account!.address);

      await executeTransaction(tx, "💸 Withdraw from Vault");
    } catch (error) {
      addResult(`❌ Vault withdrawal failed: ${error}`);
    }
  };

  const compoundRewards = async () => {
    if (!vaultId) {
      addResult("❌ Need vault ID");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(50_000_000);

    try {
      // Refresh price feeds
      addResult("🔄 Refreshing price feeds...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      await suilendClient.refreshAll(tx, undefined, [TYPES.SUI_COIN_TYPE]);
      addResult("✅ Price feeds refreshed");

      // Compound same-token rewards (permissionless)
      tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::compound_same_token_rewards`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI), // reserve_index
          tx.pure.u64(0), // reward_index
          tx.pure.bool(true), // is_deposit_reward
          tx.object(CONTRACTS.CLOCK_ID),
        ],
      });

      await executeTransaction(tx, "🔄 Compound Same-Token Rewards");
    } catch (error) {
      addResult(`❌ Compound rewards failed: ${error}`);
    }
  };

  const strategyBorrow = async () => {
    if (!vaultId || !managerCapId) {
      addResult("❌ Need vault ID and manager cap ID");
      return;
    }

    const borrowAmount = 10_000; // 0.01 USDC (6 decimals)
    const tx = new Transaction();
    tx.setGasBudget(50_000_000);

    try {
      // Refresh price feeds
      addResult("🔄 Refreshing price feeds...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      await suilendClient.refreshAll(tx, undefined, [
        TYPES.USDC_COIN_TYPE,
        TYPES.SUI_COIN_TYPE,
      ]);
      addResult("✅ Price feeds refreshed");

      // Manager borrows from strategy
      const borrowedCoins = tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::strategy_borrow`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.USDC_COIN_TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(managerCapId),
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.USDC),
          tx.pure.u64(borrowAmount),
          tx.object(CONTRACTS.CLOCK_ID),
        ],
      });

      tx.transferObjects([borrowedCoins], account!.address);

      await executeTransaction(
        tx,
        `🏦 Strategy Borrow ${formatTokenAmount(borrowAmount, 6)} USDC`,
      );
    } catch (error) {
      addResult(`❌ Strategy borrow failed: ${error}`);
    }
  };

  const strategyRepay = async () => {
    if (!vaultId || !managerCapId) {
      addResult("❌ Need vault ID and manager cap ID");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(50_000_000);

    try {
      // Get user's USDC coins to repay with
      const usdcCoins = await suiClient.getOwnedObjects({
        owner: account!.address,
        filter: {
          StructType: `0x2::coin::Coin<${TYPES.USDC_COIN_TYPE}>`,
        },
        options: { showContent: true },
      });

      if (usdcCoins.data.length === 0) {
        addResult("❌ No USDC coins found to repay with");
        return;
      }

      addResult(`💰 Found ${usdcCoins.data.length} USDC coin(s) for repayment`);

      // Use the first USDC coin
      let repayCoins = tx.object(usdcCoins.data[0].data!.objectId!);

      // Merge other coins if multiple
      if (usdcCoins.data.length > 1) {
        const otherCoins = usdcCoins.data
          .slice(1)
          .map((coin) => tx.object(coin.data!.objectId!));
        tx.mergeCoins(repayCoins, otherCoins);
      }

      // Refresh price feeds
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      await suilendClient.refreshAll(tx, undefined, [TYPES.USDC_COIN_TYPE]);

      // Manager repays debt
      tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::strategy_repay`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.USDC_COIN_TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(managerCapId),
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.USDC),
          repayCoins,
          tx.object(CONTRACTS.CLOCK_ID),
        ],
      });

      // Return remaining coins to user
      tx.transferObjects([repayCoins], account!.address);

      await executeTransaction(tx, "💳 Strategy Repay USDC Debt");
    } catch (error) {
      addResult(`❌ Strategy repay failed: ${error}`);
    }
  };

  // === 3x sSUI/SUI Strategy Functions ===

  const buildLeveragePosition = async () => {
    if (!vaultId || !managerCapId || !targetLeverage) {
      addResult("❌ Need vault ID, manager cap ID, and target leverage");
      return;
    }

    const target = parseFloat(targetLeverage);
    if (target < 1 || target > 5) {
      addResult("❌ Target leverage must be between 1x and 5x");
      return;
    }

    addResult(`🎯 Building ${target}x leveraged sSUI/SUI position...`);
    addResult(
      `⚠️ Note: This is a DEMO of leverage building - requires external sSUI conversion`,
    );
    setLeverageSteps(0);

    try {
      // For the demo, we'll focus on the borrowing aspect
      // In practice, you'd need to:
      // 1. Already have sSUI collateral deposited in the vault
      // 2. Use external tools to convert SUI ↔ sSUI

      let currentRatio = 1.0;
      let stepCount = 0;
      const maxSteps = Math.min(Math.floor(target), 5); // Conservative limit

      // Demo leverage cycles - borrow SUI (manager would convert to sSUI externally)
      for (let step = 0; step < maxSteps - 1; step++) {
        stepCount++;
        setLeverageSteps(stepCount);

        addResult(`📋 Step ${stepCount}: Leverage cycle ${stepCount}`);

        // Calculate conservative borrow amount (50% of initial deposit per cycle)
        const borrowAmount = Math.floor(
          parseFloat(depositAmount) * 0.5 * Math.pow(0.7, stepCount - 1),
        );

        if (borrowAmount < 10000000) {
          // Less than 0.01 SUI, stop
          addResult(
            `⏹️ Stopping - borrow amount too small: ${formatTokenAmount(borrowAmount.toString(), 9)} SUI`,
          );
          break;
        }

        addResult(
          `💰 Demo Borrowing ${formatTokenAmount(borrowAmount.toString(), 9)} SUI (Step ${stepCount})`,
        );

        try {
          // Actually attempt to borrow (this will test if we have sufficient collateral)
          await strategyBorrowSUI(borrowAmount.toString());

          addResult(
            `✅ Successfully borrowed ${formatTokenAmount(borrowAmount.toString(), 9)} SUI`,
          );
          addResult(
            `📝 In practice: Convert this SUI to sSUI and deposit as collateral`,
          );

          // Update leverage ratio (estimated)
          currentRatio = 1 + stepCount * 0.5;
          setCurrentLeverage(currentRatio.toFixed(2));

          addResult(
            `📊 Estimated leverage: ${currentRatio.toFixed(2)}x (Target: ${target}x)`,
          );
        } catch (error) {
          addResult(`❌ Borrow failed (Step ${stepCount}): ${error}`);
          addResult(
            `💡 This usually means insufficient collateral or vault not properly initialized`,
          );
          break;
        }

        // Small delay
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      addResult(`📊 Demo completed! Borrowed in ${stepCount} cycles`);
      addResult(`🔍 Check your SUI coins to see borrowed amounts`);
      addResult(`📝 Next steps would be:`);
      addResult(`   1. Convert borrowed SUI to sSUI via liquid staking`);
      addResult(`   2. Deposit sSUI as additional collateral`);
      addResult(`   3. Repeat until target leverage achieved`);
    } catch (error) {
      addResult(`❌ Failed to build leverage position: ${error}`);
    }
  };

  const strategyBorrowSUI = async (borrowAmount: string) => {
    if (!vaultId || !managerCapId) {
      addResult("❌ Need vault ID and manager cap ID");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(50_000_000);

    try {
      // Refresh price feeds
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      await suilendClient.refreshAll(tx, undefined, [TYPES.SUI_COIN_TYPE]);

      // Manager borrows SUI using vault's strategy capability
      const borrowedCoins = tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::strategy_borrow`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(managerCapId),
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI),
          tx.pure.u64(borrowAmount),
          tx.object(CONTRACTS.CLOCK_ID),
        ],
      });

      tx.transferObjects([borrowedCoins], account!.address);

      await executeTransaction(
        tx,
        `🏦 Strategy Borrow ${formatTokenAmount(borrowAmount, 9)} SUI`,
      );

      return borrowedCoins;
    } catch (error) {
      addResult(`❌ Strategy SUI borrow failed: ${error}`);
      throw error;
    }
  };

  const compoundSSUIRewards = async () => {
    if (!vaultId) {
      addResult("❌ Need vault ID");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(50_000_000);

    try {
      // Refresh price feeds for sSUI
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      await suilendClient.refreshAll(tx, undefined, [
        TYPES.SPRING_SUI_COIN_TYPE,
      ]);

      // Compound sSUI staking rewards (permissionless)
      tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::compound_same_token_rewards`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SPRING_SUI_COIN_TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SSUI), // sSUI reserve
          tx.pure.u64(0), // reward_index
          tx.pure.bool(true), // is_deposit_reward
          tx.object(CONTRACTS.CLOCK_ID),
        ],
      });

      await executeTransaction(tx, "🔄 Compound sSUI Staking Rewards");
    } catch (error) {
      addResult(`❌ Compound sSUI rewards failed: ${error}`);
    }
  };

  const explainError = () => {
    addResult("🔍 Understanding the MoveAbort Error:");
    addResult(
      "❌ MoveAbort in obligation::borrow with code 8 typically means:",
    );
    addResult("   1. 💰 Insufficient collateral deposited in the vault");
    addResult("   2. 🏦 Vault obligation not properly initialized");
    addResult("   3. 📊 Trying to borrow more than allowed by LTV ratio");
    addResult("");
    addResult("✅ To fix this, you need to:");
    addResult("   1. 🏗️ Create a vault first");
    addResult("   2. 💰 Deposit SUI into the vault (this creates collateral)");
    addResult("   3. ⏳ Wait for the deposit to settle");
    addResult("   4. 🏦 Then try borrowing operations");
    addResult("");
    addResult("📝 Recommended sequence:");
    addResult(
      "   1. Create Vault → 2. Deposit SUI → 3. Build Leverage Position",
    );
    addResult("");
    addResult(
      "💡 The vault needs SUI collateral before any borrowing can happen!",
    );
  };

  const checkLeveragePosition = async () => {
    if (!vaultId) {
      addResult("❌ Need vault ID to check position");
      return;
    }

    addResult("🔍 Checking current leverage position...");

    try {
      // This would involve querying the obligation to get current collateral and debt amounts
      // For now, we'll mock the data
      const mockSSUICollateral = "2533000000"; // 2.533 sSUI
      const mockSUIDebt = "1533000000"; // 1.533 SUI
      const mockLeverage = "2.53";

      setSsuiCollateral(mockSSUICollateral);
      setSuiDebt(mockSUIDebt);
      setCurrentLeverage(mockLeverage);

      addResult(`📊 Current Position:`);
      addResult(
        `  • sSUI Collateral: ${formatTokenAmount(mockSSUICollateral, 9)} sSUI`,
      );
      addResult(`  • SUI Debt: ${formatTokenAmount(mockSUIDebt, 9)} SUI`);
      addResult(`  • Current Leverage: ${mockLeverage}x`);
      addResult(`  • Target Leverage: ${targetLeverage}x`);

      // Calculate health factor (simplified)
      const healthFactor =
        (parseFloat(formatTokenAmount(mockSSUICollateral, 9)) * 0.8) /
        parseFloat(formatTokenAmount(mockSUIDebt, 9));
      addResult(
        `  • Health Factor: ${healthFactor.toFixed(2)} (${healthFactor > 1.5 ? "✅ Safe" : healthFactor > 1.2 ? "⚠️ Warning" : "🚨 Danger"})`,
      );
    } catch (error) {
      addResult(`❌ Failed to check leverage position: ${error}`);
    }
  };

  // === Utility Functions ===

  const fetchUserObjects = async () => {
    if (!account) {
      addResult("❌ No wallet connected");
      return;
    }

    addResult("🔍 Fetching your vault objects...");

    try {
      // Get vaults
      const vaults = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::Vault`,
        },
        options: { showContent: true, showType: true },
      });

      if (vaults.data.length > 0) {
        addResult(`🏦 Found ${vaults.data.length} Vault(s):`);
        vaults.data.forEach((obj) => {
          addResult(`  • ${obj.data?.objectId}`);
        });

        if (!vaultId && vaults.data[0]?.data?.objectId) {
          setVaultId(vaults.data[0].data.objectId);
          addResult(`📝 Auto-set Vault ID: ${vaults.data[0].data.objectId}`);
        }
      } else {
        addResult("🏦 No Vaults found");
      }

      // Get manager caps
      const managerCaps = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::VaultManagerCap`,
        },
        options: { showContent: true, showType: true },
      });

      if (managerCaps.data.length > 0) {
        addResult(`🔑 Found ${managerCaps.data.length} Manager Cap(s):`);
        managerCaps.data.forEach((obj) => {
          addResult(`  • ${obj.data?.objectId}`);
        });

        if (!managerCapId && managerCaps.data[0]?.data?.objectId) {
          setManagerCapId(managerCaps.data[0].data.objectId);
          addResult(
            `📝 Auto-set Manager Cap ID: ${managerCaps.data[0].data.objectId}`,
          );
        }
      } else {
        addResult("🔑 No Manager Caps found");
      }

      // Get vault shares
      const vaultShares = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::vault::VaultShare`,
        },
        options: { showContent: true, showType: true },
      });

      if (vaultShares.data.length > 0) {
        addResult(`📊 Found ${vaultShares.data.length} Vault Share(s):`);
        vaultShares.data.forEach((obj) => {
          const content = obj.data?.content as any;
          const shares = content?.fields?.shares || "unknown";
          addResult(
            `  • ${obj.data?.objectId} (shares: ${formatTokenAmount(shares, 0)})`,
          );
        });

        if (!vaultShareId && vaultShares.data[0]?.data?.objectId) {
          setVaultShareId(vaultShares.data[0].data.objectId);
          addResult(
            `📝 Auto-set Vault Share ID: ${vaultShares.data[0].data.objectId}`,
          );
        }
      } else {
        addResult("📊 No Vault Shares found");
      }

      // Get SUI coins
      const suiCoins = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `0x2::coin::Coin<${TYPES.SUI_COIN_TYPE}>`,
        },
        options: { showContent: true },
      });

      if (suiCoins.data.length > 0) {
        addResult(`💰 Found ${suiCoins.data.length} SUI coin(s):`);
        let totalBalance = BigInt(0);
        suiCoins.data.slice(0, 3).forEach((obj) => {
          const content = obj.data?.content as any;
          const balance = content?.fields?.balance || "0";
          totalBalance += BigInt(balance);
          addResult(
            `  • ${obj.data?.objectId} (balance: ${formatTokenAmount(balance, 9)} SUI)`,
          );
        });
        addResult(`💰 Total SUI: ${formatTokenAmount(totalBalance, 9)} SUI`);
      } else {
        addResult("💰 No SUI coins found");
      }

      // Get sSUI coins
      const ssuiCoins = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `0x2::coin::Coin<${TYPES.SPRING_SUI_COIN_TYPE}>`,
        },
        options: { showContent: true },
      });

      if (ssuiCoins.data.length > 0) {
        addResult(`🥩 Found ${ssuiCoins.data.length} sSUI coin(s):`);
        let totalSSUIBalance = BigInt(0);
        ssuiCoins.data.slice(0, 3).forEach((obj) => {
          const content = obj.data?.content as any;
          const balance = content?.fields?.balance || "0";
          totalSSUIBalance += BigInt(balance);
          addResult(
            `  • ${obj.data?.objectId} (balance: ${formatTokenAmount(balance, 9)} sSUI)`,
          );
        });
        addResult(
          `🥩 Total sSUI: ${formatTokenAmount(totalSSUIBalance, 9)} sSUI`,
        );
      } else {
        addResult("🥩 No sSUI coins found");
      }
    } catch (error: any) {
      addResult(`❌ Error fetching objects: ${error.message}`);
    }
  };

  const clearResults = () => {
    setResult("");
  };

  const fetchVaultData = async () => {
    if (!vaultId) {
      addResult("❌ No vault ID provided");
      return;
    }

    try {
      addResult("🔍 Fetching vault data...");

      const vaultObj = await suiClient.getObject({
        id: vaultId,
        options: { showContent: true },
      });

      if (!vaultObj.data?.content || !("fields" in vaultObj.data.content)) {
        addResult("❌ Could not read vault object");
        return;
      }

      const fields = vaultObj.data.content.fields as any;
      setVaultData(fields);

      addResult("✅ Vault data fetched successfully!");
      addResult(`🏦 Vault ID: ${vaultId}`);
      addResult(
        `📊 Total Shares: ${formatTokenAmount(fields.total_shares, 0)}`,
      );
      addResult(`🎯 Strategy Type: ${fields.strategy_type}`);
      addResult(`💼 Manager: ${fields.manager}`);
      addResult(
        `📈 Management Fee: ${fields.management_fee_bps} bps (${(Number(fields.management_fee_bps) / 100).toFixed(2)}%)`,
      );
      addResult(
        `🎖️ Performance Fee: ${fields.performance_fee_bps} bps (${(Number(fields.performance_fee_bps) / 100).toFixed(2)}%)`,
      );
      addResult(`⏰ Last Compound: ${fields.last_compound_time}`);
      addResult(
        `💱 Last Total Value: ${formatTokenAmount(fields.last_total_value, 9)}`,
      );
    } catch (error: any) {
      addResult(`❌ Error fetching vault data: ${error.message}`);
      setVaultData(null);
    }
  };

  // === UI Component ===
  if (!account) {
    return (
      <Container>
        <Card>
          <Text>Please connect your wallet to test vault functionality.</Text>
        </Card>
      </Container>
    );
  }

  return (
    <Container>
      <Flex direction="column" gap="4">
        <Heading>🏦 Vault Testing</Heading>
        <Text size="2" color="blue">
          Test vault deposit, withdrawal, compounding, and manager operations
        </Text>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">Account Info</Heading>
            <Text>Address: {account.address}</Text>
            <Flex direction="column" gap="2">
              <Button onClick={fetchUserObjects} disabled={loading}>
                🔍 Fetch My Objects
              </Button>
            </Flex>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">🏗️ Create Vault</Heading>
            <Text size="2" color="gray">
              Create a new vault with management and performance fees
            </Text>

            <Flex gap="2" align="center">
              <Text>Management Fee (bps):</Text>
              <input
                type="text"
                placeholder="100 = 1%"
                value={managementFee}
                onChange={(e) => setManagementFee(e.target.value)}
                style={{
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  width: "100px",
                }}
              />
            </Flex>

            <Flex gap="2" align="center">
              <Text>Performance Fee (bps):</Text>
              <input
                type="text"
                placeholder="1000 = 10%"
                value={performanceFee}
                onChange={(e) => setPerformanceFee(e.target.value)}
                style={{
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  width: "100px",
                }}
              />
            </Flex>

            <Button onClick={createVault} disabled={loading}>
              🏗️ Create Vault
            </Button>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">🏦 Vault Operations</Heading>

            <Flex gap="2" align="center">
              <Text>Vault ID:</Text>
              <Badge variant="outline">{vaultId || "None"}</Badge>
            </Flex>
            <input
              type="text"
              placeholder="Vault Object ID"
              value={vaultId}
              onChange={(e) => setVaultId(e.target.value)}
              style={{
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
              }}
            />

            <Flex gap="2" align="center">
              <Text>Deposit Amount (SUI units):</Text>
              <input
                type="text"
                placeholder="100000000 = 0.1 SUI"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                style={{
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  width: "150px",
                }}
              />
            </Flex>

            <Flex direction="column" gap="2">
              <Button
                onClick={depositToVault}
                disabled={loading || !vaultId}
                style={{ backgroundColor: "#4CAF50" }}
                size="3"
              >
                💰 Deposit to Vault
              </Button>

              <Flex gap="2" align="center">
                <Text>Vault Share ID:</Text>
                <Badge variant="outline">{vaultShareId || "None"}</Badge>
              </Flex>
              <input
                type="text"
                placeholder="Vault Share Object ID"
                value={vaultShareId}
                onChange={(e) => setVaultShareId(e.target.value)}
                style={{
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                }}
              />

              <Button
                onClick={withdrawFromVault}
                disabled={loading || !vaultId || !vaultShareId}
                style={{ backgroundColor: "#FF6B35" }}
                size="3"
              >
                💸 Withdraw from Vault
              </Button>

              <Button
                onClick={compoundRewards}
                disabled={loading || !vaultId}
                style={{ backgroundColor: "#9C27B0" }}
                size="3"
              >
                🔄 Compound Rewards
              </Button>

              <Button
                onClick={fetchVaultData}
                disabled={loading || !vaultId}
                style={{ backgroundColor: "#2196F3" }}
                size="3"
              >
                📊 View Vault Data
              </Button>
            </Flex>

            {vaultData && (
              <Card style={{ marginTop: "12px", backgroundColor: "#f8f9fa" }}>
                <Flex direction="column" gap="2">
                  <Heading size="2">📊 Current Vault Status</Heading>
                  <Text size="1">
                    Total Shares: {formatTokenAmount(vaultData.total_shares, 0)}
                  </Text>
                  <Text size="1">Strategy Type: {vaultData.strategy_type}</Text>
                  <Text size="1">
                    Management Fee: {vaultData.management_fee_bps} bps (
                    {(Number(vaultData.management_fee_bps) / 100).toFixed(2)}%)
                  </Text>
                  <Text size="1">
                    Performance Fee: {vaultData.performance_fee_bps} bps (
                    {(Number(vaultData.performance_fee_bps) / 100).toFixed(2)}%)
                  </Text>
                  <Text size="1">Manager: {vaultData.manager}</Text>
                </Flex>
              </Card>
            )}
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">🚀 3x sSUI/SUI Leveraged Strategy</Heading>
            <Text size="2" color="purple">
              Build a leveraged liquid staking position with auto-compounding
            </Text>

            <Flex gap="2" align="center">
              <Text>Target Leverage:</Text>
              <input
                type="text"
                placeholder="3.0"
                value={targetLeverage}
                onChange={(e) => setTargetLeverage(e.target.value)}
                style={{
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  width: "80px",
                }}
              />
              <Text size="1" color="gray">
                x (1.0 - 5.0)
              </Text>
            </Flex>

            <Flex direction="column" gap="2">
              <Button
                onClick={buildLeveragePosition}
                disabled={loading || !vaultId || !managerCapId}
                style={{ backgroundColor: "#9C27B0", color: "white" }}
                size="3"
              >
                🎯 Build {targetLeverage}x Leverage Position
              </Button>

              <Button
                onClick={checkLeveragePosition}
                disabled={loading || !vaultId}
                style={{ backgroundColor: "#3F51B5" }}
                size="3"
              >
                📊 Check Current Position
              </Button>

              <Button
                onClick={compoundSSUIRewards}
                disabled={loading || !vaultId}
                style={{ backgroundColor: "#4CAF50" }}
                size="3"
              >
                🥩 Compound sSUI Rewards
              </Button>

              <Button
                onClick={explainError}
                disabled={loading}
                style={{ backgroundColor: "#FF9800", color: "white" }}
                size="2"
              >
                ❓ Explain MoveAbort Error
              </Button>
            </Flex>

            {/* Position Status Display */}
            {(currentLeverage !== "1.0" ||
              ssuiCollateral !== "0" ||
              suiDebt !== "0") && (
              <Card style={{ marginTop: "12px", backgroundColor: "#f3e5f5" }}>
                <Flex direction="column" gap="2">
                  <Heading size="2">📊 Current Leverage Position</Heading>
                  <Text size="1">
                    <strong>Current Leverage:</strong> {currentLeverage}x
                    (Target: {targetLeverage}x)
                  </Text>
                  <Text size="1">
                    <strong>sSUI Collateral:</strong>{" "}
                    {formatTokenAmount(ssuiCollateral, 9)} sSUI
                  </Text>
                  <Text size="1">
                    <strong>SUI Debt:</strong> {formatTokenAmount(suiDebt, 9)}{" "}
                    SUI
                  </Text>
                  <Text size="1">
                    <strong>Leverage Steps:</strong> {leverageSteps}
                  </Text>
                  {parseFloat(currentLeverage) > 1.1 && (
                    <Text
                      size="1"
                      color={
                        parseFloat(currentLeverage) >=
                        parseFloat(targetLeverage) * 0.9
                          ? "green"
                          : "orange"
                      }
                    >
                      <strong>Status:</strong>{" "}
                      {parseFloat(currentLeverage) >=
                      parseFloat(targetLeverage) * 0.9
                        ? "✅ Target Reached"
                        : "🔄 Building Position"}
                    </Text>
                  )}
                </Flex>
              </Card>
            )}

            <Card style={{ backgroundColor: "#e8f5e8", padding: "12px" }}>
              <Flex direction="column" gap="2">
                <Text size="2" color="green">
                  <strong>🎯 How 3x sSUI/SUI Strategy Works:</strong>
                </Text>
                <Text size="1">
                  1. <strong>Deposit SUI</strong> → Convert to sSUI (liquid
                  staked SUI)
                  <br />
                  2. <strong>Use sSUI as collateral</strong> → Borrow more SUI
                  <br />
                  3. <strong>Convert borrowed SUI to sSUI</strong> → Repeat
                  cycle
                  <br />
                  4. <strong>Result:</strong> 3x exposure to SUI staking rewards
                  <br />
                  5. <strong>Auto-compound</strong> sSUI staking rewards for
                  maximum yield
                </Text>
                <Text size="1" color="purple">
                  <strong>Benefits:</strong> Higher APY through leverage +
                  liquid staking rewards + lending rewards
                </Text>
              </Flex>
            </Card>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">🔑 Manager Operations</Heading>
            <Text size="2" color="orange">
              These operations require the VaultManagerCap
            </Text>

            <Flex gap="2" align="center">
              <Text>Manager Cap ID:</Text>
              <Badge variant="outline">{managerCapId || "None"}</Badge>
            </Flex>
            <input
              type="text"
              placeholder="Vault Manager Cap Object ID"
              value={managerCapId}
              onChange={(e) => setManagerCapId(e.target.value)}
              style={{
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
              }}
            />

            <Flex gap="2">
              <Button
                onClick={strategyBorrow}
                disabled={loading || !vaultId || !managerCapId}
                style={{ backgroundColor: "#FF5722" }}
              >
                🏦 Strategy Borrow USDC
              </Button>
              <Button
                onClick={strategyRepay}
                disabled={loading || !vaultId || !managerCapId}
                style={{ backgroundColor: "#607D8B" }}
              >
                💳 Strategy Repay USDC
              </Button>
            </Flex>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center">
              <Heading size="3">Transaction Results</Heading>
              <Button variant="outline" onClick={clearResults}>
                🗑️ Clear
              </Button>
            </Flex>
            <TextArea
              value={result}
              readOnly
              rows={15}
              style={{ fontFamily: "monospace", fontSize: "12px" }}
              placeholder="Transaction results will appear here..."
            />
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="2">
            <Heading size="3">📋 Vault Pattern Info</Heading>
            <Text size="2" color="blue">
              <strong>🏦 How vaults work:</strong>
            </Text>
            <Text size="1">
              1. <strong>create_vault</strong> - Creates a vault with underlying
              strategy position
              <br />
              2. <strong>deposit</strong> - Users deposit assets and receive
              proportional vault shares
              <br />
              3. <strong>withdraw</strong> - Users burn shares and withdraw
              proportional underlying assets
              <br />
              4. <strong>compound_rewards</strong> - Anyone can compound
              same-token rewards
              <br />
              5. <strong>strategy_borrow/repay</strong> - Manager can perform
              leveraged operations
              <br />
              <br />
              🚀 <strong>3x sSUI/SUI Strategy:</strong> Leveraged liquid staking
              with auto-compounding
              <br />
              • Converts SUI → sSUI for staking rewards
              <br />
              • Uses sSUI as collateral to borrow more SUI
              <br />
              • Repeats cycle to achieve 3x leverage
              <br />
              • Auto-compounds sSUI staking rewards
              <br />
              <br />
              🔒 <strong>Security:</strong> Only the manager can perform
              strategy operations using VaultManagerCap
            </Text>
            <Text size="1" color="gray">
              <strong>Strategy Wrapper Package:</strong>
              <br />
              {CONTRACTS.STRATEGY_WRAPPER_PACKAGE}
            </Text>
          </Flex>
        </Card>
      </Flex>
    </Container>
  );
}
