/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import type { FramescaperCapturedVideoProxyProject } from './editor-captured-video-proxy-preservation.ts';

export function capturedVideoProxySource(
	project: FramescaperCapturedVideoProxyProject,
	sourceId: string,
): Record<string, unknown> & { proxyAttachment: VideoProxyAttachmentV18 | null } {
	const sources = (project as unknown as {
		readonly sources: readonly Readonly<Record<string, unknown>>[];
	}).sources;
	const matches = sources.filter((source) => source.id === sourceId);
	if (matches.length !== 1 || matches[0]!.kind !== 'video') {
		throw new ReferenceError(`Captured video proxy source ${sourceId} is missing or ambiguous.`);
	}
	return matches[0] as unknown as Record<string, unknown> & {
		proxyAttachment: VideoProxyAttachmentV18 | null;
	};
}

export function assertMatchingCapturedVideoProxyAttachment(
	source: Readonly<Record<string, unknown>>,
	digest: string,
): void {
	const attachment = source.proxyAttachment as Readonly<Record<string, unknown>> | null;
	if (!attachment || attachment.originalSha256 !== digest) {
		throw new Error('The captured video already has a proxy for a different source generation.');
	}
}

export function capturedVideoProxyAbortError(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}

export function throwIfCapturedVideoProxyAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw capturedVideoProxyAbortError('Captured video proxy work was cancelled.');
}
