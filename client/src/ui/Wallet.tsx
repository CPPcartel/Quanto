import { useState, useSyncExternalStore } from "react";
import { world, subscribeUi, getUiVersion } from "../net/world";
import { signInWithWallet } from "../net/connection";
import { connectWallet, hasWallet, shortAddress } from "../net/wallet";

/**
 * Wallet sign-in panel.
 *
 * Play-first by design: the city is fully playable as a guest, and this only
 * ever appears as an optional upgrade. Signing proves ownership — it authorises
 * no transaction and costs no gas.
 */
export function WalletPanel() {
  useSyncExternalStore(subscribeUi, getUiVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const address = world.wallet.address;

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await signInWithWallet((nonce) => connectWallet(nonce));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (address) {
    return (
      <div className="hud wallet-chip">
        <div className="panel compact">
          <div className="row">
            <span className="dot-live" />
            <span className="mono small">{shortAddress(address)}</span>
          </div>
          <p className="dim tiny">Progress follows this wallet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="hud wallet-chip">
      <div className="panel compact">
        {!open ? (
          <>
            <button className="connect" onClick={() => setOpen(true)}>
              Connect wallet
            </button>
            <p className="dim tiny">Optional. You're playing as a guest</p>
          </>
        ) : (
          <div className="connect-body">
            <div className="row space">
              <span className="wallet-label">CONNECT</span>
              <button className="link" onClick={() => setOpen(false)}>
                close
              </button>
            </div>

            {hasWallet() ? (
              <>
                <p className="dim tiny">
                  You'll sign one message to prove the wallet is yours. It costs no gas and
                  approves no transactions. Your guest progress carries over.
                </p>
                <button className="connect" disabled={busy} onClick={connect}>
                  {busy ? "Check your wallet…" : "Sign in"}
                </button>
              </>
            ) : (
              <p className="dim tiny">
                No browser wallet detected. Install MetaMask (or any EVM wallet) and reload.
              </p>
            )}

            {error && <p className="flash small down">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
