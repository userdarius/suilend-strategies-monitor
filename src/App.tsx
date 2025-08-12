import { ConnectButton } from "@mysten/dapp-kit";
import { Box, Container, Flex, Heading, Tabs } from "@radix-ui/themes";
import { WalletStatus } from "./WalletStatus";
import { VaultTest } from "./VaultTest";
import { StrategyWrapperTest } from "./StrategyWrapperTest";
import { TVLMonitor } from "./TVLMonitor";

function App() {
  return (
    <>
      <Flex
        position="sticky"
        px="4"
        py="2"
        justify="between"
        style={{
          borderBottom: "1px solid var(--gray-a2)",
        }}
      >
        <Box>
          <Heading>Strategy Wrapper Testing</Heading>
        </Box>

        <Box>
          <ConnectButton />
        </Box>
      </Flex>
      <Container>
        <Container
          mt="5"
          pt="2"
          px="4"
          style={{ background: "var(--gray-a2)", minHeight: 500 }}
        >
          <WalletStatus />

          <Box mt="6">
            <Tabs.Root defaultValue="tvl">
              <Tabs.List>
                <Tabs.Trigger value="tvl">📊 TVL Monitor</Tabs.Trigger>
                {/* <Tabs.Trigger value="vaults">🏦 Vaults</Tabs.Trigger>
              <Tabs.Trigger value="strategy">🌶️ Strategy Wrapper</Tabs.Trigger>
              <Tabs.Trigger value="objects">📦 Objects</Tabs.Trigger> */}
              </Tabs.List>

              <Tabs.Content value="tvl" mt="4">
                <TVLMonitor />
              </Tabs.Content>

              <Tabs.Content value="vaults" mt="4">
                <VaultTest />
              </Tabs.Content>

              <Tabs.Content value="strategy" mt="4">
                <StrategyWrapperTest />
              </Tabs.Content>
            </Tabs.Root>
          </Box>
        </Container>
      </Container>
    </>
  );
}

export default App;
