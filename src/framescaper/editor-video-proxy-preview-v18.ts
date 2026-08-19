/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Deciding which picture the preview shows, and fetching it.
 *
 * The parts of this decision have all existed: re-attestation can re-prove a
 * persisted attachment against the original as it stands now, and
 * `selectFramescaperVideoProxyV18` turns that proof plus the current identities
 * into one answer — proxy, original, or unavailable. What was missing was
 * anything that asked. This asks, once per source, and hands back a body the
 * preview can show.
 *
 * Three properties are not negotiable and are why this is a composition rather
 * than a shortcut.
 *
 * **Trust is process-local and preview-only.** It is minted by re-attestation
 * for this session, against these bytes, and it is passed straight to the
 * selector, which refuses to answer `proxy` for any purpose but preview. Export
 * and delivery ask the same selector and always get the original, so what
 * lands in a file is never what the preview optimised.
 *
 * **Nothing is trusted from the document.** A persisted attachment proves that
 * a proxy was made, not that these bytes are it. The digests, the timing
 * validation, and the conformance rerun happen every session before a single
 * frame is shown, and any failure returns the original rather than a picture
 * that might not line up.
 *
 * **A failure is never fatal.** A missing body, a collected claim, a copy that
 * travelled without its bodies, an original that moved — each one means the
 * preview shows the original, which is always correct and merely slower. A
 * proxy is an optimisation, and an optimisation that throws is worse than one
 * that declines.
 */

import type { BoundVideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../common/editor/video-timing-asset-reference.ts';
import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import {
	createFramescaperVideoProxyReattestationAuthorityV18,
	reattestFramescaperVideoProxyAttachmentV18,
} from './editor-video-proxy-reattestation-v18.ts';
import type {
	FramescaperVideoProxyBodyLeaseV18,
	FramescaperVideoProxyBodyRequestV18,
	FramescaperVideoProxyOriginalLeaseV18,
	FramescaperVideoProxyOriginalRequestV18,
} from './editor-video-proxy-reattestation-contract-v18.ts';
import { selectFramescaperVideoProxyV18 } from './editor-video-proxy-selection-v18.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface FramescaperVideoProxyPreviewPortsV18 {
	readonly profile: unknown;
	getProject(): unknown;
	captureTask(): unknown;
	assertTaskCurrent(token: unknown): void;
	acquireBody(
		request: Readonly<FramescaperVideoProxyBodyRequestV18>,
	): Awaitable<FramescaperVideoProxyBodyLeaseV18>;
	observeOriginal(
		request: Readonly<FramescaperVideoProxyOriginalRequestV18>,
	): Awaitable<FramescaperVideoProxyOriginalLeaseV18>;
}

export type FramescaperVideoProxyPreviewV18 = Readonly<
	| {
		readonly kind: 'proxy';
		readonly sourceId: string;
		readonly body: Blob;
		readonly mimeType: string;
		readonly timing: BoundVideoSourceTimingView;
		readonly audioPolicy: 'ignore-proxy-container-audio-v1';
	}
	| { readonly kind: 'original'; readonly sourceId: string; readonly reason: PreviewOriginalReason }
>;

export type PreviewOriginalReason =
	| 'no-attachment'
	| 'not-attested'
	| 'not-selected'
	| 'body-unavailable';

export interface FramescaperVideoProxyPreviewRequestV18 {
	readonly sourceId: string;
	readonly signal?: AbortSignal;
}

/** Answer the picture the preview should show for one source. */
export async function resolveFramescaperVideoProxyPreviewV18(
	ports: FramescaperVideoProxyPreviewPortsV18,
	request: FramescaperVideoProxyPreviewRequestV18,
): Promise<FramescaperVideoProxyPreviewV18> {
	const sourceId = nonEmpty(request?.sourceId, 'source');
	const source = videoSource(ports.getProject(), sourceId);
	const attachment = source?.proxyAttachment as Readonly<VideoProxyAttachmentV18> | null | undefined;
	// The overwhelmingly common case, answered without touching storage.
	if (!source || !attachment) return original(sourceId, 'no-attachment');

	const projectId = String((ports.getProject() as Readonly<{ id?: unknown }>)?.id ?? '');
	let originalLease: FramescaperVideoProxyOriginalLeaseV18 | null = null;
	let bodyLease: FramescaperVideoProxyBodyLeaseV18 | null = null;
	try {
		originalLease = await ports.observeOriginal({
			projectId,
			sourceId,
			storageKey: String(source.storageKey ?? source.id),
			mimeType: String(source.mimeType ?? ''),
			contentSha256: String(source.contentSha256 ?? ''),
			...(request.signal ? { signal: request.signal } : {}),
		});

		const authority = createFramescaperVideoProxyReattestationAuthorityV18({
			profile: ports.profile,
			getProject: () => ports.getProject(),
			captureTask: () => ports.captureTask(),
			assertTaskCurrent: (token: unknown) => { ports.assertTaskCurrent(token); },
			acquireBody: (bodyRequest: Readonly<FramescaperVideoProxyBodyRequestV18>) => (
				ports.acquireBody(bodyRequest)
			),
			observeOriginal: (originalRequest: Readonly<FramescaperVideoProxyOriginalRequestV18>) => (
				ports.observeOriginal(originalRequest)
			),
		} as never);
		const attested = await reattestFramescaperVideoProxyAttachmentV18(authority, {
			sourceId,
			...(request.signal ? { signal: request.signal } : {}),
		});

		const selection = selectFramescaperVideoProxyV18({
			purpose: 'preview',
			trust: attested.trust,
			choice: attested.choice,
			currentOriginal: originalLease.identity,
			currentProxy: bodyIdentity(attachment, 'proxy'),
			currentTiming: bodyIdentity(attachment, 'timing'),
		});
		if (selection.kind !== 'proxy') return original(sourceId, 'not-selected');

		bodyLease = await ports.acquireBody({
			projectId,
			sourceId,
			role: 'proxy',
			expected: bodyIdentity(attachment, 'proxy'),
			...(request.signal ? { signal: request.signal } : {}),
		} as never);
		return Object.freeze({
			kind: 'proxy',
			sourceId,
			body: bodyLease.body,
			mimeType: selection.mimeType,
			timing: selection.timing,
			audioPolicy: selection.audioPolicy,
		});
	} catch (error) {
		// An aborted preview is the caller's own cancellation and stays an abort;
		// everything else means this session cannot vouch for the proxy, and the
		// original is the answer rather than the error.
		if ((error as Error)?.name === 'AbortError' && request.signal?.aborted) throw error;
		return original(sourceId, attestationReason(error));
	} finally {
		await release(bodyLease);
		await release(originalLease);
	}
}

function attestationReason(error: unknown): PreviewOriginalReason {
	const message = String((error as Error)?.message ?? '');
	return /is missing|bytes, not|no longer/u.test(message) ? 'body-unavailable' : 'not-attested';
}

function bodyIdentity(
	attachment: Readonly<VideoProxyAttachmentV18>,
	role: 'proxy' | 'timing',
): Readonly<Record<string, unknown>> {
	if (role === 'timing') {
		const timing = attachment.timingAsset;
		return Object.freeze({
			role: 'timing',
			kind: 'video-timing',
			encoding: VIDEO_TIMING_ASSET_ENCODING,
			storageKey: timing.storageKey,
			// The timing reference records no MIME of its own — the encoding names
			// the format, and the media type is the one that encoding is stored as.
			mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
			byteLength: timing.byteLength,
			sha256: timing.sha256,
			frameCount: timing.frameCount,
			timescale: timing.timescale,
			finalFrameDurationTicks: timing.finalFrameDurationTicks,
			generationToken: `video-timing:${timing.sha256}`,
		});
	}
	return Object.freeze({
		role: 'proxy',
		kind: 'video-proxy',
		encoding: 'video-proxy-v1',
		storageKey: attachment.storageKey,
		mimeType: attachment.mimeType,
		byteLength: attachment.byteLength,
		sha256: attachment.sha256,
		generationToken: `video-proxy:${attachment.sha256}`,
	});
}

function videoSource(project: unknown, sourceId: string): Readonly<Record<string, unknown>> | null {
	const record = (project && typeof project === 'object' ? project : null) as
		| Readonly<{ sources?: readonly Readonly<Record<string, unknown>>[] }>
		| null;
	const source = record?.sources?.find((candidate) => candidate?.id === sourceId);
	return source && source.kind === 'video' ? source : null;
}

function original(sourceId: string, reason: PreviewOriginalReason): FramescaperVideoProxyPreviewV18 {
	return Object.freeze({ kind: 'original', sourceId, reason });
}

async function release(lease: { release(): Awaitable<void> } | null): Promise<void> {
	if (!lease) return;
	try { await lease.release(); } catch { /* a lease that cannot be released is already gone */ }
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) {
		throw new TypeError(`A video proxy preview ${name} ID is required.`);
	}
	return value;
}
