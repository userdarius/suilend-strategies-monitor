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

export function StrategyWrapperTest() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  // Hot Potato Pattern State
  const [strategyCapId, setStrategyCapId] = useState<string>("");
  const [wrappedCapId, setWrappedCapId] = useState<string>("");
  const [relayerCapId, setRelayerCapId] = useState<string>("");
  const [relayerAddress, setRelayerAddress] = useState<string>("");
  const [coinToDeposit, setCoinToDeposit] = useState<string>("");
  const [obligationData, setObligationData] = useState<any>(null);

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

  // === Setup Functions ===
  const createStrategyOwnerCap = async () => {
    const tx = new Transaction();

    const [strategyCap] = tx.moveCall({
      target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::create_strategy_owner_cap`,
      typeArguments: [TYPES.LENDING_MARKET_TYPE],
      arguments: [
        tx.object(CONTRACTS.LENDING_MARKET_ID),
        tx.pure.u8(STRATEGY_TYPES.SUI_LOOPING_SSUI),
      ],
    });

    tx.transferObjects([strategyCap], account!.address);

    // Execute the transaction
    await executeTransaction(tx, "🏗️ Create Strategy Owner Cap");
  };

  // === Hot Potato Pattern Functions ===
  const convertToWrappedCap = async () => {
    if (!strategyCapId || !relayerAddress) {
      addResult("❌ Need strategy cap ID and relayer address");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(30_000_000);

    // Convert StrategyOwnerCap to WrappedObligationCap + RelayerCap
    const [wrappedCap, relayerCap] = tx.moveCall({
      target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::convert_to_wrapped_cap`,
      typeArguments: [TYPES.LENDING_MARKET_TYPE],
      arguments: [tx.object(strategyCapId), tx.pure.address(relayerAddress)],
    });

    // Transfer wrapped cap to shared (user keeps it), relayer cap to relayer
    tx.transferObjects([wrappedCap], account!.address);
    tx.transferObjects([relayerCap], relayerAddress);

    // Execute the transaction
    await executeTransaction(tx, "🔄 Convert to Wrapped Cap for Hot Potato");
  };

  const convertBackToStrategyCap = async () => {
    if (!wrappedCapId || !relayerCapId) {
      addResult("❌ Need wrapped cap and relayer cap IDs");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(30_000_000);

    // Convert back to StrategyOwnerCap
    const strategyCap = tx.moveCall({
      target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::convert_back_to_strategy_cap`,
      typeArguments: [TYPES.LENDING_MARKET_TYPE],
      arguments: [tx.object(wrappedCapId), tx.object(relayerCapId)],
    });

    tx.transferObjects([strategyCap], account!.address);

    // Execute the transaction
    await executeTransaction(tx, "🔙 Convert back to Strategy Cap");
  };

  // === Hot Potato Lending Market Operations ===
  const hotPotatoBorrowUSDC = async () => {
    if (!wrappedCapId || !relayerCapId) {
      addResult("❌ Need wrapped cap and relayer cap IDs");
      return;
    }

    const borrowAmount = 50_000; // 0.05 USDC (6 decimals)
    const tx = new Transaction();
    tx.setGasBudget(50_000_000);

    try {
      // STEP 0: Refresh price feeds using SuilendClient
      addResult("🔄 Refreshing price feeds...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      // Refresh prices for USDC (what we're borrowing) and SUI (collateral)
      await suilendClient.refreshAll(tx, undefined, [
        TYPES.USDC_COIN_TYPE,
        TYPES.SUI_COIN_TYPE,
      ]);
      addResult("✅ Price feeds refreshed");

      // STEP 1: Borrow the obligation cap (creates hot potato)
      const [obligationCap, borrowReceipt] = tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::borrow_obligation_cap`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [tx.object(wrappedCapId), tx.object(relayerCapId)],
      });

      // STEP 2: Perform lending market operation - Borrow USDC
      const borrowedCoins = tx.moveCall({
        target: `${CONTRACTS.SUILEND_PACKAGE}::lending_market::borrow`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.USDC_COIN_TYPE],
        arguments: [
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.USDC),
          obligationCap, // Use the borrowed ObligationOwnerCap
          tx.object(CONTRACTS.CLOCK_ID),
          tx.pure.u64(borrowAmount),
        ],
      });

      // STEP 3: Return the obligation cap (consumes hot potato) - MUST happen in same transaction
      tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::return_obligation_cap`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [
          tx.object(wrappedCapId),
          obligationCap, // Return the borrowed cap
          borrowReceipt, // Return the hot potato
        ],
      });

      // Transfer borrowed coins to user
      tx.transferObjects([borrowedCoins], account!.address);

      // Execute the transaction
      await executeTransaction(
        tx,
        `🌶️ Hot Potato: Borrow ${formatTokenAmount(borrowAmount, 6)} USDC`,
      );

      // Auto-refresh obligation data after successful borrow
      if (obligationData) {
        await fetchObligationData();
      }
    } catch (error) {
      addResult(`❌ Hot potato borrow failed: ${error}`);
    }
  };

  const hotPotatoDepositCTokens = async () => {
    if (!wrappedCapId || !relayerCapId || !coinToDeposit) {
      addResult("❌ Need wrapped cap, relayer cap IDs, and coin to deposit");
      return;
    }

    const depositAmount = 20_000_000; // 0.02 SUI
    const tx = new Transaction();
    tx.setGasBudget(60_000_000);

    try {
      // STEP 0: Refresh price feeds using SuilendClient
      addResult("🔄 Refreshing price feeds...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      // Refresh prices for SUI (what we're depositing)
      await suilendClient.refreshAll(tx, undefined, [TYPES.SUI_COIN_TYPE]);
      addResult("✅ Price feeds refreshed");

      // STEP 1: Borrow the obligation cap (creates hot potato)
      const [obligationCap, borrowReceipt] = tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::borrow_obligation_cap`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [tx.object(wrappedCapId), tx.object(relayerCapId)],
      });

      // STEP 2: Mint cTokens and deposit into obligation
      const [depositCoin] = tx.splitCoins(tx.gas, [depositAmount]);

      // Mint cTokens
      const cTokens = tx.moveCall({
        target: `${CONTRACTS.SUILEND_PACKAGE}::lending_market::deposit_liquidity_and_mint_ctokens`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI),
          tx.object(CONTRACTS.CLOCK_ID),
          depositCoin,
        ],
      });

      // Deposit cTokens into obligation
      tx.moveCall({
        target: `${CONTRACTS.SUILEND_PACKAGE}::lending_market::deposit_ctokens_into_obligation`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI),
          obligationCap, // Use the borrowed ObligationOwnerCap
          tx.object(CONTRACTS.CLOCK_ID),
          cTokens,
        ],
      });

      // STEP 3: Return the obligation cap (consumes hot potato)
      tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::return_obligation_cap`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [tx.object(wrappedCapId), obligationCap, borrowReceipt],
      });

      // Execute the transaction
      await executeTransaction(
        tx,
        `🌶️ Hot Potato: Deposit ${formatTokenAmount(depositAmount, 9)} SUI as Collateral`,
      );

      // Auto-refresh obligation data after successful deposit
      if (obligationData) {
        await fetchObligationData();
      }
    } catch (error) {
      addResult(`❌ Hot potato deposit failed: ${error}`);
    }
  };

  const hotPotatoRepayUSDC = async () => {
    if (!wrappedCapId || !relayerCapId) {
      addResult("❌ Need wrapped cap and relayer cap IDs");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(50_000_000);

    try {
      // STEP 0: Check current debt first
      addResult("🔍 Checking current USDC debt...");
      if (obligationData) {
        const usdcBorrow = obligationData.borrows?.find(
          (borrow: any) =>
            Number(borrow.reserveArrayIndex) === RESERVE_INDICES.USDC,
        );

        if (!usdcBorrow) {
          addResult("✅ No USDC debt to repay! You have no USDC borrows.");
          return;
        }

        // The borrowedAmount is a Suilend SDK Decimal object
        // Suilend uses 18 decimals internally, but USDC display uses 6 decimals
        let debtAmount = 0;

        if (
          usdcBorrow.borrowedAmount &&
          typeof usdcBorrow.borrowedAmount === "object"
        ) {
          // If it's a Decimal object with .value property (Suilend internal format)
          if (usdcBorrow.borrowedAmount.value) {
            // Use the correct conversion - divide by 10^24 based on testing
            const internalValue = BigInt(usdcBorrow.borrowedAmount.value);
            debtAmount = Number(internalValue) / 10 ** 24;
          } else {
            // Try formatting the object directly
            debtAmount = Number(
              formatTokenAmount(usdcBorrow.borrowedAmount, 6),
            );
          }
        } else {
          // If it's already a number/string
          debtAmount = Number(formatTokenAmount(usdcBorrow.borrowedAmount, 6));
        }

        addResult(
          `🔍 Debug - Raw borrowed amount: ${JSON.stringify(usdcBorrow.borrowedAmount)}`,
        );
        addResult(`🔍 Debug - Parsed debt amount: ${debtAmount}`);

        if (debtAmount === 0 || debtAmount < 0.000001) {
          // Very small threshold
          addResult(
            "✅ No significant USDC debt to repay! Your debt is effectively 0.",
          );
          return;
        }

        addResult(`💳 Current USDC debt: ${debtAmount.toFixed(6)} USDC`);
      }

      // STEP 1: Refresh price feeds using SuilendClient
      addResult("🔄 Refreshing price feeds...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      // Refresh prices for USDC (what we're repaying)
      await suilendClient.refreshAll(tx, undefined, [TYPES.USDC_COIN_TYPE]);
      addResult("✅ Price feeds refreshed");

      // Get user's USDC coins to repay with
      const usdcCoins = await suiClient.getOwnedObjects({
        owner: account!.address,
        filter: {
          StructType: `0x2::coin::Coin<${TYPES.USDC_COIN_TYPE}>`,
        },
        options: { showContent: true },
      });

      if (usdcCoins.data.length === 0) {
        addResult("❌ No USDC coins found to repay with.");
        addResult("💡 To repay USDC debt, you need USDC coins. Options:");
        addResult("   1. Buy USDC on a DEX (like Cetus)");
        addResult("   2. Transfer USDC to this wallet");
        addResult(
          "   3. If you just borrowed USDC, check if it's in your wallet",
        );
        return;
      }

      // Show USDC coin balances and calculate total
      addResult(
        `💰 Found ${usdcCoins.data.length} USDC coin(s) for repayment:`,
      );
      let totalUSDCBalance = 0;
      usdcCoins.data.slice(0, 5).forEach((coin, index) => {
        const content = coin.data?.content as any;
        const balance = content?.fields?.balance || "0";
        const balanceFormatted = formatTokenAmount(balance, 6);
        const balanceNum = Number(balanceFormatted);
        totalUSDCBalance += balanceNum;
        addResult(`  • Coin ${index + 1}: ${balanceFormatted} USDC`);
      });

      addResult(`💰 Total USDC available: ${totalUSDCBalance.toFixed(6)} USDC`);

      // Check if user has enough USDC to repay
      if (obligationData) {
        const usdcBorrow = obligationData.borrows?.find(
          (borrow: any) =>
            Number(borrow.reserveArrayIndex) === RESERVE_INDICES.USDC,
        );
        if (usdcBorrow) {
          // Use the correct debt calculation - divide by 10^24 based on testing
          const internalValue = BigInt(usdcBorrow.borrowedAmount.value);
          const debtAmount = Number(internalValue) / 10 ** 24;

          if (totalUSDCBalance < debtAmount) {
            addResult(`⚠️  Insufficient USDC to fully repay debt!`);
            addResult(`   Debt: ${debtAmount.toFixed(6)} USDC`);
            addResult(`   Available: ${totalUSDCBalance.toFixed(6)} USDC`);
            addResult(
              `   Shortfall: ${(debtAmount - totalUSDCBalance).toFixed(6)} USDC`,
            );
            addResult(
              `💡 Proceeding anyway - will repay as much as possible...`,
            );
          } else {
            addResult(`✅ Sufficient USDC to repay debt!`);
          }
        }
      }

      // Check if all coins have zero balance
      if (totalUSDCBalance === 0) {
        addResult("❌ All USDC coins have zero balance!");
        addResult("💡 You need to obtain USDC before you can repay the debt.");
        return;
      }

      // Find the USDC coin with the highest balance or merge all coins
      let repayCoins;

      if (usdcCoins.data.length === 1) {
        // Only one coin, use it
        repayCoins = tx.object(usdcCoins.data[0].data!.objectId!);
      } else {
        // Multiple coins - merge them all to consolidate balance
        addResult(
          `🔄 Merging ${usdcCoins.data.length} USDC coins to consolidate balance...`,
        );

        // Start with the first coin
        repayCoins = tx.object(usdcCoins.data[0].data!.objectId!);

        // Merge all other coins into the first one
        const otherCoins = usdcCoins.data
          .slice(1)
          .map((coin) => tx.object(coin.data!.objectId!));
        if (otherCoins.length > 0) {
          tx.mergeCoins(repayCoins, otherCoins);
          addResult(`✅ Merged ${otherCoins.length} additional USDC coins`);
        }
      }

      // STEP 2: Borrow the obligation cap (creates hot potato)
      const [obligationCap, borrowReceipt] = tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::borrow_obligation_cap`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [tx.object(wrappedCapId), tx.object(relayerCapId)],
      });

      // STEP 3: Get the obligation ID from the cap for the repay function
      const obligationId = tx.moveCall({
        target: `${CONTRACTS.SUILEND_PACKAGE}::lending_market::obligation_id`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [obligationCap],
      });

      // STEP 4: Perform repay operation
      tx.moveCall({
        target: `${CONTRACTS.SUILEND_PACKAGE}::lending_market::repay`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.USDC_COIN_TYPE],
        arguments: [
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.USDC),
          obligationId, // Use the obligation ID (not the cap itself)
          tx.object(CONTRACTS.CLOCK_ID),
          repayCoins, // Pass the USDC coins as mutable reference
        ],
      });

      // STEP 5: Return the obligation cap (consumes hot potato)
      tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::return_obligation_cap`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [tx.object(wrappedCapId), obligationCap, borrowReceipt],
      });

      // Any remaining repay coins stay with the user
      tx.transferObjects([repayCoins], account!.address);

      // Execute the transaction
      await executeTransaction(tx, `🌶️ Hot Potato: Repay USDC Debt`);

      // Auto-refresh obligation data after successful repay
      if (obligationData) {
        await fetchObligationData();
      }
    } catch (error) {
      addResult(`❌ Hot potato repay failed: ${error}`);
    }
  };

  const hotPotatoWithdrawCTokens = async () => {
    if (!wrappedCapId || !relayerCapId) {
      addResult("❌ Need wrapped cap and relayer cap IDs");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(60_000_000);

    try {
      // STEP 0: Refresh obligation data to get latest info
      addResult("🔄 Refreshing obligation data...");
      await fetchObligationData();

      // STEP 1: Check current SUI deposits and calculate safe withdrawal amount
      if (!obligationData || !obligationData.deposits) {
        addResult("❌ No obligation data found!");
        return;
      }

      const suiDeposit = obligationData.deposits.find(
        (deposit: any) =>
          Number(deposit.reserveArrayIndex) === RESERVE_INDICES.SUI,
      );

      if (!suiDeposit) {
        addResult("❌ No SUI deposits found to withdraw!");
        addResult("💡 You need to deposit SUI collateral first.");
        return;
      }

      const totalDeposited = Number(
        formatTokenAmount(suiDeposit.depositedCtokenAmount, 9),
      );

      // Withdraw a small safe amount (10% of deposits, minimum 0.001 SUI worth)
      const safeWithdrawAmount = Math.floor(totalDeposited * 0.1 * 10 ** 9);
      const withdrawAmount = Math.max(safeWithdrawAmount, 1_000_000); // Minimum 0.001 SUI worth

      addResult(`💰 Current SUI deposit: ${totalDeposited.toFixed(6)} cTokens`);
      addResult(
        `🔐 Safe withdrawal amount: ${formatTokenAmount(withdrawAmount, 9)} cTokens (10% of deposits)`,
      );

      // Check if there's any debt that could cause liquidation risk
      if (obligationData.borrows && obligationData.borrows.length > 0) {
        addResult(
          "⚠️  You have outstanding debt - withdrawal will reduce your collateral!",
        );
        obligationData.borrows.forEach((borrow: any) => {
          const reserveIndex = Number(borrow.reserveArrayIndex);
          const coinType =
            reserveIndex === RESERVE_INDICES.USDC
              ? "USDC"
              : `Reserve ${reserveIndex}`;
          if (
            reserveIndex === RESERVE_INDICES.USDC &&
            borrow.borrowedAmount.value
          ) {
            const debtAmount =
              Number(BigInt(borrow.borrowedAmount.value)) / 10 ** 24;
            addResult(`   • ${coinType} debt: ${debtAmount.toFixed(6)}`);
          }
        });
        addResult(
          "💡 Make sure you maintain sufficient collateral to avoid liquidation!",
        );
      }

      // STEP 2: Refresh price feeds using SuilendClient
      addResult("🔄 Refreshing price feeds...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      await suilendClient.refreshAll(tx, undefined, [TYPES.SUI_COIN_TYPE]);
      addResult("✅ Price feeds refreshed");

      // STEP 3: Borrow the obligation cap (creates hot potato)
      const [obligationCap, borrowReceipt] = tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::borrow_obligation_cap`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [tx.object(wrappedCapId), tx.object(relayerCapId)],
      });

      // STEP 4: Withdraw cTokens from obligation
      const cTokens = tx.moveCall({
        target: `${CONTRACTS.SUILEND_PACKAGE}::lending_market::withdraw_ctokens`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI),
          obligationCap, // Use the borrowed ObligationOwnerCap
          tx.object(CONTRACTS.CLOCK_ID),
          tx.pure.u64(withdrawAmount),
        ],
      });

      // STEP 5: Return the obligation cap (consumes hot potato)
      tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::return_obligation_cap`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [tx.object(wrappedCapId), obligationCap, borrowReceipt],
      });

      // STEP 6: Transfer cTokens to user's wallet
      tx.transferObjects([cTokens], account!.address);

      // Execute the transaction
      await executeTransaction(
        tx,
        `🌶️ Hot Potato: Withdraw ${formatTokenAmount(withdrawAmount, 9)} SUI cTokens`,
      );

      addResult(
        `✅ Successfully withdrew ${formatTokenAmount(withdrawAmount, 9)} cTokens!`,
      );
      addResult(`💰 SUI cTokens are now in your wallet - ready to redeem!`);
      addResult(
        `💡 Now you can click "🔄 Redeem cTokens → SUI" to convert them to SUI.`,
      );

      // Auto-refresh obligation data after successful withdraw
      if (obligationData) {
        await fetchObligationData();
      }
    } catch (error) {
      addResult(`❌ Hot potato withdraw failed: ${error}`);
    }
  };

  const testRedeemCTokens = async () => {
    if (!account) {
      addResult("❌ No wallet connected");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(30_000_000);

    try {
      // STEP 1: Find user's SUI cTokens
      addResult("🔍 Looking for SUI cTokens in your wallet...");

      let cTokenObjects = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `0x2::coin::Coin<${CONTRACTS.SUILEND_PACKAGE}::reserve::CToken<${TYPES.LENDING_MARKET_TYPE}, ${TYPES.SUI_COIN_TYPE}>>`,
        },
        options: { showContent: true },
      });

      // If exact type doesn't work, try broader search
      if (cTokenObjects.data.length === 0) {
        addResult("🔍 Trying broader search for cTokens...");

        const allObjects = await suiClient.getOwnedObjects({
          owner: account.address,
          options: { showContent: true, showType: true },
        });

        // Filter for objects that contain "CToken" and "SUI" in their type
        cTokenObjects.data = allObjects.data.filter((obj: any) => {
          const type = obj.data?.type;
          return (
            type &&
            type.includes("CToken") &&
            type.includes("SUI") &&
            type.includes("Coin")
          );
        });

        addResult(
          `🔍 Found ${cTokenObjects.data.length} potential cToken objects`,
        );

        // Debug: show what we found
        cTokenObjects.data.forEach((obj, index) => {
          addResult(`  • Object ${index + 1}: ${obj.data?.type}`);
        });
      }

      if (cTokenObjects.data.length === 0) {
        addResult("❌ No SUI cTokens found in your wallet!");
        addResult(
          "💡 You need to have SUI cTokens to redeem. Try withdrawing some first.",
        );

        // Additional debugging - show all coin-like objects
        addResult("🔍 Debugging: Looking for any coin objects...");
        const allCoins = await suiClient.getOwnedObjects({
          owner: account.address,
          filter: { MatchAny: [{ StructType: "0x2::coin::Coin" }] },
          options: { showContent: true, showType: true },
        });

        addResult(`📊 Found ${allCoins.data.length} total coin objects:`);
        allCoins.data.slice(0, 10).forEach((obj, index) => {
          addResult(`  • Coin ${index + 1}: ${obj.data?.type}`);
        });

        return;
      }

      addResult(`💰 Found ${cTokenObjects.data.length} SUI cToken object(s):`);

      let totalCTokens = 0;
      cTokenObjects.data.forEach((obj, index) => {
        const content = obj.data?.content as any;
        const balance = content?.fields?.balance || "0";
        const balanceFormatted = formatTokenAmount(balance, 9);
        const balanceNum = Number(balanceFormatted);
        totalCTokens += balanceNum;
        addResult(`  • cToken ${index + 1}: ${balanceFormatted} cTokens`);
      });

      addResult(
        `💰 Total SUI cTokens available: ${totalCTokens.toFixed(6)} cTokens`,
      );

      if (totalCTokens === 0) {
        addResult("❌ All SUI cToken objects have zero balance!");
        return;
      }

      // STEP 2: Use the first cToken object for redemption
      const firstCToken = tx.object(cTokenObjects.data[0].data!.objectId!);

      // STEP 3: Merge all cTokens if there are multiple
      if (cTokenObjects.data.length > 1) {
        addResult(`🔄 Merging ${cTokenObjects.data.length} cToken objects...`);
        const otherCTokens = cTokenObjects.data
          .slice(1)
          .map((obj) => tx.object(obj.data!.objectId!));
        tx.mergeCoins(firstCToken, otherCTokens);
        addResult(`✅ Merged ${otherCTokens.length} additional cToken objects`);
      }

      // STEP 4: Redeem cTokens for SUI
      addResult("🔄 Redeeming cTokens for SUI...");

      const suiCoins = tx.moveCall({
        target: `${CONTRACTS.SUILEND_PACKAGE}::lending_market::redeem_ctokens_and_withdraw_liquidity`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI),
          tx.object(CONTRACTS.CLOCK_ID),
          firstCToken, // The merged cToken object
          tx.pure.vector("u8", [0]), // BCS encoded Option::none() - single 0 byte means none
        ],
      });

      // STEP 5: Transfer redeemed SUI to user
      tx.transferObjects([suiCoins], account.address);

      // Execute the transaction
      await executeTransaction(
        tx,
        `🔄 Redeem ${totalCTokens.toFixed(6)} SUI cTokens → SUI`,
      );

      addResult(
        `✅ Successfully redeemed ${totalCTokens.toFixed(6)} cTokens for SUI!`,
      );
      addResult(`💰 SUI coins have been transferred to your wallet.`);
    } catch (error) {
      addResult(`❌ Redeem cTokens failed: ${error}`);
    }
  };

  // === Utility Functions ===
  const fetchUserObjects = async () => {
    if (!account) {
      addResult("❌ No wallet connected");
      return;
    }

    addResult("🔍 Fetching your objects...");

    try {
      // Get strategy caps
      const strategyCaps = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::StrategyOwnerCap`,
        },
        options: { showContent: true, showType: true },
      });

      if (strategyCaps.data.length > 0) {
        addResult(
          `📦 Found ${strategyCaps.data.length} Strategy Owner Cap(s):`,
        );
        strategyCaps.data.forEach((obj) => {
          addResult(`  • ${obj.data?.objectId}`);
        });

        // Auto-set the first strategy cap ID if none is set
        if (!strategyCapId && strategyCaps.data[0]?.data?.objectId) {
          setStrategyCapId(strategyCaps.data[0].data.objectId);
          addResult(
            `📝 Auto-set Strategy Cap ID: ${strategyCaps.data[0].data.objectId}`,
          );
        }
      } else {
        addResult("📦 No Strategy Owner Caps found");
      }

      // Get wrapped obligation caps
      const wrappedCaps = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::WrappedObligationCap`,
        },
        options: { showContent: true, showType: true },
      });

      if (wrappedCaps.data.length > 0) {
        addResult(
          `🌶️ Found ${wrappedCaps.data.length} Wrapped Obligation Cap(s):`,
        );
        wrappedCaps.data.forEach((obj) => {
          addResult(`  • ${obj.data?.objectId}`);
        });

        // Auto-set the first wrapped cap ID if none is set
        if (!wrappedCapId && wrappedCaps.data[0]?.data?.objectId) {
          setWrappedCapId(wrappedCaps.data[0].data.objectId);
          addResult(
            `📝 Auto-set Wrapped Cap ID: ${wrappedCaps.data[0].data.objectId}`,
          );
        }
      } else {
        addResult("🌶️ No Wrapped Obligation Caps found");
      }

      // Get relayer caps
      const relayerCaps = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::RelayerCap`,
        },
        options: { showContent: true, showType: true },
      });

      if (relayerCaps.data.length > 0) {
        addResult(`🔑 Found ${relayerCaps.data.length} Relayer Cap(s):`);
        relayerCaps.data.forEach((obj) => {
          addResult(`  • ${obj.data?.objectId}`);
        });

        // Auto-set the first relayer cap ID if none is set
        if (!relayerCapId && relayerCaps.data[0]?.data?.objectId) {
          setRelayerCapId(relayerCaps.data[0].data.objectId);
          addResult(
            `📝 Auto-set Relayer Cap ID: ${relayerCaps.data[0].data.objectId}`,
          );
        }
      } else {
        addResult("🔑 No Relayer Caps found");
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
        suiCoins.data.slice(0, 3).forEach((obj) => {
          const content = obj.data?.content as any;
          const balance = content?.fields?.balance || "unknown";
          addResult(
            `  • ${obj.data?.objectId} (balance: ${formatTokenAmount(balance, 9)} SUI)`,
          );
        });

        // Auto-set first coin for deposit if none is set
        if (!coinToDeposit && suiCoins.data[0]?.data?.objectId) {
          setCoinToDeposit(suiCoins.data[0].data.objectId);
          addResult(`📝 Auto-set Coin ID: ${suiCoins.data[0].data.objectId}`);
        }
      } else {
        addResult("💰 No SUI coins found");
      }

      // Auto-set relayer address to current user if not set
      if (!relayerAddress) {
        setRelayerAddress(account.address);
        addResult(`📝 Auto-set Relayer Address: ${account.address}`);
      }
    } catch (error: any) {
      addResult(`❌ Error fetching objects: ${error.message}`);
    }
  };

  const clearResults = () => {
    setResult("");
  };

  const checkWrappedCapState = async () => {
    if (!wrappedCapId) {
      addResult("❌ No wrapped cap ID provided");
      return;
    }

    try {
      addResult("🔍 Checking wrapped cap state...");

      // Check if wrapped cap is borrowed using the view function
      const tx = new Transaction();
      tx.moveCall({
        target: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::wrapped_cap_is_borrowed`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE],
        arguments: [tx.object(wrappedCapId)],
      });

      const isBorrowed = await suiClient.devInspectTransactionBlock({
        transactionBlock: tx as any,
        sender: account?.address || "0x1",
      });

      const borrowedStatus = isBorrowed.results?.[0]?.returnValues?.[0];
      // borrowedStatus is typically [0] for false, [1] for true in Move bool return values
      const isBorrowedBool =
        borrowedStatus &&
        Array.isArray(borrowedStatus) &&
        borrowedStatus.length > 0 &&
        (borrowedStatus[0] as any) === 1;

      if (isBorrowedBool) {
        addResult(
          "🚨 Wrapped cap is currently BORROWED - obligation cap is not available",
        );
        addResult(
          "💡 This means a previous hot potato operation didn't complete properly",
        );
        addResult(
          "🔧 You may need to manually return the obligation cap or wait for it to timeout",
        );
      } else {
        addResult(
          "✅ Wrapped cap is available - obligation cap can be borrowed",
        );
      }
    } catch (error) {
      addResult(`❌ Error checking wrapped cap state: ${error}`);
    }
  };

  const testSimpleDeposit = async () => {
    if (!account) {
      addResult("❌ No wallet connected");
      return;
    }

    const tx = new Transaction();
    tx.setGasBudget(30_000_000);

    try {
      // Simple deposit WITHOUT hot potato - just direct lending market call
      const depositAmount = 20_000_000; // 0.02 SUI
      const [depositCoin] = tx.splitCoins(tx.gas, [depositAmount]);

      const cTokens = tx.moveCall({
        target: `${CONTRACTS.SUILEND_PACKAGE}::lending_market::deposit_liquidity_and_mint_ctokens`,
        typeArguments: [TYPES.LENDING_MARKET_TYPE, TYPES.SUI_COIN_TYPE],
        arguments: [
          tx.object(CONTRACTS.LENDING_MARKET_ID),
          tx.pure.u64(RESERVE_INDICES.SUI),
          tx.object(CONTRACTS.CLOCK_ID),
          depositCoin,
        ],
      });

      tx.transferObjects([cTokens], account.address);

      // Execute the transaction
      await executeTransaction(
        tx,
        `🧪 Simple Deposit: ${formatTokenAmount(depositAmount, 9)} SUI (Direct to Lending Market)`,
      );

      addResult(
        "✅ Simple deposit worked! Issue is likely in hot potato pattern, not lending market",
      );
    } catch (error) {
      addResult(`❌ Simple deposit failed: ${error}`);
      addResult(
        "This suggests the issue is in the lending market setup itself",
      );
    }
  };

  const checkLendingMarketVersion = async () => {
    try {
      addResult("🔍 Checking lending market version...");

      const lendingMarketObj = await suiClient.getObject({
        id: CONTRACTS.LENDING_MARKET_ID,
        options: { showContent: true },
      });

      if (
        lendingMarketObj.data?.content &&
        "fields" in lendingMarketObj.data.content
      ) {
        const fields = lendingMarketObj.data.content.fields as any;
        const version = fields.version;
        const expectedVersion = 7; // CURRENT_VERSION from contract

        addResult(`📊 Lending Market Version: ${version}`);
        addResult(`📊 Expected Version: ${expectedVersion}`);

        if (version === expectedVersion) {
          addResult("✅ Version check passed!");
        } else {
          addResult(
            "❌ Version mismatch! This will cause EIncorrectVersion (abort code 1)",
          );
          addResult(
            "💡 You need to use a lending market with the correct version",
          );
        }
      } else {
        addResult("❌ Could not read lending market object");
      }
    } catch (error: any) {
      addResult(`❌ Error checking version: ${error.message}`);
    }
  };

  const fetchObligationData = async () => {
    if (!wrappedCapId) {
      addResult("❌ No wrapped cap ID provided");
      return;
    }

    try {
      addResult("🔍 Fetching obligation data...");

      // Get the wrapped obligation cap object to find the obligation ID
      const wrappedCapObj = await suiClient.getObject({
        id: wrappedCapId,
        options: { showContent: true },
      });

      if (
        !wrappedCapObj.data?.content ||
        !("fields" in wrappedCapObj.data.content)
      ) {
        addResult("❌ Could not read wrapped cap object");
        return;
      }

      const fields = wrappedCapObj.data.content.fields as any;

      // The obligation_id is stored in the inner_cap's fields
      let obligationId = null;

      if (fields.inner_cap) {
        obligationId = fields.inner_cap.fields.obligation_id;
        addResult(`📋 Obligation ID: ${obligationId}`);
      } else {
        // inner_cap is None - cap is currently borrowed
        addResult(
          "⚠️ Inner cap is currently borrowed (None) - cannot access obligation ID",
        );
        addResult("💡 Try again when the hot potato operation is complete");
        return;
      }

      // Initialize SuilendClient to get obligation data
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      // Get obligation data
      const obligation = await suilendClient.getObligation(obligationId);
      setObligationData(obligation);

      addResult("✅ Obligation data fetched successfully!");

      // Display deposits
      if (obligation.deposits && obligation.deposits.length > 0) {
        addResult("💰 DEPOSITS:");
        obligation.deposits.forEach((deposit: any) => {
          const reserveIndex = Number(deposit.reserveArrayIndex);
          const amount = deposit.depositedCtokenAmount;
          const coinType =
            reserveIndex === RESERVE_INDICES.SUI
              ? "SUI"
              : reserveIndex === RESERVE_INDICES.USDC
                ? "USDC"
                : `Reserve ${reserveIndex}`;
          addResult(`  • ${coinType}: ${formatTokenAmount(amount, 9)} cTokens`);
        });
      } else {
        addResult("💰 DEPOSITS: None");
      }

      // Display borrows
      if (obligation.borrows && obligation.borrows.length > 0) {
        addResult("📈 BORROWS:");
        obligation.borrows.forEach((borrow: any) => {
          const reserveIndex = Number(borrow.reserveArrayIndex);
          const amount = borrow.borrowedAmount;
          const coinType =
            reserveIndex === RESERVE_INDICES.SUI
              ? "SUI"
              : reserveIndex === RESERVE_INDICES.USDC
                ? "USDC"
                : `Reserve ${reserveIndex}`;

          let displayAmount;
          if (reserveIndex === RESERVE_INDICES.USDC && amount && amount.value) {
            // Special handling for USDC - use correct conversion (divide by 10^24)
            const internalValue = BigInt(amount.value);
            displayAmount = (Number(internalValue) / 10 ** 24).toFixed(6);
          } else {
            // For other coins, use normal formatting
            const decimals = reserveIndex === RESERVE_INDICES.USDC ? 6 : 9;
            displayAmount = formatTokenAmount(amount, decimals);
          }

          addResult(`  • ${coinType}: ${displayAmount} borrowed`);
        });
      } else {
        addResult("📈 BORROWS: None");
      }
    } catch (error: any) {
      addResult(`❌ Error fetching obligation data: ${error.message}`);
      setObligationData(null);
    }
  };

  // === UI Component ===
  if (!account) {
    return (
      <Container>
        <Card>
          <Text>
            Please connect your wallet to test hot potato functionality.
          </Text>
        </Card>
      </Container>
    );
  }

  return (
    <Container>
      <Flex direction="column" gap="4">
        <Heading>🌶️ Hot Potato Pattern Testing</Heading>
        <Text size="2" color="orange">
          Test secure temporary access to ObligationOwnerCap for automated
          strategies
        </Text>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">Account Info</Heading>
            <Text>Address: {account.address}</Text>
            <Flex direction="column" gap="2">
              <Flex gap="2">
                <Button onClick={fetchUserObjects} disabled={loading}>
                  🔍 Fetch My Objects
                </Button>
                <Button
                  onClick={checkLendingMarketVersion}
                  disabled={loading}
                  variant="outline"
                >
                  📊 Check Market Version
                </Button>
              </Flex>
              <Button
                onClick={testSimpleDeposit}
                disabled={loading}
                style={{ backgroundColor: "#2196F3" }}
                size="3"
              >
                🧪 Test Simple Deposit (No Hot Potato)
              </Button>
              <Text size="1" color="blue">
                ↑ This tests the lending market directly to isolate the issue
              </Text>
            </Flex>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">🏗️ Setup: Create Strategy Cap</Heading>
            <Text size="2" color="gray">
              Start here: Create a StrategyOwnerCap for testing
            </Text>
            <Flex gap="2" align="center">
              <Text>Strategy Cap ID:</Text>
              <Badge variant="outline">{strategyCapId || "None"}</Badge>
            </Flex>
            <input
              type="text"
              placeholder="Strategy Cap Object ID"
              value={strategyCapId}
              onChange={(e) => setStrategyCapId(e.target.value)}
              style={{
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
              }}
            />
            <Button onClick={createStrategyOwnerCap} disabled={loading}>
              🏗️ Create Strategy Owner Cap
            </Button>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">🔄 Phase 1: Convert to Hot Potato Setup</Heading>
            <Text size="2" color="blue">
              Convert StrategyOwnerCap → WrappedObligationCap + RelayerCap
            </Text>

            <Flex gap="2" align="center">
              <Text>Relayer Address:</Text>
              <input
                type="text"
                placeholder="Backend relayer address"
                value={relayerAddress}
                onChange={(e) => setRelayerAddress(e.target.value)}
                style={{
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  flex: 1,
                  fontSize: "12px",
                }}
              />
            </Flex>

            <Flex gap="2" align="center">
              <Text>Wrapped Cap ID:</Text>
              <Badge variant="outline">{wrappedCapId || "None"}</Badge>
            </Flex>
            <input
              type="text"
              placeholder="Wrapped Obligation Cap Object ID"
              value={wrappedCapId}
              onChange={(e) => setWrappedCapId(e.target.value)}
              style={{
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
              }}
            />

            <Flex gap="2" align="center">
              <Text>Relayer Cap ID:</Text>
              <Badge variant="outline">{relayerCapId || "None"}</Badge>
            </Flex>
            <input
              type="text"
              placeholder="Relayer Cap Object ID"
              value={relayerCapId}
              onChange={(e) => setRelayerCapId(e.target.value)}
              style={{
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
              }}
            />

            <Flex gap="2">
              <Button
                onClick={convertToWrappedCap}
                disabled={loading || !strategyCapId || !relayerAddress}
                style={{ backgroundColor: "#FF6B35" }}
              >
                🔄 Convert to Wrapped Cap
              </Button>
              <Button
                onClick={convertBackToStrategyCap}
                disabled={loading || !wrappedCapId || !relayerCapId}
                variant="outline"
              >
                🔙 Convert Back to Strategy Cap
              </Button>
            </Flex>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Heading size="3">🌶️ Phase 2: Hot Potato Operations</Heading>
            <Text size="2" color="green">
              These operations use the hot potato pattern to temporarily access
              ObligationOwnerCap
            </Text>
            <Text size="1" color="blue">
              💡 Each operation executes directly on the blockchain
            </Text>

            <Flex gap="2" align="center">
              <Text>Coin to Use:</Text>
              <Badge variant="outline">{coinToDeposit || "None"}</Badge>
            </Flex>
            <input
              type="text"
              placeholder="SUI Coin Object ID for deposits"
              value={coinToDeposit}
              onChange={(e) => setCoinToDeposit(e.target.value)}
              style={{
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
              }}
            />

            <Flex direction="column" gap="2">
              <Button
                onClick={hotPotatoDepositCTokens}
                disabled={loading || !wrappedCapId || !relayerCapId}
                style={{ backgroundColor: "#4CAF50" }}
                size="3"
              >
                🌶️ Hot Potato: Deposit SUI as Collateral
              </Button>

              <Flex gap="2">
                <Button
                  onClick={hotPotatoBorrowUSDC}
                  disabled={loading || !wrappedCapId || !relayerCapId}
                  style={{ backgroundColor: "#FF6B35" }}
                >
                  🌶️ Hot Potato: Borrow USDC
                </Button>
                <Button
                  onClick={hotPotatoRepayUSDC}
                  disabled={loading || !wrappedCapId || !relayerCapId}
                  style={{ backgroundColor: "#F44336" }}
                >
                  🌶️ Hot Potato: Repay USDC
                </Button>
                <Button
                  onClick={hotPotatoWithdrawCTokens}
                  disabled={loading || !wrappedCapId || !relayerCapId}
                  style={{ backgroundColor: "#9C27B0" }}
                >
                  🌶️ Hot Potato: Withdraw cTokens
                </Button>
                <Button
                  onClick={checkWrappedCapState}
                  disabled={loading || !wrappedCapId}
                  style={{ backgroundColor: "#FFC107" }}
                  size="2"
                >
                  🔍 Check State
                </Button>
              </Flex>

              <Flex gap="2" style={{ marginTop: "8px" }}>
                <Button
                  onClick={fetchObligationData}
                  disabled={loading || !wrappedCapId}
                  style={{ backgroundColor: "#2196F3" }}
                  size="3"
                >
                  📊 View My Obligation Data
                </Button>
                <Button
                  onClick={testRedeemCTokens}
                  disabled={loading}
                  style={{ backgroundColor: "#607D8B" }}
                  size="3"
                >
                  🔄 Redeem cTokens → SUI
                </Button>
              </Flex>
              <Text size="1" color="blue">
                ↑ Shows your deposits (collateral) and borrows (debt). Refresh
                this before repaying to check current debt!
              </Text>
              <Text size="1" color="gray">
                ↑ The redeem function converts any SUI cTokens in your wallet
                back to actual SUI tokens.
              </Text>

              {obligationData && (
                <Card style={{ marginTop: "12px", backgroundColor: "#f8f9fa" }}>
                  <Flex direction="column" gap="2">
                    <Heading size="2">📊 Current Obligation Status</Heading>

                    <Text size="2" weight="bold" color="green">
                      💰 Deposits (Collateral):
                    </Text>
                    {obligationData.deposits &&
                    obligationData.deposits.length > 0 ? (
                      obligationData.deposits.map(
                        (deposit: any, index: number) => {
                          const reserveIndex = Number(
                            deposit.reserveArrayIndex,
                          );
                          const amount = deposit.depositedCtokenAmount;
                          const coinType =
                            reserveIndex === RESERVE_INDICES.SUI
                              ? "SUI"
                              : reserveIndex === RESERVE_INDICES.USDC
                                ? "USDC"
                                : `Reserve ${reserveIndex}`;
                          return (
                            <Text
                              key={index}
                              size="1"
                              style={{ marginLeft: "16px" }}
                            >
                              • {coinType}: {formatTokenAmount(amount, 9)}{" "}
                              cTokens
                            </Text>
                          );
                        },
                      )
                    ) : (
                      <Text
                        size="1"
                        color="gray"
                        style={{ marginLeft: "16px" }}
                      >
                        No deposits
                      </Text>
                    )}

                    <Text size="2" weight="bold" color="orange">
                      📈 Borrows (Debt):
                    </Text>
                    {obligationData.borrows &&
                    obligationData.borrows.length > 0 ? (
                      obligationData.borrows.map(
                        (borrow: any, index: number) => {
                          const reserveIndex = Number(borrow.reserveArrayIndex);
                          const amount = borrow.borrowedAmount;
                          const coinType =
                            reserveIndex === RESERVE_INDICES.SUI
                              ? "SUI"
                              : reserveIndex === RESERVE_INDICES.USDC
                                ? "USDC"
                                : `Reserve ${reserveIndex}`;

                          let displayAmount;
                          if (
                            reserveIndex === RESERVE_INDICES.USDC &&
                            amount &&
                            amount.value
                          ) {
                            // Special handling for USDC - use correct conversion (divide by 10^24)
                            const internalValue = BigInt(amount.value);
                            displayAmount = (
                              Number(internalValue) /
                              10 ** 24
                            ).toFixed(6);
                          } else {
                            // For other coins, use normal formatting
                            const decimals =
                              reserveIndex === RESERVE_INDICES.USDC ? 6 : 9;
                            displayAmount = formatTokenAmount(amount, decimals);
                          }

                          return (
                            <Text
                              key={index}
                              size="1"
                              style={{ marginLeft: "16px" }}
                            >
                              • {coinType}: {displayAmount} borrowed
                            </Text>
                          );
                        },
                      )
                    ) : (
                      <Text
                        size="1"
                        color="gray"
                        style={{ marginLeft: "16px" }}
                      >
                        No borrows
                      </Text>
                    )}
                  </Flex>
                </Card>
              )}
            </Flex>

            <Text size="1" color="red">
              ⚠️ All hot potato operations MUST complete in a single
              transaction!
            </Text>
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
            <Heading size="3">📋 Hot Potato Pattern Info</Heading>
            <Text size="2" color="blue">
              <strong>🔄 How it works:</strong>
            </Text>
            <Text size="1" color="red">
              <strong>⚠️ Common Error:</strong> MoveAbort code 1 =
              EIncorrectVersion
              <br />
              This means the lending market version doesn't match
              CURRENT_VERSION (7).
              <br />
              🔧 Solution: Use a lending market with the correct version or
              update your contract addresses.
            </Text>
            <Text size="1">
              1. <strong>borrow_obligation_cap</strong> - Temporarily extracts
              ObligationOwnerCap (creates hot potato)
              <br />
              2. <strong>Direct lending operations</strong> - Use the borrowed
              cap for lending market calls
              <br />
              3. <strong>return_obligation_cap</strong> - Return the cap,
              consuming the hot potato
              <br />
              <br />
              🔒 <strong>Security:</strong> The hot potato MUST be consumed in
              the same transaction!
            </Text>
            <Text size="1" color="gray">
              <strong>Strategy Wrapper Package:</strong>
              <br />
              {CONTRACTS.STRATEGY_WRAPPER_PACKAGE}
            </Text>
            <Text size="1" color="gray">
              <strong>Suilend Package (PUBLISHED_AT):</strong>
              <br />
              {CONTRACTS.SUILEND_PACKAGE}
            </Text>
          </Flex>
        </Card>
      </Flex>
    </Container>
  );
}
