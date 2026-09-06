/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The event a Chromium browser fires once a document meets its installability
 * criteria. It is not in the DOM lib, and it is deliberately described here by
 * the two members this module uses rather than by a full ambient declaration:
 * a browser that fires something else shaped differently is simply ignored.
 */
export interface InstallPromptEvent {
	preventDefault(): void;
	prompt(): unknown;
	readonly userChoice?: PromiseLike<{ readonly outcome: string }>;
}

/** The window-shaped surface the capture listens on. */
export interface InstallPromptEventSource {
	addEventListener(type: string, listener: (event: unknown) => void): void;
	removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface InstallPromptCapture {
	/** Whether an unspent prompt is held right now. */
	available(): boolean;
	/** Replays the held prompt from a user gesture and spends it. */
	prompt(): Promise<InstallPromptOutcome>;
	/** Detaches the listeners and drops any held prompt. */
	stop(): void;
}

export interface CreateInstallPromptCaptureOptions {
	readonly source?: InstallPromptEventSource | null;
	readonly onChange?: (available: boolean) => void;
}

/**
 * Holds the browser's install offer until the editor asks for it.
 *
 * The browser fires `beforeinstallprompt` at a moment of its own choosing and
 * withdraws its own banner when the page calls `preventDefault`, so the offer
 * has to be kept somewhere the Help menu can reach later. The prompt may be
 * shown once per event, which is why replaying it drops the event first: a
 * second menu click must find nothing rather than replay an event the browser
 * has already consumed.
 */
export function createInstallPromptCapture(
	options: CreateInstallPromptCaptureOptions = {},
): InstallPromptCapture {
	const source = options.source === undefined
		? (globalThis as unknown as InstallPromptEventSource)
		: options.source;
	let captured: InstallPromptEvent | null = null;
	const announce = () => options.onChange?.(captured !== null);
	const capture = (event: unknown) => {
		if (!isInstallPromptEvent(event)) return;
		event.preventDefault();
		captured = event;
		announce();
	};
	const discard = () => {
		if (captured === null) return;
		captured = null;
		announce();
	};
	const listening = typeof source?.addEventListener === 'function'
		&& typeof source?.removeEventListener === 'function';
	if (listening) {
		source?.addEventListener('beforeinstallprompt', capture);
		source?.addEventListener('appinstalled', discard);
	}
	return Object.freeze({
		available: () => captured !== null,
		prompt: async (): Promise<InstallPromptOutcome> => {
			const event = captured;
			if (event === null) return 'unavailable';
			captured = null;
			announce();
			await event.prompt();
			const choice = await event.userChoice;
			return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
		},
		stop: () => {
			captured = null;
			if (!listening) return;
			source?.removeEventListener('beforeinstallprompt', capture);
			source?.removeEventListener('appinstalled', discard);
		},
	});
}

let sharedCapture: InstallPromptCapture | null = null;

/**
 * The one capture the running editor shares.
 *
 * The listeners attach on first use rather than at import so that importing
 * this module stays free of side effects; the editor reaches it while building
 * its menus, which happens long before a browser judges the app installable.
 */
export function applicationInstallPromptCapture(): InstallPromptCapture {
	sharedCapture ??= createInstallPromptCapture();
	return sharedCapture;
}

/** Drops the shared capture so a test can observe a fresh one. */
export function resetApplicationInstallPromptCapture(): void {
	sharedCapture?.stop();
	sharedCapture = null;
}

function isInstallPromptEvent(value: unknown): value is InstallPromptEvent {
	if (value === null || typeof value !== 'object') return false;
	const candidate = value as Partial<InstallPromptEvent>;
	return typeof candidate.prompt === 'function' && typeof candidate.preventDefault === 'function';
}
