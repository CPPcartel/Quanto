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
        // Email and socials first: most players arriving from a link have no
        // wallet and no interest in getting one. External wallets still work
        // for people who already have them.
        loginMethods: ["email", "google", "twitter", "discord", "wallet"],

        embeddedWallets: {
          ethereum: {
            // The whole point: a player logs in with an email and quietly ends
            // up with a real, self-custodial wallet.
            createOnLogin: "users-without-wallets",
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
