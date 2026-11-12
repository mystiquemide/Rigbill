import { Buffer } from "buffer";

// Wallet Selector dependencies expect Node's Buffer global in the browser.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
