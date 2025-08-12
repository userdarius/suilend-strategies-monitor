export const CONTRACTS = {
  STRATEGY_WRAPPER_PACKAGE:
    "0xba97dc73a07638d03d77ad2161484eb21db577edc9cadcd7035fef4b4f2f6fa1",
  SUILEND_PACKAGE:
    "0xe37cc7bb50fd9b6dbd3873df66fa2c554e973697f50ef97707311dc78bd08444",
  LENDING_MARKET_ID:
    "0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1",
  CLOCK_ID: "0x6",
};

export const TYPES = {
  LENDING_MARKET_TYPE:
    "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL", // Use resolver address to match SuilendClient
  SUI_COIN_TYPE: "0x2::sui::SUI",
  SPRING_SUI_COIN_TYPE:
    "0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI",
  USDC_COIN_TYPE:
    "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
};

export const STRATEGY_TYPES = {
  SUI_LOOPING_SSUI: 1,
  SUI_LOOPING_STRATSUI: 2,
} as const;

export const RESERVE_INDICES = {
  SUI: 0,
  SSUI: 10, // sSUI reserve index
  USDC: 7,
} as const;
