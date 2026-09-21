/**
 * The player re-dispatches the core's `error` as a bubbling event, so a page
 * can delegate. A bubbling `error` reaches the window, and Vitest's own
 * catcher there takes any `error` event without an `error` property for an
 * uncaught exception it cannot read, and prints it to stderr: one
 * `CustomEvent { isTrusted: false }` under every test that fails a source.
 * This listener sits on the document, after the player and its controls in
 * the bubbling path, and stops the player's event there. A real uncaught
 * exception arrives as an `ErrorEvent` and passes.
 */
document.addEventListener('error', (event) => {
  if (event instanceof CustomEvent) event.stopPropagation();
});
