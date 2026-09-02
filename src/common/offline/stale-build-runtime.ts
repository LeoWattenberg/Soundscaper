/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one stale-build controller a document owns, and the listeners that feed it.
 *
 * Production builds route every dynamic import through Vite's preload helper,
 * which dispatches a cancelable `vite:preloadError` on the window before
 * rethrowing. That single event is therefore a complete seam over every lazily
 * loaded chunk in the application, and it is why no individual call site needs a
 * wrapper. The event is observed and never cancelled: swallowing it would resolve
 * the import to `undefined` and turn a legible load failure into an obscure one
 * inside React. `unhandledrejection` is listened to as well, because module
 * loads that do not pass through the helper - the development server, a chunk
 * imported from inside a worker-owned module - reach the page only that way.
 *
 * Views subscribe through `subscribeStaleBuild`, which is stable from the first
 * import: the dialog is part of the startup graph and mounts before, and outlives,
 * anything that could fail to load, so it cannot wait for installation to happen.
 */

import {
	createStaleBuildController,
	type StaleBuildController,
	type StaleBuildControllerOptions,
	type StaleBuildSnapshot,
} from './stale-build-controller.ts';

interface PreloadErrorEvent extends Event {
	readonly payload?: unknown;
}

export interface InstallStaleBuildDetectionOptions
	extends Partial<Omit<StaleBuildControllerOptions, 'moduleUrl'>> {
	readonly moduleUrl: string;
	readonly target?: EventTarget;
}

const IDLE: StaleBuildSnapshot = Object.freeze({ status: 'idle' as const, prompting: false });
const listeners = new Set<() => void>();
let controller: StaleBuildController | null = null;
let current: StaleBuildSnapshot = IDLE;

/** The snapshot every stale-build view renders from, idle until something fails. */
export function staleBuildSnapshot(): StaleBuildSnapshot {
	return current;
}

export function subscribeStaleBuild(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

/** Records a rejection that may be a retired chunk. Safe before installation, and a no-op then. */
export function reportStaleBuildCandidate(error: unknown): void {
	controller?.report(error);
}

export function dismissStaleBuild(): void {
	controller?.dismiss();
}

export function reloadStaleBuild(): Promise<void> {
	return controller?.reload() ?? Promise.resolve();
}

/**
 * Binds the document's failed module loads to a single controller.
 *
 * Returns a teardown that both removes the listeners and releases the
 * controller, so a test - or a second call - never leaves two of them competing
 * for the same window.
 */
export function installStaleBuildDetection(options: InstallStaleBuildDetectionOptions): () => void {
	const target = options.target ?? globalThis.window;
	const reload = options.reload ?? (() => { globalThis.location?.reload(); });
	const installed = createStaleBuildController({ ...options, moduleUrl: options.moduleUrl, reload });
	const unsubscribe = installed.subscribe((snapshot) => {
		current = snapshot;
		for (const listener of [...listeners]) listener();
	});
	controller = installed;
	current = installed.snapshot();
	const onPreloadError = (event: Event): void => { installed.report((event as PreloadErrorEvent).payload); };
	const onRejection = (event: Event): void => {
		installed.report((event as PromiseRejectionEvent).reason);
	};
	target?.addEventListener('vite:preloadError', onPreloadError);
	target?.addEventListener('unhandledrejection', onRejection);
	return () => {
		target?.removeEventListener('vite:preloadError', onPreloadError);
		target?.removeEventListener('unhandledrejection', onRejection);
		unsubscribe();
		if (controller === installed) {
			controller = null;
			current = IDLE;
			for (const listener of [...listeners]) listener();
		}
	};
}
