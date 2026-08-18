/**
 * One answer to "is the player typing right now?".
 *
 * This test had grown three separate implementations — in `net/input.ts`, in
 * `ui/Chat.tsx` and in the HUD's help toggle — and they had already drifted:
 * only one of them counted `contentEditable`, none counted `<select>`, and the
 * shift minigame had no check at all. That last omission meant pressing space
 * while typing a chat message during a shift both swallowed the space and
 * counted as a shift press.
 *
 * Any global key handler that would otherwise steal a keystroke from a text
 * field must consult this.
 */
export function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}
