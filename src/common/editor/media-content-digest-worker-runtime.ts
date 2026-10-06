/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob, digestMediaContent } from './storage/media-content-digest.ts';

export async function executeMediaContentDigestRequest(value: unknown) {
	let requestId: string | null = null;
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A media digest request is required.');
		const request = value as Readonly<Record<string, unknown>>;
		if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 160) throw new TypeError('A bounded request id is required.');
		requestId = request.requestId;
		const result = await digestMediaContent(canonicalMediaContentBlob(request.blob));
		return { type: 'result' as const, requestId, result };
	} catch (error) {
		return { type: 'error' as const, requestId, error: {
			name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error),
		} };
	}
}
