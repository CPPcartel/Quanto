import { PrivyGate } from "./auth/PrivyGate";
import Game from "./Game";

/**
 * The game, with the account layer around it.
 *
 * This composition exists purely so Privy stays out of the marketing bundle.
 * Privy plus its Solana peer dependencies weigh well over a megabyte, and the
 * landing page — the thing people arrive on and judge in two seconds — has no
 * use for authentication. App.tsx lazy-loads this module, so the entire auth
 * stack is fetched only when somebody actually enters the city.
 */
export default function GameWithAuth() {
  return (
    <PrivyGate>
      <Game />
    </PrivyGate>
  );
}
