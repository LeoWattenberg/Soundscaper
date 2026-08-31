/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoKeyframeOfflineHtmlVideoSourceResolver,
	type VideoKeyframeOfflineHtmlVideoSourceResolverOptions,
} from '../src/common/editor/ui/video-keyframe-offline-html-video-source-resolver.ts';
import type { VideoRetimePreviewMediaPort } from '../src/common/editor/video-retime-preview-executor.ts';

const SOURCE_ID = 'video-source';
const SOURCE_SHA256 = '12'.repeat(32);
const CLIP_ID = 'ordinary-clip';

test('resolver owns one digest-bound paused video lifecycle and exact ordinary presentation', async () => {
	const harness = runtimeHarness();
	const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(harness));
	assert.equal(Object.isFrozen(resolver), true);
	const signal = new AbortController().signal;
	const first = await resolver.resolveSource(entry(), { signal });
	const second = await resolver.resolveSource(entry(), { signal });
	assert.strictEqual(second, first);
	assert.deepEqual({
		sourceId: first.sourceId,
		identity: first.identity,
		decoded: [first.decodedWidth, first.decodedHeight],
		display: [first.displayWidth, first.displayHeight],
	}, {
		sourceId: SOURCE_ID,
		identity: SOURCE_SHA256,
		decoded: [64, 32],
		display: [80, 32],
	});
	await first.present(entry({ sourceTimeSeconds: 9_999 }), { signal });
	assert.equal(harness.seekRequests.length, 1);
	const seekRequest = harness.seekRequests[0]!;
	assert.deepEqual({ ...seekRequest, signal: undefined }, {
		drawableSourceFrame: 0,
		intervalStartSeconds: 0,
		intervalEndSeconds: 0.04,
		targetSeconds: 0.02,
		signal: undefined,
	});
	assert.ok(seekRequest.signal instanceof AbortSignal);
	assert.notStrictEqual(seekRequest.signal, signal);
	assert.equal(harness.videos[0]?.paused, true);
	assert.equal(harness.videos[0]?.isConnected, true);
	assert.deepEqual(harness.videos[0]?.style, {
		position: 'fixed',
		left: '-10000px',
		top: '0px',
		width: '1px',
		height: '1px',
		pointerEvents: 'none',
	});
	first.dispose();
	assert.deepEqual(harness.revoked, ['blob:offline-1']);
	assert.equal(harness.videos[0]?.removed, true);
	assert.equal(harness.videos[0]?.isConnected, false);
	await assert.rejects(
		Promise.resolve(first.present(entry(), { signal })),
		/current|closed|disposed/iu,
	);
	const replacement = await resolver.resolveSource(entry(), { signal });
	assert.notStrictEqual(replacement, first);
	resolver.dispose();
	assert.deepEqual(harness.revoked, ['blob:offline-1', 'blob:offline-2']);
});

test('resolver accepts a browser drawable that already applied the admitted display aspect', async () => {
	const harness = runtimeHarness({ decodedWidth: 80 });
	const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(harness));
	const presentation = await resolver.resolveSource(entry(), {
		signal: new AbortController().signal,
	});
	assert.deepEqual({
		decoded: [presentation.decodedWidth, presentation.decodedHeight],
		display: [presentation.displayWidth, presentation.displayHeight],
	}, {
		decoded: [80, 32],
		display: [80, 32],
	});
	presentation.dispose();
	resolver.dispose();
	assert.deepEqual(harness.revoked, ['blob:offline-1']);
});

test('resolver waits for current frame data after metadata before exposing a presentation', async () => {
	const harness = runtimeHarness({ frameData: 'pending' });
	const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(harness));
	let resolved = false;
	const pending = Promise.resolve(resolver.resolveSource(entry(), {
		signal: new AbortController().signal,
	})).then((presentation) => {
		resolved = true;
		return presentation;
	});
	await new Promise((resolve) => { setTimeout(resolve, 0); });
	assert.equal(resolved, false);
	harness.videos[0]?.publishLoadedData();
	const presentation = await pending;
	assert.equal(harness.videos[0]?.readyState, 2);
	presentation.dispose();
	resolver.dispose();
});

test('resolver owns a distinct reusable decoder for each clip occurrence of one source', async () => {
	const harness = runtimeHarness();
	const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(harness));
	const signal = new AbortController().signal;
	const ordinaryEntry = entry();
	const retimedEntry = entry({
		clipId: 'retimed-clip',
		clip: Object.freeze({ kind: 'video', id: 'retimed-clip', sourceId: SOURCE_ID }),
	});
	const ordinary = await resolver.resolveSource(ordinaryEntry, { signal });
	const retimed = await resolver.resolveSource(retimedEntry, { signal });
	assert.notStrictEqual(ordinary, retimed);
	assert.notStrictEqual(ordinary.drawable, retimed.drawable);
	assert.strictEqual(await resolver.resolveSource(ordinaryEntry, { signal }), ordinary);
	assert.strictEqual(await resolver.resolveSource(retimedEntry, { signal }), retimed);
	assert.equal(harness.videos.length, 2);
	resolver.dispose();
	assert.deepEqual(harness.revoked, ['blob:offline-1', 'blob:offline-2']);
});

test('resolver refuses hostile metadata, duplicate IDs, and entry identity mismatch before media work', async () => {
	for (const mutate of [
		(source: Record<string, unknown>) => {
			Object.defineProperty(source, 'identity', {
				enumerable: true,
				get: () => { throw new Error('must not invoke'); },
			});
		},
		(source: Record<string, unknown>) => { source.identity = 'not-a-digest'; },
	] as const) {
		const harness = runtimeHarness();
		const candidate = sourceAsset() as unknown as Record<string, unknown>;
		mutate(candidate);
		assert.throws(
			() => createVideoKeyframeOfflineHtmlVideoSourceResolver(options(harness, [candidate])),
			/data property|digest/iu,
		);
		assert.equal(harness.videos.length, 0);
	}
	const duplicateHarness = runtimeHarness();
	assert.throws(() => createVideoKeyframeOfflineHtmlVideoSourceResolver(options(
		duplicateHarness, [sourceAsset(), sourceAsset()],
	)), /duplicate.*source/iu);
	assert.equal(duplicateHarness.videos.length, 0);

	const mismatchHarness = runtimeHarness();
	const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(mismatchHarness));
	await assert.rejects(Promise.resolve(resolver.resolveSource(entry({
		source: { ...source(), contentSha256: '34'.repeat(32) },
	}), { signal: new AbortController().signal })), /identity|digest/iu);
	assert.equal(mismatchHarness.videos.length, 0);
	resolver.dispose();
});

test('resolver rejects forged timing callback output before seeking and retires geometry failures', async () => {
	const harness = runtimeHarness();
	const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(harness, [sourceAsset({
		presentationForEntry: () => ({ sourceTimeSeconds: 0 }),
	})]));
	const signal = new AbortController().signal;
	const presentation = await resolver.resolveSource(entry(), { signal });
	await assert.rejects(
		Promise.resolve(presentation.present(entry(), { signal })),
		/descriptor|field shape|outerCell/iu,
	);
	assert.equal(harness.seekRequests.length, 0);
	presentation.dispose();
	resolver.dispose();

	const geometryHarness = runtimeHarness({ decodedWidth: 63 });
	const geometryResolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(geometryHarness));
	await assert.rejects(
		Promise.resolve(geometryResolver.resolveSource(entry(), { signal })),
		/geometry|dimensions|64x32/iu,
	);
	assert.deepEqual(geometryHarness.revoked, ['blob:offline-1']);
	geometryResolver.dispose();
});

test('resolver bounds frame-data readiness timeout and abort, cleaning every partial URL and video', async () => {
	const timeoutHarness = runtimeHarness({ metadata: 'pending' });
	const timeoutResolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(
		timeoutHarness, [sourceAsset()], { timeoutMs: 10 },
	));
	await assert.rejects(
		Promise.resolve(timeoutResolver.resolveSource(entry(), { signal: new AbortController().signal })),
		/timed out.*10/iu,
	);
	assert.deepEqual(timeoutHarness.revoked, ['blob:offline-1']);
	timeoutResolver.dispose();

	const abortHarness = runtimeHarness({ metadata: 'pending' });
	const abortResolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(abortHarness));
	const controller = new AbortController();
	const pending = Promise.resolve(abortResolver.resolveSource(entry(), { signal: controller.signal }));
	controller.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(abortHarness.revoked, ['blob:offline-1']);
	abortResolver.dispose();
});

test('resolver disposal aborts an active occurrence seek before revoking its URL', async () => {
	const harness = runtimeHarness({ seek: 'pending' });
	const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(harness));
	const signal = new AbortController().signal;
	const presentation = await resolver.resolveSource(entry(), { signal });
	const pending = Promise.resolve(presentation.present(entry(), { signal }));
	resolver.dispose();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(harness.revoked, ['blob:offline-1']);
});

test('presentation and resolver disposal retry only unfinished media cleanup steps', async () => {
	const harness = runtimeHarness({ revokeFailures: 1 });
	const resolver = createVideoKeyframeOfflineHtmlVideoSourceResolver(options(harness));
	const presentation = await resolver.resolveSource(entry(), { signal: new AbortController().signal });
	assert.throws(() => presentation.dispose(), /revoke once/u);
	assert.equal(harness.videos[0]?.removed, true);
	assert.deepEqual(harness.revoked, []);
	presentation.dispose();
	assert.deepEqual(harness.revoked, ['blob:offline-1']);
	assert.deepEqual(harness.revokeAttempts, ['blob:offline-1', 'blob:offline-1']);
	resolver.dispose();
	assert.equal(harness.revokeAttempts.length, 2);
});

interface RuntimeHarness {
	readonly document: Pick<Document, 'body' | 'createElement'>;
	readonly url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
	readonly createSeekPort: VideoKeyframeOfflineHtmlVideoSourceResolverOptions['createSeekPort'];
	readonly videos: FakeVideo[];
	readonly revoked: string[];
	readonly revokeAttempts: string[];
	readonly seekRequests: Array<Record<string, unknown>>;
}

function runtimeHarness(options: Readonly<{
	decodedWidth?: number;
	frameData?: 'loaded' | 'pending';
	metadata?: 'loaded' | 'pending';
	revokeFailures?: number;
	seek?: 'immediate' | 'pending';
}> = {}): RuntimeHarness {
	const videos: FakeVideo[] = [];
	const revoked: string[] = [];
	const revokeAttempts: string[] = [];
	const seekRequests: Array<Record<string, unknown>> = [];
	let nextUrl = 1;
	const document = {
		body: {
			append(video: FakeVideo) { video.isConnected = true; },
		},
		createElement(name: string) {
			assert.equal(name, 'video');
			const video = new FakeVideo(
				options.decodedWidth ?? 64,
				32,
				options.metadata ?? 'loaded',
				options.frameData ?? 'loaded',
			);
			videos.push(video);
			return video;
		},
	} as unknown as Pick<Document, 'body' | 'createElement'>;
	const url = {
		createObjectURL() { return `blob:offline-${String(nextUrl++)}`; },
		revokeObjectURL(value: string) {
			revokeAttempts.push(value);
			if (revokeAttempts.length <= (options.revokeFailures ?? 0)) throw new Error('revoke once');
			revoked.push(value);
		},
	} as unknown as Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
	const createSeekPort: NonNullable<VideoKeyframeOfflineHtmlVideoSourceResolverOptions['createSeekPort']> = (
		_video, portOptions,
	): VideoRetimePreviewMediaPort => Object.freeze({
		pause: () => { portOptions.assertCurrent(); },
		assertCurrent: () => { portOptions.assertCurrent(); },
		present: (request: Parameters<VideoRetimePreviewMediaPort['present']>[0]) => {
			portOptions.assertCurrent();
			seekRequests.push({ ...request });
			if (options.seek === 'pending') return new Promise<Readonly<{ readonly mediaTime: number }>>((_resolve, reject) => {
				const fail = () => reject(new DOMException('cancelled', 'AbortError'));
				request.signal.addEventListener('abort', fail, { once: true });
				if (request.signal.aborted) fail();
			});
			return Promise.resolve(Object.freeze({ mediaTime: request.intervalStartSeconds }));
		},
	});
	return { document, url, createSeekPort, videos, revoked, revokeAttempts, seekRequests };
}

class FakeVideo extends EventTarget {
	preload = '';
	muted = false;
	playsInline = false;
	autoplay = true;
	paused = true;
	readyState = 1;
	duration = 0.27;
	currentTime = 0;
	src = '';
	currentSrc = '';
	srcObject: MediaProvider | null = null;
	error: MediaError | null = null;
	removed = false;
	isConnected = false;
	style = {
		position: '', left: '', top: '', width: '', height: '', pointerEvents: '',
	};
	readonly videoWidth: number;
	readonly videoHeight: number;
	readonly #frameData: 'loaded' | 'pending';
	readonly #metadata: 'loaded' | 'pending';

	constructor(
		width: number,
		height: number,
		metadata: 'loaded' | 'pending',
		frameData: 'loaded' | 'pending',
	) {
		super();
		this.videoWidth = width;
		this.videoHeight = height;
		this.#metadata = metadata;
		this.#frameData = frameData;
	}

	load(): void {
		if (!this.src || this.#metadata === 'pending') return;
		this.currentSrc = this.src;
		queueMicrotask(() => {
			this.dispatchEvent(new Event('loadedmetadata'));
			if (this.#frameData === 'loaded') this.publishLoadedData();
		});
	}

	publishLoadedData(): void {
		this.readyState = 2;
		this.dispatchEvent(new Event('loadeddata'));
	}

	pause(): void { this.paused = true; }
	removeAttribute(name: string): void {
		if (name === 'src') { this.src = ''; this.currentSrc = ''; }
	}
	remove(): void { this.removed = true; this.isConnected = false; }
}

function options(
	harness: RuntimeHarness,
	sources: readonly unknown[] = [sourceAsset()],
	extra: Readonly<{ timeoutMs?: number }> = {},
): VideoKeyframeOfflineHtmlVideoSourceResolverOptions {
	return {
		sources: sources as VideoKeyframeOfflineHtmlVideoSourceResolverOptions['sources'],
		document: harness.document,
		url: harness.url,
		createSeekPort: harness.createSeekPort,
		...extra,
	};
}

function sourceAsset(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		sourceId: SOURCE_ID,
		identity: SOURCE_SHA256,
		blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }),
		clipIds: [CLIP_ID, 'retimed-clip'],
		decodedWidth: 64,
		decodedHeight: 32,
		displayWidth: 80,
		displayHeight: 32,
		presentationForEntry: () => descriptor(0),
		...overrides,
	};
}

function entry(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
	return Object.freeze({
		kind: 'video',
		sourceId: SOURCE_ID,
		clipId: CLIP_ID,
		source: source(),
		clip: Object.freeze({ kind: 'video', id: CLIP_ID, sourceId: SOURCE_ID }),
		sourceFrame: 0,
		sourceTimeSeconds: 0,
		...overrides,
	});
}

function source(): Readonly<Record<string, unknown>> {
	return Object.freeze({
		kind: 'video', id: SOURCE_ID, contentSha256: SOURCE_SHA256, width: 80, height: 32,
	});
}

function descriptor(frame: number): Readonly<Record<string, unknown>> {
	const times = [exact(0n), exact(1n, 25n), exact(13n, 100n), exact(1n, 5n), exact(27n, 100n)];
	return Object.freeze({
		outerCell: frame,
		segmentIndex: 0,
		mode: 'constant-forward',
		sourceFrame: exact(BigInt(frame)),
		sourceTime: times[frame],
		drawableSourceFrame: frame,
		drawableSourceStartTime: times[frame],
		drawableSourceEndTime: times[frame + 1],
	});
}

function exact(numerator: bigint, denominator = 1n) {
	return Object.freeze({ numerator, denominator });
}
