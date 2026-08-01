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
	readonly location?: Pick<URL, 'protocol'>;
	readonly serviceWorker?: OfflineServiceWorkerContainer;
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
		const registration = await serviceWorker.register('/service-worker.js', {
			scope: '/',
			type: 'classic',
			updateViaCache: 'none',
		});
		return Object.freeze({ status: 'registered', registration });
	} catch (error) {
		return Object.freeze({ status: 'failed', error });
	}
}
