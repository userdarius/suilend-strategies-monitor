import { useState } from "react";
import { SuilendClient } from "@suilend/sdk";
import { useSuiClient } from "@mysten/dapp-kit";
import {
  Button,
  Card,
  Container,
  Flex,
  Heading,
  Text,
  TextArea,
  Badge,
  Table,
} from "@radix-ui/themes";
import { CONTRACTS, TYPES, STRATEGY_TYPES } from "./constants";

// Types for our data structures
interface StrategyCapInfo {
  objectId: string;
  obligationId: string;
  strategyType: number;
  owner: string;
}

interface ObligationSummary {
  obligationId: string;
  deposited_value_usd: number;
  unweighted_borrowed_value_usd: number;
  net_value_usd: number;
  strategyType: number;
  owner: string;
  objectId: string;
}

interface TVLSummary {
  totalTVL: number;
  totalDeposits: number;
  totalBorrows: number;
  strategyCount: number;
  obligations: ObligationSummary[];
}

// Utility functions for decimal formatting
const formatUSD = (rawValue: string | number | bigint | any): string => {
  let value: number;

  if (typeof rawValue === "bigint") {
    value = Number(rawValue) / 10 ** 18; // Suilend uses 18 decimals for USD values
  } else if (typeof rawValue === "string") {
    value = Number(rawValue) / 10 ** 18;
  } else if (typeof rawValue === "number") {
    value = rawValue / 10 ** 18;
  } else if (
    rawValue &&
    typeof rawValue === "object" &&
    rawValue.value !== undefined
  ) {
    // Handle Suilend SDK Decimal objects which have a .value property with BigInt
    value = Number(rawValue.value) / 10 ** 18;
  } else if (rawValue && typeof rawValue === "object" && rawValue.toString) {
    // Handle other objects that can be converted to string
    value = Number(rawValue.toString()) / 10 ** 18;
  } else {
    // Fallback for any other type
    value = Number(String(rawValue)) / 10 ** 18;
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const getStrategyTypeName = (strategyType: number): string => {
  switch (strategyType) {
    case STRATEGY_TYPES.SUI_LOOPING_SSUI:
      return "SUI Looping (sSUI)";
    case STRATEGY_TYPES.SUI_LOOPING_STRATSUI:
      return "SUI Looping (StratSUI)";
    default:
      return `Strategy Type ${strategyType}`;
  }
};

export function TVLMonitor() {
  const suiClient = useSuiClient();

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [tvlData, setTvlData] = useState<TVLSummary | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const addResult = (message: string) => {
    setResult(
      (prev) => prev + "\n" + new Date().toLocaleTimeString() + ": " + message,
    );
  };

  const clearResults = () => {
    setResult("");
  };

  // Main function to calculate TVL from all strategy wrappers
  const calculateStrategyWrapperTVL = async () => {
    setLoading(true);
    addResult("🚀 Starting TVL calculation for all strategy wrappers...");

    try {
      // Step 1: Find all StrategyOwnerCap objects
      addResult("🔍 Searching for all StrategyOwnerCap objects...");

      // Use getDynamicFields to find objects by type - but first let's try a simpler approach
      // We'll use queryEvents to find CreatedStrategyOwnerCap events and extract the cap IDs
      addResult("🔍 Searching for CreatedStrategyOwnerCap events...");

      // Fetch all events with pagination
      const allCreatedEvents = [];
      let hasNextPage = true;
      let nextCursor = null;
      let pageCount = 0;

      while (hasNextPage && pageCount < 20) {
        // Safety limit of 20 pages (up to 5000 events)
        const createdEvents = await suiClient.queryEvents({
          query: {
            MoveEventType: `${CONTRACTS.STRATEGY_WRAPPER_PACKAGE}::strategy_wrapper::CreatedStrategyOwnerCap`,
          },
          limit: 250, // Larger batch size
          order: "descending",
          cursor: nextCursor,
        });

        allCreatedEvents.push(...createdEvents.data);

        hasNextPage = createdEvents.hasNextPage || false;
        nextCursor = createdEvents.nextCursor || null;
        pageCount++;

        addResult(
          `📄 Fetched page ${pageCount}: ${createdEvents.data.length} events (total: ${allCreatedEvents.length})`,
        );

        if (!hasNextPage) {
          break;
        }
      }

      addResult(
        `📅 Found ${allCreatedEvents.length} total CreatedStrategyOwnerCap events across ${pageCount} pages`,
      );

      // Extract strategy cap IDs from events and verify they still exist
      const strategyCapIds: string[] = [];
      for (const event of allCreatedEvents) {
        if (event.parsedJson && typeof event.parsedJson === "object") {
          const eventData = event.parsedJson as any;
          if (eventData.cap_id) {
            // Address might already have 0x prefix, normalize it
            const address = eventData.cap_id.startsWith("0x")
              ? eventData.cap_id
              : `0x${eventData.cap_id}`;
            strategyCapIds.push(address);
          }
        }
      }

      addResult(
        `📦 Extracted ${strategyCapIds.length} strategy cap IDs from events`,
      );

      // Now get the actual objects and verify they still exist
      const allStrategyCaps = { data: [] as any[] };
      let notFoundCount = 0;

      addResult(`🔄 Checking ${strategyCapIds.length} strategy cap objects...`);

      // Process in batches to avoid overwhelming the RPC
      const batchSize = 50;
      for (let i = 0; i < strategyCapIds.length; i += batchSize) {
        const batch = strategyCapIds.slice(i, i + batchSize);
        addResult(
          `  📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(strategyCapIds.length / batchSize)} (${batch.length} objects)`,
        );

        const batchPromises = batch.map(async (capId) => {
          try {
            const obj = await suiClient.getObject({
              id: capId,
              options: { showContent: true, showOwner: true, showType: true },
            });

            if (obj.data && !obj.error) {
              return obj;
            } else {
              return null;
            }
          } catch (error) {
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);

        for (const result of batchResults) {
          if (result) {
            allStrategyCaps.data.push(result);
          } else {
            notFoundCount++;
          }
        }
      }

      if (notFoundCount > 0) {
        addResult(
          `⚠️ ${notFoundCount} strategy caps no longer exist as StrategyOwnerCap objects (possibly converted to WrappedObligationCap)`,
        );
      }

      addResult(
        `📦 Found ${allStrategyCaps.data.length} StrategyOwnerCap objects`,
      );

      if (allStrategyCaps.data.length === 0) {
        addResult("⚠️ No StrategyOwnerCap objects found");
        setLoading(false);
        return;
      }

      // Step 2: Extract obligation information from each StrategyOwnerCap
      const strategyCapInfos: StrategyCapInfo[] = [];

      for (const capObj of allStrategyCaps.data) {
        if (capObj.data?.content && "fields" in capObj.data.content) {
          const fields = capObj.data.content.fields as any;
          const innerCap = fields.inner_cap;

          if (innerCap && innerCap.fields) {
            strategyCapInfos.push({
              objectId: capObj.data.objectId!,
              obligationId: innerCap.fields.obligation_id,
              strategyType: Number(fields.strategy_type),
              owner: capObj.data.owner?.AddressOwner || "Unknown",
            });
          }
        }
      }

      addResult(`📋 Extracted ${strategyCapInfos.length} valid obligations`);

      // Step 3: Initialize SuilendClient to get obligation data
      addResult("🔗 Initializing SuilendClient...");
      const suilendClient = await SuilendClient.initialize(
        CONTRACTS.LENDING_MARKET_ID,
        TYPES.LENDING_MARKET_TYPE,
        suiClient as any,
      );

      // Step 4: Get obligation data for each one
      const obligations: ObligationSummary[] = [];
      let totalTVL = 0;
      let totalDeposits = 0;
      let totalBorrows = 0;

      addResult("💼 Fetching obligation data for each strategy...");

      // Process in smaller batches with delays to avoid rate limiting
      const obligationBatchSize = 5; // Smaller batches
      for (let i = 0; i < strategyCapInfos.length; i += obligationBatchSize) {
        const batch = strategyCapInfos.slice(i, i + obligationBatchSize);
        addResult(
          `  📦 Processing batch ${Math.floor(i / obligationBatchSize) + 1}/${Math.ceil(strategyCapInfos.length / obligationBatchSize)} (${batch.length} obligations)`,
        );

        // Process batch in parallel with retry logic
        const batchPromises = batch.map(async (capInfo, batchIndex) => {
          const globalIndex = i + batchIndex;

          // Retry logic
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              addResult(
                `    📊 Processing ${globalIndex + 1}/${strategyCapInfos.length}: ${capInfo.obligationId.slice(0, 8)}... (attempt ${attempt})`,
              );

              const obligation = await suilendClient.getObligation(
                capInfo.obligationId,
              );

              // Extract USD values
              const depositedUSD =
                Number(obligation.depositedValueUsd?.value || 0) / 10 ** 18;
              const borrowedUSD =
                Number(obligation.unweightedBorrowedValueUsd?.value || 0) /
                10 ** 18;
              const netValueUSD = depositedUSD - borrowedUSD;

              const obligationData = {
                obligationId: capInfo.obligationId,
                deposited_value_usd: depositedUSD,
                unweighted_borrowed_value_usd: borrowedUSD,
                net_value_usd: netValueUSD,
                strategyType: capInfo.strategyType,
                owner: capInfo.owner,
                objectId: capInfo.objectId,
              };

              addResult(
                `      ✅ Success: Deposits: $${depositedUSD.toFixed(2)} | Borrows: $${borrowedUSD.toFixed(2)}`,
              );

              return obligationData;
            } catch (error) {
              addResult(
                `      ⚠️ Attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`,
              );

              if (attempt === 3) {
                addResult(`      ❌ Final failure after 3 attempts`);
                return null;
              }

              // Wait before retry (exponential backoff)
              await new Promise((resolve) =>
                setTimeout(resolve, attempt * 1000),
              );
            }
          }
          return null;
        });

        const batchResults = await Promise.all(batchPromises);

        // Add successful results
        for (const result of batchResults) {
          if (result) {
            obligations.push(result);
            totalDeposits += result.deposited_value_usd;
            totalBorrows += result.unweighted_borrowed_value_usd;
            totalTVL += result.deposited_value_usd;
          }
        }

        // Add delay between batches to avoid overwhelming the RPC
        if (i + obligationBatchSize < strategyCapInfos.length) {
          addResult(
            `    ⏳ Waiting 2s before next batch to avoid rate limiting...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      // Step 5: Compile results and add success/failure summary
      const successfulObligations = obligations.length;
      const totalAttempted = strategyCapInfos.length;
      const failedObligations = totalAttempted - successfulObligations;
      const successRate =
        totalAttempted > 0
          ? ((successfulObligations / totalAttempted) * 100).toFixed(1)
          : "0";

      addResult(`📈 === PROCESSING SUMMARY ===`);
      addResult(
        `   ✅ Successful: ${successfulObligations}/${totalAttempted} (${successRate}%)`,
      );
      if (failedObligations > 0) {
        addResult(
          `   ❌ Failed: ${failedObligations} obligations (network/rate limiting issues)`,
        );
        addResult(
          `   💡 Tip: Failed obligations may succeed on retry due to temporary network issues`,
        );
      }

      const tvlSummary: TVLSummary = {
        totalTVL,
        totalDeposits,
        totalBorrows,
        strategyCount: successfulObligations, // Use successful count
        obligations: obligations.sort(
          (a, b) => b.deposited_value_usd - a.deposited_value_usd,
        ), // Sort by deposits descending
      };

      setTvlData(tvlSummary);
      setLastUpdated(new Date());

      addResult("🎉 TVL CALCULATION COMPLETE! 🎉");
      addResult(`📊 === FINAL SUMMARY ===`);
      addResult(`   Total TVL: ${formatUSD(totalTVL * 10 ** 18)}`);
      addResult(`   Total Deposits: ${formatUSD(totalDeposits * 10 ** 18)}`);
      addResult(`   Total Borrows: ${formatUSD(totalBorrows * 10 ** 18)}`);
      addResult(
        `   Net Value: ${formatUSD((totalDeposits - totalBorrows) * 10 ** 18)}`,
      );
      addResult(`   Active Strategies: ${successfulObligations}`);
      addResult(`   Data Quality: ${successRate}% success rate`);
    } catch (error: any) {
      addResult(`❌ Error calculating TVL: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // return (
  //   <Container>
  //     <Flex direction="column" gap="4">
  //       <Heading>📊 Strategy Wrapper TVL Monitor</Heading>
  //       <Text size="2" color="blue">
  //         Monitor Total Value Locked across all Strategy Wrapper obligations
  //       </Text>

  //       <Card>
  //       pageCountWrapped++;

  //       addResult(
  //         `📄 Fetched wrapped page ${pageCountWrapped}: ${wrappedEvents.data.length} events (total: ${allWrappedEvents.length})`,
  //       );

  //       if (!hasNextPageWrapped) {
  //         break;
  //       }
  //     }

  //     addResult(
  //       `📅 Found ${allWrappedEvents.length} total ConvertedToWrappedCap events across ${pageCountWrapped} pages`,
  //     );

  //     // Extract wrapped cap IDs from events
  //     const wrappedCapIds: string[] = [];
  //     for (const event of allWrappedEvents) {
  //       if (event.parsedJson && typeof event.parsedJson === "object") {
  //         const eventData = event.parsedJson as any;
  //         if (eventData.wrapped_cap_id) {
  //           // Address might already have 0x prefix, normalize it
  //           const address = eventData.wrapped_cap_id.startsWith("0x")
  //             ? eventData.wrapped_cap_id
  //             : `0x${eventData.wrapped_cap_id}`;
  //           wrappedCapIds.push(address);
  //         }
  //       }
  //     }

  //     // Get the actual wrapped cap objects
  //     const wrappedCaps = { data: [] as any[] };
  //     let wrappedNotFoundCount = 0;

  //     addResult(`🔄 Checking ${wrappedCapIds.length} wrapped cap objects...`);

  //     // Process in batches to avoid overwhelming the RPC
  //     const batchSize = 50;
  //     for (let i = 0; i < wrappedCapIds.length; i += batchSize) {
  //       const batch = wrappedCapIds.slice(i, i + batchSize);
  //       addResult(
  //         `  🌶️ Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(wrappedCapIds.length / batchSize)} (${batch.length} objects)`,
  //       );

  //       const batchPromises = batch.map(async (capId) => {
  //         try {
  //           const obj = await suiClient.getObject({
  //             id: capId,
  //             options: { showContent: true, showOwner: true, showType: true },
  //           });

  //           if (obj.data && !obj.error) {
  //             return obj;
  //           } else {
  //             return null;
  //           }
  //         } catch (error) {
  //           return null;
  //         }
  //       });

  //       const batchResults = await Promise.all(batchPromises);

  //       for (const result of batchResults) {
  //         if (result) {
  //           wrappedCaps.data.push(result);
  //         } else {
  //           wrappedNotFoundCount++;
  //         }
  //       }
  //     }

  //     if (wrappedNotFoundCount > 0) {
  //       addResult(
  //         `⚠️ ${wrappedNotFoundCount} wrapped caps no longer exist (possibly converted back to StrategyOwnerCap)`,
  //       );
  //     }

  //     addResult(
  //       `🌶️ Found ${wrappedCaps.data.length} WrappedObligationCap objects`,
  //     );

  //     if (wrappedCaps.data.length === 0) {
  //       addResult("⚠️ No WrappedObligationCap objects found");
  //       setLoading(false);
  //       return;
  //     }

  //     // Extract obligation information from wrapped caps
  //     const wrappedCapInfos: StrategyCapInfo[] = [];

  //     for (const capObj of wrappedCaps.data) {
  //       if (capObj.data?.content && "fields" in capObj.data.content) {
  //         const fields = capObj.data.content.fields as any;
  //         const innerCap = fields.inner_cap;

  //         // Check if inner_cap is available (not borrowed)
  //         if (innerCap && innerCap.fields) {
  //           wrappedCapInfos.push({
  //             objectId: capObj.data.objectId!,
  //             obligationId: innerCap.fields.obligation_id,
  //             strategyType: Number(fields.strategy_type),
  //             owner: capObj.data.owner?.AddressOwner || "Unknown",
  //           });
  //         } else {
  //           addResult(
  //             `⚠️ Wrapped cap ${capObj.data.objectId?.slice(0, 8)}... has borrowed inner_cap (currently in use)`,
  //           );
  //         }
  //       }
  //     }

  //     addResult(
  //       `📋 Found ${wrappedCapInfos.length} available wrapped cap obligations`,
  //     );

  //     // If we have wrapped caps, add them to the existing calculation
  //     if (wrappedCapInfos.length > 0) {
  //       addResult("🔗 Adding wrapped cap obligations to TVL calculation...");

  //       const suilendClient = await SuilendClient.initialize(
  //         CONTRACTS.LENDING_MARKET_ID,
  //         TYPES.LENDING_MARKET_TYPE,
  //         suiClient as any,
  //       );

  //       const wrappedObligations: ObligationSummary[] = [];
  //       let wrappedTotalDeposits = 0;
  //       let wrappedTotalBorrows = 0;

  //       for (let i = 0; i < wrappedCapInfos.length; i++) {
  //         const capInfo = wrappedCapInfos[i];
  //         addResult(
  //           `  📊 Processing wrapped ${i + 1}/${wrappedCapInfos.length}: ${capInfo.obligationId.slice(0, 8)}...`,
  //         );

  //         try {
  //           const obligation = await suilendClient.getObligation(
  //             capInfo.obligationId,
  //           );

  //           const depositedUSD =
  //             Number(obligation.depositedValueUsd?.value || 0) / 10 ** 18;
  //           const borrowedUSD =
  //             Number(obligation.unweightedBorrowedValueUsd?.value || 0) /
  //             10 ** 18;

  //           wrappedObligations.push({
  //             obligationId: capInfo.obligationId,
  //             deposited_value_usd: depositedUSD,
  //             unweighted_borrowed_value_usd: borrowedUSD,
  //             net_value_usd: depositedUSD - borrowedUSD,
  //             strategyType: capInfo.strategyType,
  //             owner: capInfo.owner,
  //             objectId: capInfo.objectId,
  //           });

  //           wrappedTotalDeposits += depositedUSD;
  //           wrappedTotalBorrows += borrowedUSD;

  //           addResult(
  //             `    💰 Deposits: $${depositedUSD.toFixed(2)} | Borrows: $${borrowedUSD.toFixed(2)}`,
  //           );
  //         } catch (error) {
  //           addResult(`    ❌ Failed to get wrapped obligation data: ${error}`);
  //         }
  //       }

  //       addResult(`🌶️ Wrapped Cap Summary:`);
  //       addResult(
  //         `   Wrapped TVL: ${formatUSD(wrappedTotalDeposits * 10 ** 18)}`,
  //       );
  //       addResult(
  //         `   Wrapped Borrows: ${formatUSD(wrappedTotalBorrows * 10 ** 18)}`,
  //       );
  //       addResult(`   Wrapped Count: ${wrappedCapInfos.length}`);

  //       // Combine with existing TVL data if available
  //       if (tvlData) {
  //         const combinedTVL: TVLSummary = {
  //           totalTVL: tvlData.totalTVL + wrappedTotalDeposits,
  //           totalDeposits: tvlData.totalDeposits + wrappedTotalDeposits,
  //           totalBorrows: tvlData.totalBorrows + wrappedTotalBorrows,
  //           strategyCount: tvlData.strategyCount + wrappedCapInfos.length,
  //           obligations: [...tvlData.obligations, ...wrappedObligations].sort(
  //             (a, b) => b.deposited_value_usd - a.deposited_value_usd,
  //           ),
  //         };

  //         setTvlData(combinedTVL);
  //         addResult(
  //           `📊 COMBINED TOTAL TVL: ${formatUSD(combinedTVL.totalTVL * 10 ** 18)}`,
  //         );
  //       }
  //     }
  //   } catch (error: any) {
  //     addResult(`❌ Error calculating wrapped cap TVL: ${error.message}`);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  return (
    <Container>
      <Flex direction="column" gap="4">
        <Heading>📊 Strategy Wrapper TVL Monitor</Heading>
        <Text size="2" color="blue">
          Monitor Total Value Locked across all Strategy Wrapper obligations
        </Text>

        <Card>
          <Flex direction="column" gap="5">
            <Heading size="3">🔍 TVL Analysis</Heading>
            <Text size="2" color="gray">
              This tool finds all StrategyOwnerCap and WrappedObligationCap
              objects on-chain and calculates their total TVL
            </Text>

            <Flex gap="4">
              <Button
                onClick={calculateStrategyWrapperTVL}
                disabled={loading}
                style={{ backgroundColor: "#4CAF50" }}
                size="3"
              >
                📊 Calculate Strategy Cap TVL
              </Button>

              {/* <Button
                onClick={calculateWrappedCapTVL}
                disabled={loading}
                style={{ backgroundColor: "#FF6B35" }}
                size="3"
              >
                🌶️ Include Wrapped Caps
              </Button>

              <Button
                onClick={async () => {
                  setLoading(true);
                  try {
                    await calculateStrategyWrapperTVL();
                    await calculateWrappedCapTVL();
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                style={{ backgroundColor: "#2196F3" }}
                size="3"
              >
                🚀 Full Analysis
              </Button> */}
            </Flex>

            {lastUpdated && (
              <Text size="1" color="gray">
                Last updated: {lastUpdated.toLocaleString()}
              </Text>
            )}
          </Flex>
        </Card>

        {tvlData && (
          <Card>
            <Flex direction="column" gap="4">
              <Flex direction="column" gap="3">
                <Heading size="4">💼 Strategy Wrapper TVL Summary</Heading>
                <Text size="2" color="gray">
                  Real-time analysis of {tvlData.strategyCount} active strategy
                  wrapper obligations
                </Text>
              </Flex>

              <Flex direction="row" gap="4" wrap="wrap" justify="center">
                {/* Total TVL - Primary metric */}
                <Card
                  style={{
                    minWidth: "220px",
                    backgroundColor: "#2a2a2a",
                    border: "1px solid #404040",
                    padding: "16px",
                  }}
                >
                  <Flex direction="column" align="center" gap="2">
                    <Flex align="center" gap="2">
                      <Text size="5" style={{ lineHeight: 1 }}>
                        💰
                      </Text>
                      <Text
                        size="2"
                        weight="medium"
                        style={{ color: "#a0a0a0" }}
                      >
                        Total Value Locked
                      </Text>
                    </Flex>
                    <Text
                      size="6"
                      weight="bold"
                      style={{ letterSpacing: "-0.02em", color: "#ffffff" }}
                    >
                      {formatUSD(tvlData.totalTVL * 10 ** 18)}
                    </Text>
                    <Text size="1" style={{ color: "#888888" }}>
                      Sum of all collateral deposits
                    </Text>
                  </Flex>
                </Card>

                {/* Net Position */}
                <Card
                  style={{
                    minWidth: "220px",
                    backgroundColor: "#2a2a2a",
                    border: "1px solid #404040",
                    padding: "16px",
                  }}
                >
                  <Flex direction="column" align="center" gap="2">
                    <Flex align="center" gap="2">
                      <Text size="5" style={{ lineHeight: 1 }}>
                        📊
                      </Text>
                      <Text
                        size="2"
                        weight="medium"
                        style={{ color: "#a0a0a0" }}
                      >
                        Net Position
                      </Text>
                    </Flex>
                    <Text
                      size="6"
                      weight="bold"
                      style={{ letterSpacing: "-0.02em", color: "#ffffff" }}
                    >
                      {formatUSD(
                        (tvlData.totalDeposits - tvlData.totalBorrows) *
                          10 ** 18,
                      )}
                    </Text>
                    <Text size="1" style={{ color: "#888888" }}>
                      Deposits minus borrows
                    </Text>
                  </Flex>
                </Card>

                {/* Strategy Count */}
                <Card
                  style={{
                    minWidth: "220px",
                    backgroundColor: "#2a2a2a",
                    border: "1px solid #404040",
                    padding: "16px",
                  }}
                >
                  <Flex direction="column" align="center" gap="2">
                    <Flex align="center" gap="2">
                      <Text size="5" style={{ lineHeight: 1 }}>
                        🌶️
                      </Text>
                      <Text
                        size="2"
                        weight="medium"
                        style={{ color: "#a0a0a0" }}
                      >
                        Active Strategies
                      </Text>
                    </Flex>
                    <Text
                      size="6"
                      weight="bold"
                      style={{ letterSpacing: "-0.02em", color: "#ffffff" }}
                    >
                      {tvlData.strategyCount}
                    </Text>
                    <Text size="1" style={{ color: "#888888" }}>
                      Individual strategy positions
                    </Text>
                  </Flex>
                </Card>
              </Flex>

              {/* Detailed breakdown */}
              <Card
                style={{
                  backgroundColor: "#1a1a1a",
                  padding: "16px",
                  border: "1px solid #333333",
                }}
              >
                <Flex direction="column" gap="3">
                  <Heading size="3" style={{ color: "#cccccc" }}>
                    📈 Position Breakdown
                  </Heading>

                  <Flex direction="row" gap="4" wrap="wrap" justify="between">
                    <Flex
                      direction="column"
                      gap="1"
                      style={{ minWidth: "180px" }}
                    >
                      <Text
                        size="1"
                        style={{ color: "#999999" }}
                        weight="medium"
                      >
                        TOTAL DEPOSITS
                      </Text>
                      <Text size="4" weight="bold" style={{ color: "#ffffff" }}>
                        {formatUSD(tvlData.totalDeposits * 10 ** 18)}
                      </Text>
                      <Text size="1" style={{ color: "#777777" }}>
                        Collateral value
                      </Text>
                    </Flex>

                    <Flex
                      direction="column"
                      gap="1"
                      style={{ minWidth: "180px" }}
                    >
                      <Text
                        size="1"
                        style={{ color: "#999999" }}
                        weight="medium"
                      >
                        TOTAL BORROWS
                      </Text>
                      <Text size="4" weight="bold" style={{ color: "#ffffff" }}>
                        {formatUSD(tvlData.totalBorrows * 10 ** 18)}
                      </Text>
                      <Text size="1" style={{ color: "#777777" }}>
                        Outstanding debt
                      </Text>
                    </Flex>

                    <Flex
                      direction="column"
                      gap="1"
                      style={{ minWidth: "180px" }}
                    >
                      <Text
                        size="1"
                        style={{ color: "#999999" }}
                        weight="medium"
                      >
                        UTILIZATION RATIO
                      </Text>
                      <Text size="4" weight="bold" style={{ color: "#ffffff" }}>
                        {(
                          (tvlData.totalBorrows / tvlData.totalDeposits) *
                          100
                        ).toFixed(1)}
                        %
                      </Text>
                      <Text size="1" style={{ color: "#777777" }}>
                        Borrows / Deposits
                      </Text>
                    </Flex>

                    <Flex
                      direction="column"
                      gap="1"
                      style={{ minWidth: "180px" }}
                    >
                      <Text
                        size="1"
                        style={{ color: "#999999" }}
                        weight="medium"
                      >
                        AVG POSITION SIZE
                      </Text>
                      <Text size="4" weight="bold" style={{ color: "#ffffff" }}>
                        {formatUSD(
                          (tvlData.totalDeposits * 10 ** 18) /
                            tvlData.strategyCount,
                        )}
                      </Text>
                      <Text size="1" style={{ color: "#777777" }}>
                        Per strategy
                      </Text>
                    </Flex>
                  </Flex>
                </Flex>
              </Card>
            </Flex>
          </Card>
        )}

        {tvlData && tvlData.obligations.length > 0 && (
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="3">📋 Individual Obligations</Heading>

              <div style={{ overflowX: "auto" }}>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>
                        Obligation
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        Strategy Type
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        Deposits (USD)
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        Borrows (USD)
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        Net Value (USD)
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Owner</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>

                  <Table.Body>
                    {tvlData.obligations.map((obligation) => (
                      <Table.Row key={obligation.obligationId}>
                        <Table.Cell>
                          <Text size="1" style={{ fontFamily: "monospace" }}>
                            {obligation.obligationId.slice(0, 8)}...
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge variant="outline">
                            {getStrategyTypeName(obligation.strategyType)}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <Text color="green" weight="medium">
                            {formatUSD(
                              obligation.deposited_value_usd * 10 ** 18,
                            )}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text color="red" weight="medium">
                            {formatUSD(
                              obligation.unweighted_borrowed_value_usd *
                                10 ** 18,
                            )}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text
                            color={
                              obligation.net_value_usd >= 0 ? "green" : "red"
                            }
                            weight="medium"
                          >
                            {formatUSD(obligation.net_value_usd * 10 ** 18)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="1" style={{ fontFamily: "monospace" }}>
                            {obligation.owner.slice(0, 8)}...
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </div>
            </Flex>
          </Card>
        )}

        <Card>
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center">
              <Heading size="3">🔍 Analysis Log</Heading>
              <Button variant="outline" onClick={clearResults}>
                🗑️ Clear
              </Button>
            </Flex>
            <TextArea
              value={result}
              readOnly
              rows={15}
              style={{ fontFamily: "monospace", fontSize: "12px" }}
              placeholder="TVL analysis results will appear here..."
            />
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="2">
            <Heading size="3">💡 How it Works</Heading>
            <Text size="2">
              <strong>🔍 Discovery:</strong> Uses Sui RPC to find all
              StrategyOwnerCap and WrappedObligationCap objects
              <br />
              <strong>📊 Data Retrieval:</strong> Extracts obligation IDs and
              fetches detailed data via SuilendClient
              <br />
              <strong>💰 TVL Calculation:</strong> Sums deposited_value_usd from
              all obligations (TVL = total deposits)
              <br />
              <strong>📈 Analysis:</strong> Provides breakdown by strategy type,
              owner, and individual positions
            </Text>

            <Text size="1" color="gray">
              <strong>Strategy Wrapper Package:</strong>
              <br />
              {CONTRACTS.STRATEGY_WRAPPER_PACKAGE}
            </Text>
            <Text size="1" color="gray">
              <strong>Lending Market:</strong>
              <br />
              {CONTRACTS.LENDING_MARKET_ID}
            </Text>
          </Flex>
        </Card>
      </Flex>
    </Container>
  );
}
