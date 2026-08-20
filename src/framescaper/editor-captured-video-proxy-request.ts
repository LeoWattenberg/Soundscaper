/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCapturedVideoProxyRequest } from '../common/editor/controller/framescaper-capture-derivative-scheduler.ts';

export function normalizeCapturedVideoProxyRequest(
	value: FramescaperCapturedVideoProxyRequest,
): FramescaperCapturedVideoProxyRequest {
	if (!value || typeof value !== 'object') throw new TypeError('A captured proxy request is required.');
	const projectId = identifier(value.projectId, 'project ID');
	const sessionId = identifier(value.sessionId, 'session ID');
	const sourceId = identifier(value.sourceId, 'source ID');
	if (!Number.isSafeInteger(value.expectedProjectRevision) || value.expectedProjectRevision < 0) {
		throw new RangeError('The captured proxy expected revision is invalid.');
	}
	if (!/^[a-f0-9]{64}$/u.test(value.expectedContentSha256)) {
		throw new TypeError('The captured proxy source digest is invalid.');
	}
	return Object.freeze({
		projectId, sessionId, sourceId,
		expectedProjectRevision: value.expectedProjectRevision,
		expectedContentSha256: value.expectedContentSha256,
	});
}

export function capturedVideoProxyOperationIdentifier(request: FramescaperCapturedVideoProxyRequest): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for captured proxy publication.');
	return `captured-proxy-${request.sessionId.slice(0, 48)}-${request.sourceId.slice(0, 48)}-${uuid}`;
}

export function capturedVideoProxyOperationKey(request: FramescaperCapturedVideoProxyRequest): string {
	return [
		request.sessionId,
		request.projectId,
		String(request.expectedProjectRevision),
		request.sourceId,
		request.expectedContentSha256,
	].join('\u0000');
}

export function capturedVideoProxyLineageKey(request: FramescaperCapturedVideoProxyRequest): string {
	return `${request.sessionId}\u0000${request.projectId}\u0000${String(request.expectedProjectRevision)}`;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError(`A bounded printable captured proxy ${name} is required.`);
	}
	return value;
}
