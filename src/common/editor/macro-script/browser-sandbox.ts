/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The macro sandbox as it exists in a browser.
 *
 * The authored program remains the body of a `blob:` module because the policy
 * grants no `'unsafe-eval'`. Its trusted prelude is a static, absolute import:
 * that dependency evaluates first and stays an observable first-party module
 * instead of disappearing inside the generated blob's coverage identity.
 */

import preludeModuleUrl from './sandbox-prelude.js?url';

import { macroPreludeImportSource } from './browser-prelude-loader.ts';
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
		preludeSource: macroPreludeImportSource(preludeModuleUrl, globalThis.location.href),
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
