/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingIndex,
} from '../src/common/editor/video-timing-asset.ts';
import type {
	FramescaperVideoProxyModeRetime,
	FramescaperVideoProxyPressureRetime,
} from '../src/framescaper/editor-video-proxy-use-policy-retime.ts';
import {
	createFramescaperVideoProxyPreviewMediaResolverFinishing,
	createFramescaperVideoProxyPreviewMediaResolverNativeMedia,
	createFramescaperVideoProxyPreviewMediaResolverRetime,
	createFramescaperVideoProxyPreviewMediaResolverTimelineImage,
	FramescaperVideoProxyPreviewUnavailableError,
	type FramescaperVideoProxyPreviewMediaOptionsRetime,
	type FramescaperVideoProxyPreviewMediaResolverRetime,
} from '../src/framescaper/editor-video-proxy-preview-media-retime.ts';

type Data = Record<string, unknown>;
type PreviewRequest = Parameters<FramescaperVideoProxyPreviewMediaResolverRetime>[0];
type Pressure = Readonly<FramescaperVideoProxyPressureRetime> | null;

const PROXY_BYTES = Uint8Array.from({ length: 96 }, (_, index) => (index * 7) % 251);
const PROXY_SHA256 = createHash('sha256').update(PROXY_BYTES).digest('hex');
const ORIGINAL_SHA256 = 'b'.repeat(64);
const PROXY_KEY = `video-proxy-sha256:${PROXY_SHA256}`;
const FRAME_RATE = Object.freeze({ num: 25, den: 1 });

/** Both assets describe the same 25 fps boundaries, one in milliseconds and one in 90 kHz ticks. */
const PROXY_TIMING = createVideoTimingAssetPublication(PROXY_SHA256, {
	timescale: 1_000,
	presentationTicks: [0n, 40n, 80n],
	finalFrameDurationTicks: 40n,
});
const ORIGINAL_TIMING = createVideoTimingAssetPublication(ORIGINAL_SHA256, {
	timescale: 90_000,
	presentationTicks: [0n, 3_600n, 7_200n],
	finalFrameDurationTicks: 3_600n,
});
const TIMING_KEY = PROXY_TIMING.reference.storageKey;

const PRESSURE = Object.freeze({ droppedFrameRatio: 0.4, decodeQueueDepth: 0, viewportScale: 1 });
const CALM = Object.freeze({ droppedFrameRatio: 0, decodeQueueDepth: 1, viewportScale: 1 });

function attachment(overrides: Data = {}): Data {
	return {
		kind: 'video-proxy-attachment',
		version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: PROXY_KEY,
		mimeType: 'video/mp4',
		byteLength: PROXY_BYTES.byteLength,
		sha256: PROXY_SHA256,
		originalSha256: ORIGINAL_SHA256,
		originalAuthorityKind: 'owned',
		generatorId: 'framescaper-proxy',
		generatorVersion: 1,
		recipeId: 'editorial-h264',
		recipeVersion: 1,
		timingBackendId: 'exact-probe',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 3,
		boundaryCount: 4,
		timingAsset: { ...PROXY_TIMING.reference },
		audioPolicy: 'ignore-proxy-container-audio-v1',
		...overrides,
	};
}

function videoSource(overrides: Data = {}): Data {
	return {
		id: 'source-1',
		kind: 'video',
		storageKey: 'media/source-1',
		contentSha256: ORIGINAL_SHA256,
		frameRate: FRAME_RATE,
		sourceFrameCount: 3,
		timingAsset: null,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: FRAME_RATE },
		proxyAttachment: attachment(),
		...overrides,
	};
}

function bodies(overrides: Readonly<Record<string, Blob>> = {}): Map<string, Blob> {
	return new Map<string, Blob>([
		[PROXY_KEY, new Blob([PROXY_BYTES], { type: 'video/mp4' })],
		[TIMING_KEY, new Blob([PROXY_TIMING.bytes as Uint8Array<ArrayBuffer>], { type: VIDEO_TIMING_ASSET_MIME_TYPE })],
		...Object.entries(overrides),
	]);
}

interface HarnessSetup {
	readonly mode: FramescaperVideoProxyModeRetime;
	readonly source: Data;
	readonly bodies: Map<string, Blob>;
	readonly pressures: readonly Pressure[];
	readonly owned: unknown;
	readonly ownedThrows: boolean;
	readonly linked: (() => Readonly<{ blob: unknown }> | null) | null;
	readonly sourceTimingIndex: VideoTimingIndex | null;
	readonly signal: AbortSignal;
}

interface HarnessState {
	project: unknown;
	onLoad: ((storageKey: string) => void) | null;
	pressureCalls: number;
	readonly loads: string[];
	readonly loadSignals: (AbortSignal | undefined)[];
	readonly originalLoads: string[];
	readonly originalSignals: (AbortSignal | undefined)[];
	readonly trust: string[];
	readonly modeIds: string[];
}

interface PreviewHarness {
	readonly state: HarnessState;
	readonly request: {
		project: Data;
		source: Data;
		sourceTimingIndex: VideoTimingIndex | null;
		signal?: AbortSignal;
	};
	resolve(): ReturnType<FramescaperVideoProxyPreviewMediaResolverRetime>;
}

function harness(setup: Partial<HarnessSetup> = {}): PreviewHarness {
	const source = setup.source ?? videoSource();
	const project: Data = {
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1', revision: 1, sources: [source],
	};
	const stored = setup.bodies ?? bodies();
	const linked = setup.linked;
	const state: HarnessState = {
		project, onLoad: null, pressureCalls: 0,
		loads: [], loadSignals: [], originalLoads: [], originalSignals: [], trust: [], modeIds: [],
	};
	const options: FramescaperVideoProxyPreviewMediaOptionsRetime = {
		bodyStore: {
			async loadMediaAsset(storageKey, load) {
				state.loads.push(storageKey);
				state.loadSignals.push(load?.signal);
				state.onLoad?.(storageKey);
				return stored.get(storageKey) ?? null;
			},
		},
		originalStore: {
			async loadMediaAsset(storageKey, load) {
				state.originalLoads.push(storageKey);
				state.originalSignals.push(load?.signal);
				if (setup.ownedThrows) throw new Error('The retained original store is unreachable.');
				return setup.owned === undefined ? new Blob(['original']) : setup.owned;
			},
			...(linked ? { resolveLinkedVideoOriginal: async () => linked() } : {}),
		},
		getProject: () => state.project,
		getMode: (sourceId) => {
			state.modeIds.push(sourceId);
			return setup.mode ?? 'auto';
		},
		getPressure: () => {
			const index = state.pressureCalls;
			state.pressureCalls += 1;
			return setup.pressures?.[index] ?? null;
		},
		onTrustStatus: (_sourceId, _attachment, status) => { state.trust.push(status); },
	};
	const request: PreviewHarness['request'] = {
		project, source, sourceTimingIndex: setup.sourceTimingIndex ?? null,
		...(setup.signal ? { signal: setup.signal } : {}),
	};
	const resolve = createFramescaperVideoProxyPreviewMediaResolverRetime(options);
	return { state, request, resolve: () => resolve(request as unknown as PreviewRequest) };
}

function unavailable(reason: string, cause?: RegExp): (error: unknown) => boolean {
	return (error) => {
		assert.ok(error instanceof FramescaperVideoProxyPreviewUnavailableError);
		assert.equal(error.code, 'FRAMESCAPER_PROXY_PREVIEW_UNAVAILABLE');
		assert.equal(error.reason, reason);
		if (cause) assert.match(String((error.cause as Error | undefined)?.message), cause);
		return true;
	};
}

test('a verified attachment resolves to a frozen proxy body in forced proxy mode', async () => {
	const rig = harness({ mode: 'proxy' });

	const media = await rig.resolve();

	assert.ok(media);
	assert.equal(media.mediaKind, 'proxy');
	assert.equal(media.body.size, PROXY_BYTES.byteLength);
	assert.equal(media.body.type, 'video/mp4');
	assert.equal(Object.isFrozen(media), true);
	assert.deepEqual(rig.state.loads, [PROXY_KEY, TIMING_KEY]);
	assert.deepEqual(rig.state.loadSignals, [undefined, undefined]);
	assert.deepEqual(rig.state.originalLoads, ['media/source-1']);
	assert.deepEqual(rig.state.originalSignals, [undefined]);
	assert.deepEqual(rig.state.modeIds, ['source-1']);
	assert.deepEqual(rig.state.trust, ['unverified', 'verified']);
});

test('auto mode keeps an available original and never reads a proxy body', async () => {
	const rig = harness({ mode: 'auto' });

	assert.equal(await rig.resolve(), null);
	assert.deepEqual(rig.state.loads, []);
	assert.deepEqual(rig.state.originalLoads, ['media/source-1']);
	assert.deepEqual(rig.state.trust, ['unverified']);
});

test('original mode declines the attachment before any store is consulted', async () => {
	const rig = harness({ mode: 'original' });

	assert.equal(await rig.resolve(), null);
	assert.deepEqual(rig.state.loads, []);
	assert.deepEqual(rig.state.originalLoads, []);
	assert.deepEqual(rig.state.trust, ['unverified']);
});

test('auto mode serves the verified proxy while playback pressure is reported', async () => {
	const rig = harness({ mode: 'auto', pressures: [PRESSURE, PRESSURE] });

	const media = await rig.resolve();

	assert.equal(media?.mediaKind, 'proxy');
	assert.equal(media?.body.size, PROXY_BYTES.byteLength);
	assert.deepEqual(rig.state.trust, ['unverified', 'verified']);
	assert.equal(rig.state.pressureCalls, 2);
});

test('pressure that clears while the bodies are verified declines the verified proxy', async () => {
	const rig = harness({ mode: 'auto', pressures: [PRESSURE, CALM] });

	assert.equal(await rig.resolve(), null);
	assert.deepEqual(rig.state.loads, [PROXY_KEY, TIMING_KEY]);
	assert.deepEqual(rig.state.trust, ['unverified', 'verified']);
});

test('auto mode serves the verified proxy when no original is retained', async () => {
	const rig = harness({ mode: 'auto', owned: null });

	const media = await rig.resolve();

	assert.equal(media?.mediaKind, 'proxy');
	assert.deepEqual(rig.state.trust, ['unverified', 'verified']);
});

test('a resolvable linked original keeps auto mode on the original', async () => {
	const kept = harness({ mode: 'auto', owned: null, linked: () => ({ blob: new Blob(['linked']) }) });
	const unresolved = harness({ mode: 'auto', owned: null, linked: () => null });

	assert.equal(await kept.resolve(), null);
	assert.deepEqual(kept.state.loads, []);
	assert.equal((await unresolved.resolve())?.mediaKind, 'proxy');
});

test('an original store that fails is read as offline rather than fatal', async () => {
	const owned = harness({ mode: 'auto', ownedThrows: true });
	const link = harness({
		mode: 'auto',
		owned: null,
		linked: () => { throw new Error('The linked original binding is unreadable.'); },
	});

	assert.equal((await owned.resolve())?.mediaKind, 'proxy');
	assert.equal((await link.resolve())?.mediaKind, 'proxy');
});

test('an attachment bound to a different original digest is refused as stale', async () => {
	const auto = harness({ mode: 'auto', source: videoSource({ contentSha256: 'd'.repeat(64) }) });
	const forced = harness({ mode: 'proxy', source: videoSource({ contentSha256: 'd'.repeat(64) }) });

	assert.equal(await auto.resolve(), null);
	assert.deepEqual(auto.state.trust, ['unverified', 'stale']);
	assert.deepEqual(auto.state.originalLoads, []);
	await assert.rejects(() => forced.resolve(), unavailable('attachment-stale'));
});

test('a proxy body the store cannot produce fails verification', async () => {
	const missing = bodies();
	missing.delete(PROXY_KEY);
	const forced = harness({ mode: 'proxy', bodies: missing });
	const auto = harness({ mode: 'auto', bodies: missing, pressures: [PRESSURE, PRESSURE] });

	await assert.rejects(
		() => forced.resolve(),
		unavailable('verification-failed', /proxy body .* is missing/u),
	);
	assert.equal(await auto.resolve(), null);
	assert.deepEqual(auto.state.trust, ['unverified', 'unavailable']);
});

test('a proxy body that fails its digest or MIME binding is refused', async () => {
	const rewritten = new Blob([PROXY_BYTES.slice().fill(9)], { type: 'video/mp4' });
	const retyped = new Blob([PROXY_BYTES], { type: 'video/quicktime' });

	for (const body of [rewritten, retyped]) {
		const rig = harness({ mode: 'proxy', bodies: bodies({ [PROXY_KEY]: body }) });
		await assert.rejects(
			() => rig.resolve(),
			unavailable('verification-failed', /failed its immutable binding/u),
		);
	}
});

test('a timing body of the wrong length is refused before it is decoded', async () => {
	const truncated = new Blob([PROXY_TIMING.bytes.slice(0, 40)], { type: VIDEO_TIMING_ASSET_MIME_TYPE });
	const rig = harness({ mode: 'proxy', bodies: bodies({ [TIMING_KEY]: truncated }) });

	await assert.rejects(
		() => rig.resolve(),
		unavailable('verification-failed', /timing body .* is 40 bytes, not 56/u),
	);
	assert.deepEqual(rig.state.loads, [PROXY_KEY, TIMING_KEY]);
});

test('proxy timing that does not own the original boundaries fails conformance', async () => {
	const rate = { num: 30, den: 1 };
	const rebased = harness({
		mode: 'proxy',
		source: videoSource({ frameRate: rate, timingDecision: { mode: 'conform-cfr-at-ingest', rate } }),
	});
	const recounted = harness({ mode: 'proxy', source: videoSource({ sourceFrameCount: 4 }) });

	await assert.rejects(
		() => rebased.resolve(),
		unavailable('verification-failed', /boundary 1 does not conform exactly/u),
	);
	await assert.rejects(
		() => recounted.resolve(),
		unavailable('verification-failed', /frame counts must match exactly/u),
	);
});

test('an exact-timing original without a verified timing index refuses the proxy', async () => {
	const rig = harness({
		mode: 'proxy',
		source: videoSource({
			timingAsset: { ...ORIGINAL_TIMING.reference },
			timingDecision: { mode: 'exact', rate: FRAME_RATE },
		}),
	});

	await assert.rejects(
		() => rig.resolve(),
		unavailable('verification-failed', /source-1 has no verified original timing index/u),
	);
});

test('an exact-timing original verified against its own asset conforms with the proxy', async () => {
	const index = validateVideoTimingAssetBytes({ ...ORIGINAL_TIMING.reference }, ORIGINAL_TIMING.bytes);
	const rig = harness({
		mode: 'proxy',
		sourceTimingIndex: index,
		source: videoSource({
			timingAsset: { ...ORIGINAL_TIMING.reference },
			timingDecision: { mode: 'exact', rate: FRAME_RATE },
		}),
	});

	const media = await rig.resolve();

	assert.equal(media?.mediaKind, 'proxy');
	assert.deepEqual(rig.state.trust, ['unverified', 'verified']);
});

test('a source without a persisted timing decision cannot be conformed', async () => {
	const rig = harness({ mode: 'proxy', source: videoSource({ timingDecision: null }) });

	await assert.rejects(
		() => rig.resolve(),
		unavailable('verification-failed', /timingDecision must be an object/u),
	);
});

test('a project replaced while the bodies are read refuses the proxy', async () => {
	const swapped = harness({ mode: 'proxy' });
	swapped.state.onLoad = (storageKey) => {
		if (storageKey === TIMING_KEY) swapped.state.project = { ...swapped.request.project };
	};
	const dropped = harness({ mode: 'proxy' });
	dropped.state.onLoad = (storageKey) => {
		if (storageKey !== TIMING_KEY) return;
		dropped.state.project = {
			...dropped.request.project,
			sources: [{ ...dropped.request.source, proxyAttachment: null }],
		};
	};

	await assert.rejects(
		() => swapped.resolve(),
		unavailable('verification-failed', /proxy preview project changed/u),
	);
	await assert.rejects(
		() => dropped.resolve(),
		unavailable('verification-failed', /no longer has a proxy attachment/u),
	);
});

test('an aborted preview rethrows the abort reason instead of reporting the proxy unavailable', async () => {
	const early = new AbortController();
	const earlyReason = new Error('The preview was superseded.');
	const pending = harness({ mode: 'proxy', signal: early.signal });
	early.abort(earlyReason);

	await assert.rejects(() => pending.resolve(), (error: unknown) => error === earlyReason);
	assert.deepEqual(pending.state.trust, ['unverified']);
	assert.deepEqual(pending.state.loads, []);

	const late = new AbortController();
	const lateReason = new Error('The preview was cancelled mid-verification.');
	const running = harness({ mode: 'proxy', signal: late.signal });
	running.state.onLoad = (storageKey) => { if (storageKey === TIMING_KEY) late.abort(lateReason); };

	await assert.rejects(() => running.resolve(), (error: unknown) => error === lateReason);
	assert.deepEqual(running.state.trust, ['unverified']);
	assert.deepEqual(running.state.loadSignals, [late.signal, late.signal]);
	assert.deepEqual(running.state.originalSignals, [late.signal]);
});

test('an out-of-contract pressure reading is refused rather than silently ignored', async () => {
	const rig = harness({
		mode: 'auto',
		pressures: ['none' as unknown as Readonly<FramescaperVideoProxyPressureRetime>],
	});

	await assert.rejects(() => rig.resolve(), TypeError);
});

test('the finishing, native-media and timeline-image resolvers share one source-domain factory', () => {
	assert.equal(
		createFramescaperVideoProxyPreviewMediaResolverFinishing,
		createFramescaperVideoProxyPreviewMediaResolverRetime,
	);
	assert.equal(
		createFramescaperVideoProxyPreviewMediaResolverNativeMedia,
		createFramescaperVideoProxyPreviewMediaResolverRetime,
	);
	assert.equal(
		createFramescaperVideoProxyPreviewMediaResolverTimelineImage,
		createFramescaperVideoProxyPreviewMediaResolverRetime,
	);
});
