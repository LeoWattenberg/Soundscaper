/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The macro sandbox as it exists in a browser.
 *
 * The prelude is inlined verbatim rather than imported, because the program and
 * the prelude have to be one module: a `blob:` worker is the only way to run a
 * program under a policy that grants no `'unsafe-eval'`, and a blob has nothing
 * to resolve a relative import against.
 */

// Vite's raw loader; the module shape is declared in src/vite-env.d.ts.
import preludeSource from './sandbox-prelude.js?raw';

import {
	createMacroSandboxClient,
	type MacroSandboxRuntime,
	type MacroSandboxWorker,
} from './sandbox-client.ts';

export type BrowserMacroSandboxOptions = Omit<
	MacroSandboxRuntime, 'preludeSource' | 'createWorker' | 'setTimer' | 'clearTimer'
>;

export function createBrowserMacroSandbox(options: BrowserMacroSandboxOptions) {
	return createMacroSandboxClient({
		...options,
		preludeSource: preludeSource as string,
		createWorker: (source, name) => {
			const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
			const worker = new Worker(url, { type: 'module', name });
			// The URL has to outlive construction. WebKit fetches the blob after the
			// constructor returns, so revoking straight away aborts the load and
			// reports an error event with no message at all — which reads as a
			// compile failure and is impossible to debug from the outside. It is
			// released when the run ends instead, which is the one moment the
			// client always reaches.
			return {
				postMessage: (message: unknown) => { worker.postMessage(message); },
				addEventListener: (type: string, listener: (event: never) => void) => {
					worker.addEventListener(type, listener as EventListener);
				},
				terminate: () => {
					worker.terminate();
					URL.revokeObjectURL(url);
				},
			} satisfies MacroSandboxWorker;
		},
		setTimer: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
		clearTimer: (handle) => { globalThis.clearTimeout(handle as number); },
	});
}
