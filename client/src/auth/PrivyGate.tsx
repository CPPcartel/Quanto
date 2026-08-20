import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

/**
 * Privy account layer.
 *
 * Wraps the whole app so both the site and the game can read login state.
 * Configured for play-first onboarding: an embedded wallet is created silently
 * for anyone who logs in without one, so a player never has to know what a
 * wallet is to own a floor.
 *
 * With no VITE_PRIVY_APP_ID set this renders children untouched — the game is
 * fully playable as a guest, and local development shouldn't require Privy
 * credentials.
 */

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

export const privyEnabled = Boolean(APP_ID);

export function PrivyGate({ children }: { children: ReactNode }) {
  if (!APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        /**
         * Must match what is actually enabled in the Privy dashboard. Listing a
         * method that is switched off there renders nothing for it, so the panel
         * silently promises a button that never appears.
         */
        loginMethods: ["email", "wallet"],

        embeddedWallets: {
          ethereum: {
            /**
             * Off, on purpose.
             *
             * Privy is this game's identity, not its wallet. Holdings are read
             * from wallets proved to our own server by signature, so an
             * auto-generated empty wallet adds an address that can never hold
             * anything and used to get mistaken for the player's real one.
             *
             * This can be turned back on safely — nothing reads holdings from it
             * any more — the day embedded wallets earn their place, which is
             * when a player without one needs somewhere to keep $BLOCK.
             */
            createOnLogin: "off",
          },
        },

        appearance: {
          theme: "dark",
          accentColor: "#22e8ff",
          logo: "/favicon.svg",
          walletChainType: "ethereum-only",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
