import { verifyMessage, isAddress, getAddress } from "viem";
import { randomBytes } from "node:crypto";

/**
 * Wallet sign-in.
 *
 * A wallet proves ownership by signing a nonce we issued. That is all this
 * does — it authorises no transactions and costs no gas.
 *
 * Two properties matter and are enforced here:
 *
 *  - **Single use.** A nonce is deleted the moment it is redeemed, so a
 *    captured signature cannot be replayed to impersonate the wallet later.
 *  - **Short lived.** Nonces expire, so one harvested from a log is useless
 *    within minutes.
 */

const NONCE_TTL_MS = 5 * 60 * 1000;

interface Issued {
  nonce: string;
  expiresAt: number;
}

export class AuthService {
  /** sessionId -> the nonce we handed that connection. */
  private issued = new Map<string, Issued>();

  /** Issue a fresh nonce for a connection to sign. */
  challenge(sessionId: string): string {
    const nonce = randomBytes(16).toString("hex");
    this.issued.set(sessionId, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
    return nonce;
  }

  /**
   * Verify a signature against the nonce we issued to this connection.
   * @returns the checksummed address on success, or null on any failure.
   */
  async verify(
    sessionId: string,
    address: string,
    message: string,
    signature: string
  ): Promise<string | null> {
    const record = this.issued.get(sessionId);
    if (!record) return null;

    // Burn the nonce first: one attempt per challenge, success or failure.
    this.issued.delete(sessionId);

    if (Date.now() > record.expiresAt) return null;
    if (!isAddress(address)) return null;
    // The signed text must actually contain the nonce we issued.
    if (!message.includes(record.nonce)) return null;

    try {
      const ok = await verifyMessage({
        address: getAddress(address),
        message,
        signature: signature as `0x${string}`,
      });
      return ok ? getAddress(address) : null;
    } catch {
      return null;
    }
  }

  release(sessionId: string) {
    this.issued.delete(sessionId);
  }

  /** Drop expired challenges so the map cannot grow without bound. */
  sweep() {
    const now = Date.now();
    this.issued.forEach((record, sessionId) => {
      if (now > record.expiresAt) this.issued.delete(sessionId);
    });
  }
}
