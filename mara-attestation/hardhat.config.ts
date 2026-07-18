import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const VALUECHAIN_TESTNET_RPC = process.env.VALUECHAIN_TESTNET_RPC ?? "https://testnet.valuechain.xyz";
const VALUECHAIN_MAINNET_RPC = process.env.VALUECHAIN_MAINNET_RPC ?? "https://mainnet.valuechain.xyz";
const VALUECHAIN_EXPLORER_API_KEY = process.env.VALUECHAIN_EXPLORER_API_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: false,
    },
  },

  networks: {
    // ValueChain Testnet (chainId 138565)
    valuechain_testnet: {
      url: VALUECHAIN_TESTNET_RPC,
      chainId: 138565,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gas: "auto",
      gasPrice: "auto",
    },

    // Sepolia Testnet (chainId 11155111)
    sepolia: {
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gas: "auto",
      gasPrice: "auto",
    },

    // ValueChain Mainnet (chainId 286623)
    valuechain_mainnet: {
      url: VALUECHAIN_MAINNET_RPC,
      chainId: 286623,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gas: "auto",
      gasPrice: "auto",
    },

    // Local Hardhat node for testing.
    // Funds the REAL operator key (not the synthetic Hardhat default) so that
    // even local deploys produce operator == execution wallet. If no key is
    // configured we leave defaults, but deploy.ts will then refuse to proceed.
    hardhat: {
      chainId: 31337,
      accounts: PRIVATE_KEY
        ? [{ privateKey: PRIVATE_KEY, balance: "10000000000000000000000" }] // 10,000 native
        : undefined,
    },

    // External local node (npx hardhat node) — inherits the hardhat network's
    // configured account, i.e. the real operator wallet.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },

  // Explorer verification config (ValueChain uses an Etherscan-compatible explorer)
  etherscan: {
    apiKey: {
      valuechain_testnet: VALUECHAIN_EXPLORER_API_KEY,
      valuechain_mainnet: VALUECHAIN_EXPLORER_API_KEY,
    },
    customChains: [
      {
        network: "valuechain_testnet",
        chainId: 138565,
        urls: {
          // Replace with actual ValueChain testnet explorer URL
          apiURL: "https://testnet.sodex.com/explorer/api",
          browserURL: "https://testnet.sodex.com/explorer",
        },
      },
      {
        network: "valuechain_mainnet",
        chainId: 286623,
        urls: {
          apiURL: "https://main-scan.valuechain.xyz/api",
          browserURL: "https://main-scan.valuechain.xyz",
        },
      },
    ],
  },

  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
