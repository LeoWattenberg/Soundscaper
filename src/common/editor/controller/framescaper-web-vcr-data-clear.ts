/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WebVcrResolution, WebVcrSnapshot } from '../web-vcr-domain.ts';

export interface FramescaperWebVcrDataClearOptions {
	readonly resolution: WebVcrResolution;
	releasePreview(): Promise<void>;
	requestConfirmation(): Promise<string>;
	invalidateGuest(): void;
	clear(confirmationNonce: string): Promise<Readonly<WebVcrSnapshot>>;
	reopen(resolution: WebVcrResolution): Promise<Readonly<WebVcrSnapshot>>;
	accept(snapshot: Readonly<WebVcrSnapshot>): void;
	restorePreview(): Promise<void>;
	warn(error: unknown): void;
}

/** Preserves the primary clear error while rebuilding authority after destructive dispatch. */
export async function clearFramescaperWebVcrBrowserData(
	options: Readonly<FramescaperWebVcrDataClearOptions>,
): Promise<void> {
	await options.releasePreview();
	let destructive = false;
	let replacementAccepted = false;
	try {
		const nonce = await options.requestConfirmation();
		destructive = true;
		options.invalidateGuest();
		const cleared = await options.clear(nonce);
		options.accept(cleared);
		replacementAccepted = cleared.sessionId !== null && cleared.phase !== 'closed';
		if (!replacementAccepted) {
			options.accept(await options.reopen(options.resolution));
			replacementAccepted = true;
		}
		await options.restorePreview();
	} catch (primaryError) {
		if (destructive && !replacementAccepted) {
			try { options.accept(await options.reopen(options.resolution)); }
			catch (recoveryError) { options.warn(recoveryError); }
		}
		try { await options.restorePreview(); }
		catch (recoveryError) { options.warn(recoveryError); }
		throw primaryError;
	}
}
