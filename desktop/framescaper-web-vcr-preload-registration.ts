/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute } from 'node:path';

interface TrustedAppSession {
	registerPreloadScript(value: Readonly<{ readonly type: 'frame'; readonly filePath: string }>): string;
	unregisterPreloadScript(id: string): void;
}

interface FramescaperWebVcrTrustedPreloadOptions {
	readonly productId: string;
	readonly preloadPath: string;
	readonly trustedAppSession: TrustedAppSession;
}

export interface FramescaperWebVcrTrustedPreloadRegistrationV1 {
	dispose(): void;
}

/** Registers the v1 bridge in the trusted app session, never in the remote guest partition. */
export function registerFramescaperWebVcrTrustedPreloadV1(
	value: FramescaperWebVcrTrustedPreloadOptions,
): Readonly<FramescaperWebVcrTrustedPreloadRegistrationV1> {
	const options = validateOptions(value);
	if (options.productId !== 'framescaper') {
		throw new Error('Web VCR trusted preload requires Framescaper.');
	}
	const preloadId = options.trustedAppSession.registerPreloadScript({
		type: 'frame',
		filePath: options.preloadPath,
	});
	if (typeof preloadId !== 'string' || preloadId.length === 0 || preloadId.length > 160) {
		throw new TypeError('Web VCR trusted preload registration returned an invalid identity.');
	}
	let disposed = false;
	return Object.freeze({
		dispose(): void {
			if (disposed) return;
			disposed = true;
			options.trustedAppSession.unregisterPreloadScript(preloadId);
		},
	});
}

function validateOptions(
	value: FramescaperWebVcrTrustedPreloadOptions,
): FramescaperWebVcrTrustedPreloadOptions {
	if (!value || typeof value !== 'object' || typeof value.productId !== 'string'
		|| typeof value.preloadPath !== 'string' || !isAbsolute(value.preloadPath)
		|| !value.trustedAppSession
		|| typeof value.trustedAppSession.registerPreloadScript !== 'function'
		|| typeof value.trustedAppSession.unregisterPreloadScript !== 'function') {
		throw new TypeError('Web VCR trusted preload registration seams are invalid.');
	}
	return value;
}
