/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectVideoPreviewMedia,
	ProjectVideoPreviewMediaRequest,
} from '../common/editor/controller/project-visual-service.ts';
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	validateVideoTimingAssetBytes,
	type VideoTimingIndex,
} from '../common/editor/video-timing-asset.ts';
import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import { proveVideoProxyTimingConformance } from '../common/editor/video-proxy-timing-conformance.ts';
import {
	bindVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../common/editor/video-source-timing-views.ts';
import {
	createFramescaperVideoProxyBodySourceV18,
	type FramescaperVideoProxyBodyStoreV18,
} from './editor-video-proxy-body-source-v18.ts';
import type {
	FramescaperVideoProxyBodyLeaseV18,
	FramescaperVideoProxyExpectedBodyV18,
} from './editor-video-proxy-reattestation-contract-v18.ts';
import {
	resolveFramescaperVideoProxyUseV20,
	type FramescaperVideoProxyModeV20,
	type FramescaperVideoProxyPressureV20,
} from './editor-video-proxy-use-policy-v20.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface FramescaperVideoProxyPreviewMediaOptionsV20 {
	readonly bodyStore: FramescaperVideoProxyBodyStoreV18;
	readonly originalStore: FramescaperVideoProxyOriginalStoreV20;
	getProject(): unknown;
	getMode(sourceId: string): FramescaperVideoProxyModeV20;
	getPressure(sourceId: string): Readonly<FramescaperVideoProxyPressureV20> | null;
}

export interface FramescaperVideoProxyOriginalStoreV20 {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<unknown>;
	resolveLinkedVideoOriginal?(
		projectId: string,
		source: Readonly<Record<string, unknown>>,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<Readonly<{ readonly blob: unknown }> | null>;
}

export type FramescaperVideoProxyPreviewMediaResolverV20 = (
	request: Readonly<ProjectVideoPreviewMediaRequest>,
) => Promise<Readonly<ProjectVideoPreviewMedia> | null>;

/** Verify and select a source-domain proxy before occurrence retime is evaluated. */
export function createFramescaperVideoProxyPreviewMediaResolverV20(
	options: FramescaperVideoProxyPreviewMediaOptionsV20,
): FramescaperVideoProxyPreviewMediaResolverV20 {
	assertOptions(options);
	return async (request) => {
		const sourceId = String(request?.source?.id ?? '');
		if (!sourceId || request.source.kind !== 'video'
			|| (request.project.schemaVersion !== 20 && request.project.schemaVersion !== 27)) return null;
		const mode = options.getMode(sourceId);
		if (mode === 'original') return null;
		let attachment: Readonly<VideoProxyAttachmentV18>;
		try {
			attachment = normalizeVideoProxyAttachmentV18(request.source.proxyAttachment);
			if (attachment.originalSha256 !== request.source.contentSha256) return null;
		} catch { return null; }
		throwIfAborted(request.signal);
		const originalAvailable = await hasOriginal(options.originalStore, request);
		const provisional = resolveFramescaperVideoProxyUseV20({
			purpose: 'preview', mode, originalAvailable, proxyTrust: 'attested',
			pressure: options.getPressure(sourceId),
		});
		if (provisional.kind !== 'proxy') return null;
		try {
			const body = await verifyProxy(options, request, attachment);
			const selection = resolveFramescaperVideoProxyUseV20({
				purpose: 'preview', mode, originalAvailable,
				proxyTrust: originalAvailable ? 'attested' : 'offline-verified',
				pressure: options.getPressure(sourceId),
			});
			return selection.kind === 'proxy'
				? Object.freeze({ body, mediaKind: 'proxy' as const })
				: null;
		} catch (error) {
			if (request.signal?.aborted) throw error;
			return null;
		}
	};
}

/** V27 retains the same web-core source/attachment carrier and verification route. */
export const createFramescaperVideoProxyPreviewMediaResolverV27 =
	createFramescaperVideoProxyPreviewMediaResolverV20;

async function verifyProxy(
	options: FramescaperVideoProxyPreviewMediaOptionsV20,
	request: Readonly<ProjectVideoPreviewMediaRequest>,
	attachment: Readonly<VideoProxyAttachmentV18>,
): Promise<Blob> {
	assertCurrent(options, request);
	const acquire = createFramescaperVideoProxyBodySourceV18({
		store: options.bodyStore,
		getProject: options.getProject,
	});
	const leases: FramescaperVideoProxyBodyLeaseV18[] = [];
	try {
		const proxy = await acquire(bodyRequest(request, proxyExpected(attachment)));
		leases.push(proxy);
		await assertBody(proxy, request.signal);
		const timing = await acquire(bodyRequest(request, timingExpected(attachment)));
		leases.push(timing);
		await assertBody(timing, request.signal);
		const proxyIndex = validateVideoTimingAssetBytes(
			attachment.timingAsset,
			new Uint8Array(await timing.body.arrayBuffer()),
		);
		throwIfAborted(request.signal);
		proveVideoProxyTimingConformance(
			originalTiming(request),
			proxyTiming(request.source, attachment, proxyIndex),
		);
		assertCurrent(options, request);
		for (const lease of leases) lease.assertCurrent();
		return proxy.body;
	} finally {
		for (const lease of [...leases].reverse()) await release(lease);
	}
}

async function hasOriginal(
	store: FramescaperVideoProxyOriginalStoreV20,
	request: Readonly<ProjectVideoPreviewMediaRequest>,
): Promise<boolean> {
	try {
		throwIfAborted(request.signal);
		const storageKey = String(request.source.storageKey || request.source.id);
		const owned = await store.loadMediaAsset(storageKey, signalOptions(request.signal));
		throwIfAborted(request.signal);
		if (owned !== null) return true;
		if (!store.resolveLinkedVideoOriginal) return false;
		const linked = await store.resolveLinkedVideoOriginal(
			request.project.id,
			request.source,
			signalOptions(request.signal),
		);
		throwIfAborted(request.signal);
		return linked?.blob != null;
	} catch (error) {
		if (request.signal?.aborted) throw error;
		return false;
	}
}

function originalTiming(request: Readonly<ProjectVideoPreviewMediaRequest>) {
	const source = request.source;
	const decision = source.timingDecision as Readonly<{ readonly mode?: unknown }> | undefined;
	let views: ReadonlyMap<string, VideoSourceTimingView>;
	if (decision?.mode === 'exact') {
		if (!request.sourceTimingIndex) {
			throw new Error(`Video source ${source.id} has no verified original timing index.`);
		}
		views = new Map([[source.id, Object.freeze({
			kind: 'vfr' as const,
			reference: source.timingAsset as never,
			index: request.sourceTimingIndex,
		})]]);
	} else {
		views = resolveVideoSourceTimingViews(Object.freeze({ sources: Object.freeze([source]) }));
	}
	return bindVideoSourceTimingView(views, source);
}

function proxyTiming(
	source: Readonly<Record<string, unknown>>,
	attachment: Readonly<VideoProxyAttachmentV18>,
	index: VideoTimingIndex,
) {
	const sourceId = `framescaper-proxy-preview:${attachment.sha256}`;
	const proxySource = Object.freeze({
		id: sourceId, kind: 'video', contentSha256: attachment.sha256,
		frameRate: source.frameRate, sourceFrameCount: attachment.frameCount,
		timingAsset: attachment.timingAsset,
		timingDecision: Object.freeze({ mode: 'exact', rate: source.frameRate }),
	});
	return bindVideoSourceTimingView(new Map([[sourceId, Object.freeze({
		kind: 'vfr' as const, reference: attachment.timingAsset, index,
	})]]), proxySource);
}

function proxyExpected(
	attachment: Readonly<VideoProxyAttachmentV18>,
): FramescaperVideoProxyExpectedBodyV18 {
	return Object.freeze({
		role: 'proxy', kind: 'video-proxy', encoding: 'video-proxy-v1',
		storageKey: attachment.storageKey, mimeType: attachment.mimeType,
		byteLength: attachment.byteLength, sha256: attachment.sha256,
	});
}

function timingExpected(
	attachment: Readonly<VideoProxyAttachmentV18>,
): FramescaperVideoProxyExpectedBodyV18 {
	return Object.freeze({
		role: 'timing', kind: 'video-timing', encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: attachment.timingAsset.storageKey, mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		byteLength: attachment.timingAsset.byteLength, sha256: attachment.timingAsset.sha256,
		frameCount: attachment.timingAsset.frameCount,
		timescale: attachment.timingAsset.timescale,
		finalFrameDurationTicks: attachment.timingAsset.finalFrameDurationTicks,
	});
}

function bodyRequest(
	request: Readonly<ProjectVideoPreviewMediaRequest>,
	expected: FramescaperVideoProxyExpectedBodyV18,
) {
	return Object.freeze({
		projectId: request.project.id, sourceId: request.source.id, role: expected.role, expected,
		...(request.signal ? { signal: request.signal } : {}),
	});
}

async function assertBody(
	lease: FramescaperVideoProxyBodyLeaseV18,
	signal?: AbortSignal,
): Promise<void> {
	lease.assertCurrent();
	if (lease.body.type !== lease.identity.mimeType
		|| await digestMediaContent(lease.body, { signal }) !== lease.identity.sha256) {
		throw new Error('The Framescaper editorial proxy body failed its immutable binding.');
	}
	lease.assertCurrent();
}

function assertCurrent(
	options: FramescaperVideoProxyPreviewMediaOptionsV20,
	request: Readonly<ProjectVideoPreviewMediaRequest>,
): void {
	throwIfAborted(request.signal);
	if (options.getProject() !== request.project) {
		throw new DOMException('The Framescaper proxy preview project changed.', 'AbortError');
	}
}

function assertOptions(options: FramescaperVideoProxyPreviewMediaOptionsV20): void {
	if (!options?.bodyStore || !options.originalStore
		|| typeof options.getProject !== 'function' || typeof options.getMode !== 'function'
		|| typeof options.getPressure !== 'function') {
		throw new TypeError('Framescaper proxy preview-media ports are incomplete.');
	}
}

async function release(lease: { release(): Awaitable<void> }): Promise<void> {
	try { await lease.release(); } catch { /* the body is already unpinned */ }
}

function signalOptions(signal?: AbortSignal) {
	return signal ? { signal } : undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
