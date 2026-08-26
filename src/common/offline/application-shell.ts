/* SPDX-License-Identifier: AGPL-3.0-only */

interface OfflineServiceWorkerContainer {
	register(
		scriptURL: string,
		options: Readonly<{
			scope: string;
			type: 'classic';
			updateViaCache: 'none';
		}>,
	): Promise<unknown>;
}

export interface RegisterOfflineApplicationShellOptions {
	readonly desktop: boolean;
	readonly productId: 'framescaper' | 'soundscaper';
	readonly location?: Pick<URL, 'protocol'>;
	readonly serviceWorker?: OfflineServiceWorkerContainer;
}

export interface ScheduleOfflineApplicationShellOptions extends RegisterOfflineApplicationShellOptions {
	readonly waitForLoad?: () => Promise<void>;
	readonly waitForEditor?: () => Promise<void>;
	readonly waitForIdle?: () => Promise<void>;
}

export type OfflineApplicationShellRegistrationResult =
	| Readonly<{ status: 'registered'; registration: unknown }>
	| Readonly<{ status: 'unsupported' }>
	| Readonly<{ status: 'failed'; error: unknown }>;

/** Registers the generated web-only worker without making app startup depend on it. */
export async function registerOfflineApplicationShell(
	options: RegisterOfflineApplicationShellOptions,
): Promise<OfflineApplicationShellRegistrationResult> {
	const location = options.location ?? globalThis.location;
	const serviceWorker = options.serviceWorker
		?? (globalThis.navigator?.serviceWorker as OfflineServiceWorkerContainer | undefined);
	if (options.desktop || !location || !['http:', 'https:'].includes(location.protocol)
		|| !serviceWorker || typeof serviceWorker.register !== 'function') {
		return Object.freeze({ status: 'unsupported' });
	}
	try {
		const framescaper = options.productId === 'framescaper';
		const registration = await serviceWorker.register(
			framescaper ? '/framescaper/service-worker.js' : '/service-worker.js', {
			scope: framescaper ? '/framescaper/' : '/',
			type: 'classic',
			updateViaCache: 'none',
		});
		return Object.freeze({ status: 'registered', registration });
	} catch (error) {
		return Object.freeze({ status: 'failed', error });
	}
}

/** Defers the non-critical shell download until the initial editor is usable and the browser is idle. */
export async function scheduleOfflineApplicationShellRegistration(
	options: ScheduleOfflineApplicationShellOptions,
): Promise<OfflineApplicationShellRegistrationResult> {
	await (options.waitForLoad ?? waitForDocumentLoad)();
	await (options.waitForEditor ?? waitForEditorReadiness)();
	await (options.waitForIdle ?? waitForBrowserIdle)();
	return registerOfflineApplicationShell(options);
}

function waitForDocumentLoad(): Promise<void> {
	if (globalThis.document?.readyState === 'complete') return Promise.resolve();
	return new Promise((resolve) => globalThis.addEventListener('load', () => resolve(), { once: true }));
}

function waitForEditorReadiness(): Promise<void> {
	const root = globalThis.document?.getElementById('app');
	if (!root || root.querySelector('[data-audio-editor-bound="true"], [role="alert"]')) return Promise.resolve();
	return new Promise((resolve) => {
		const observer = new MutationObserver(() => {
			if (!root.querySelector('[data-audio-editor-bound="true"], [role="alert"]')) return;
			observer.disconnect();
			resolve();
		});
		observer.observe(root, { childList: true, subtree: true });
	});
}

function waitForBrowserIdle(): Promise<void> {
	const requestIdleCallback = (globalThis as typeof globalThis & {
		requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
	}).requestIdleCallback;
	return new Promise((resolve) => {
		if (requestIdleCallback) requestIdleCallback(() => resolve(), { timeout: 5_000 });
		else globalThis.setTimeout(resolve, 1_000);
	});
}
