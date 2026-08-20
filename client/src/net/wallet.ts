import {
  createWalletClient,
  custom,
  defineChain,
  type Address,
  type EIP1193Provider,
} from "viem";
import { world, markUiDirty } from "./world";

/**
 * Wallet connection.
 *
 * Deliberately dependency-light: viem talking to whatever EIP-1193 provider the
 * browser exposes (MetaMask, Rabby, Coinbase Wallet…). No connector framework,
 * no wallet-list UI to maintain.
 *
 * The flow is play-first: you can do everything in the city as a guest, and
 * only connect when you want ownership to be real. Connecting migrates the
 * guest progress already saved against your browser id.
 */

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_TESTNET_ID = 46630;

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

interface Eip1193 extends EIP1193Provider {
  isMetaMask?: boolean;
}

function provider(): Eip1193 | null {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  return eth ?? null;
}

export function hasWallet(): boolean {
  return provider() !== null;
}

/** Add or switch the wallet to Robinhood Chain. */
async function ensureChain(eth: Eip1193) {
  const hex = `0x${ROBINHOOD_CHAIN_ID.toString(16)}`;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex as `0x${string}` }],
    });
  } catch (err) {
    // 4902 means the wallet doesn't know this chain yet — add it, then retry.
    const code = (err as { code?: number })?.code;
    if (code !== 4902) throw err;

    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex,
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
          blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
        },
      ] as never,
    });
  }
}

export interface SignedProof {
  address: Address;
  message: string;
  signature: `0x${string}`;
}

/**
 * Connect, switch chain, and sign the server's nonce.
 *
 * The nonce comes from the server and is single-use, so a captured signature
 * cannot be replayed to impersonate the wallet later.
 */
export async function connectWallet(nonce: string): Promise<SignedProof> {
  const eth = provider();
  if (!eth) {
    throw new Error("No wallet found. Install MetaMask or another browser wallet.");
  }

  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no account.");

  await ensureChain(eth);

  const client = createWalletClient({ chain: robinhoodChain, transport: custom(eth) });

  const message = [
    "Sign in to Quanto",
    "",
    "This proves you own this wallet.",
    "It costs no gas and authorises no transactions.",
    "",
    `Nonce: ${nonce}`,
  ].join("\n");

  const signature = await client.signMessage({ account: address, message });

  return { address, message, signature };
}

/**
 * Connect and switch chain, without signing anything.
 *
 * Used on the marketing site, where there is no game session to prove identity
 * to yet — so there is nothing to sign against. Full sign-in happens in-game.
 */
export async function connectOnly(): Promise<Address> {
  const eth = provider();
  if (!eth) throw new Error("No wallet found. Install MetaMask or another browser wallet.");

  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no account.");

  await ensureChain(eth);
  return address;
}

/** Silently report an already-connected account, without prompting. */
export async function currentAccount(): Promise<Address | null> {
  const eth = provider();
  if (!eth) return null;
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as Address[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Keep the HUD honest if the user switches accounts in their wallet. */
export function watchWallet(onChange: (address: Address | null) => void) {
  const eth = provider();
  if (!eth) return () => {};

  const handler = (accounts: unknown) => {
    const list = accounts as Address[];
    onChange(list?.[0] ?? null);
  };

  eth.on?.("accountsChanged", handler as never);
  return () => {
    eth.removeListener?.("accountsChanged", handler as never);
  };
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function setWalletState(address: string | null, connecting = false) {
  world.wallet.address = address ?? "";
  world.wallet.connecting = connecting;
  markUiDirty();
}
