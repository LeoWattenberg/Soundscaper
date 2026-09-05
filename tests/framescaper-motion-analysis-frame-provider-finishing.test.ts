/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { BlobLike } from '../src/common/editor/storage/media-records.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import type { GrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import type {
	FramescaperMotionAnalysisFrameRequestFinishing,
	FramescaperMotionAnalysisProgressFinishing,
} from '../src/framescaper/editor-motion-analysis-actions-finishing.ts';
import {
	createFramescaperMotionAnalysisFrameProviderFinishing as createFrameProvider,
} from '../src/framescaper/editor-motion-analysis-frame-provider-finishing.ts';

type Data = Record<string, unknown>;
type Request = FramescaperMotionAnalysisFrameRequestFinishing;
type Progress = FramescaperMotionAnalysisProgressFinishing;
type Signalled = Readonly<{ readonly signal?: AbortSignal }>;

interface CaptureOptions {
	readonly maximumWidth?: number; readonly maximumHeight?: number;
	readonly mimeType?: string; readonly signal?: AbortSignal;
}

interface Extractor {
	capture(timestampSeconds: number, options?: CaptureOptions): Promise<Readonly<{ readonly blob: Blob }>>;
	dispose(): unknown;
}

type ExtractorFactory = (body: Blob, options?: Signalled) => Promise<Extractor>;

interface FakeStore {
	loadMediaAsset(storageKey: string, options?: Signalled): Promise<BlobLike | null>;
	resolveLinkedVideoOriginal?(
		projectId: string, source: Readonly<Record<string, unknown>>, options?: Signalled,
	): Promise<Readonly<{ readonly blob: BlobLike }> | null>;
}

interface StoreHarness {
	readonly store: FakeStore;
	readonly loads: { key: string; signal: AbortSignal | undefined }[];
	readonly linkedCalls: { projectId: string; source: Data }[];
}

interface ExtractorHarness {
	readonly createExtractor: ExtractorFactory;
	readonly captures: { timestamp: number; options: CaptureOptions | undefined }[];
	readonly bodies: Blob[]; readonly log: string[];
}

const BODY = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
const BODY_DIGEST = bytesToHex(sha256(BODY));
const OTHER_BODY = Uint8Array.from([1, 1, 2, 3, 5, 8]);
const OTHER_DIGEST = bytesToHex(sha256(OTHER_BODY));

test('creating the frame provider refuses a store that cannot load original media', () => {
	assert.throws(() => createProvider({ store: null as never }), (error: unknown) =>
		error instanceof TypeError && /requires an original-media store/u.test(error.message));
	assert.throws(() => createProvider({ store: { loadMediaAsset: 'later' } as never }),
		/requires an original-media store/u);
	assert.equal(typeof createProvider({ store: storeHarness().store }), 'function');
});

/**
 * The factory declares its frame call as PromiseLike, which assert.rejects will
 * not take; wrapping it once keeps every refusal case readable.
 */
function createProvider(options: Parameters<typeof createFrameProvider>[0]) {
	const provider = createFrameProvider(options);
	return async (request: Parameters<typeof provider>[0]) => provider(request);
}

test('the provider refuses anything but a plain video source record', async () => {
	const provider = createProvider({ store: storeHarness().store });

	await assert.rejects(provider(request({ source: null as never })), (error: unknown) =>
		error instanceof TypeError && /A selected finishing video source is required/u.test(error.message));
	await assert.rejects(provider(request({ source: [] as never })),
		/A selected finishing video source is required/u);
	await assert.rejects(provider(request({ source: videoSource({ kind: 'audio' }) })),
		/requires a video source/u);
});

test('the provider refuses an unusable storage key or content digest before touching the store', async () => {
	const held = storeHarness();
	const provider = createProvider({ store: held.store });

	await assert.rejects(provider(request({ source: videoSource({ id: '' }) })), (error: unknown) =>
		error instanceof TypeError && /storage key is invalid/u.test(error.message));
	await assert.rejects(provider(request({ source: videoSource({ storageKey: 'media/original' }) })),
		/storage key is invalid/u);
	await assert.rejects(provider(request({ source: videoSource({ contentSha256: BODY_DIGEST.toUpperCase() }) })),
		/source digest is invalid/u);
	await assert.rejects(provider(request({ source: videoSource({ contentSha256: 'ab' }) })), (error: unknown) =>
		error instanceof TypeError && /source digest is invalid/u.test(error.message));
	assert.deepEqual(held.loads, [], 'a malformed source never reaches the media store');
});

test('a constant-rate source captures frame midpoints and reports decoding progress', async () => {
	const held = storeHarness();
	const extractor = extractorHarness();
	const decoded: number[] = [];
	const progress: Progress[] = [];
	const provider = providerFor({
		store: held.store,
		createExtractor: extractor.createExtractor,
		decodeGray: (_body, frameNumber) => { decoded.push(frameNumber); return grayFrame(frameNumber) },
	});

	const frames = await provider(request({
		startFrame: 2, endFrame: 5, onProgress: (value) => progress.push(value),
	}));

	assert.deepEqual(frames.map((entry) => entry.frameNumber), [2, 3, 4]);
	assert.deepEqual(decoded, [2, 3, 4]);
	// (frameNumber + 0.5) * den / num against the 25/1 source rate.
	assert.deepEqual(extractor.captures.map((entry) => entry.timestamp), [0.1, 0.14, 0.18]);
	assert.deepEqual(extractor.captures[0]?.options, {
		maximumWidth: 320, maximumHeight: 180, mimeType: 'image/png',
	}, 'captures are bounded to the decode resolution and taken as a lossless still');
	assert.deepEqual(progress, [
		{ phase: 'decoding', completed: 1, total: 3 },
		{ phase: 'decoding', completed: 2, total: 3 },
		{ phase: 'decoding', completed: 3, total: 3 },
	]);
	assert.ok(progress.every((value) => Object.isFrozen(value)));
	assert.ok(Object.isFrozen(frames) && Object.isFrozen(frames[0]));
	assert.deepEqual(extractor.log, ['create', 'capture', 'capture', 'capture', 'dispose']);
	assert.deepEqual(held.loads.map((entry) => entry.key), ['video-source']);
});

test('an empty frame range returns no frames and reports no progress at all', async () => {
	const extractor = extractorHarness();
	const provider = providerFor({ createExtractor: extractor.createExtractor });
	const progress: Progress[] = [];

	const frames = await provider(request({
		startFrame: 4, endFrame: 4, onProgress: (value) => progress.push(value),
	}));

	assert.deepEqual(frames, []);
	assert.deepEqual(progress, []);
	assert.deepEqual(extractor.log, ['create', 'dispose'], 'the extractor is still opened and released');
});

test('a constant-rate source without a positive rational rate is refused before any media is loaded', async () => {
	const held = storeHarness();
	const provider = providerFor({ store: held.store });
	const rejects = async (frameRate: unknown, pattern: RegExp): Promise<void> => {
		await assert.rejects(provider(request({ source: videoSource({ frameRate }) })), pattern);
	};

	await rejects(undefined, /frame rate is unavailable/u);
	await rejects([25, 1], /frame rate is unavailable/u);
	await rejects({ num: 0, den: 1 }, /rate numerator must be positive/u);
	await rejects({ num: 25, den: 1.5 }, /rate denominator must be positive/u);
	assert.deepEqual(held.loads, [], 'the timestamp resolver runs before the original is fetched');
});

test('an original missing from owned storage is fetched through the linked-original resolver', async () => {
	const held = storeHarness({ assets: new Map(), linked: blobLike(BODY) });
	const extractor = extractorHarness();

	const frames = await providerFor({ store: held.store, createExtractor: extractor.createExtractor })(
		request({ startFrame: 0, endFrame: 1 }),
	);

	assert.equal(frames.length, 1);
	assert.deepEqual(held.linkedCalls.map((entry) => entry.projectId), ['project-1']);
	assert.equal(held.linkedCalls[0]?.source.id, 'video-source');
	assert.ok(extractor.bodies[0] instanceof Blob, 'a foreign blob-like original is copied into a real Blob');
	assert.equal(extractor.bodies[0]?.type, 'video/mp4');
});

test('an original absent from owned storage and from any linked resolver is reported offline', async () => {
	const withoutResolver = storeHarness({ assets: new Map() });
	const withEmptyResolver = storeHarness({ assets: new Map(), linked: null });

	await assert.rejects(providerFor({ store: withoutResolver.store })(request()),
		/original is offline or unavailable/u);
	await assert.rejects(providerFor({ store: withEmptyResolver.store })(request()),
		/original is offline or unavailable/u);
	assert.equal(withEmptyResolver.linkedCalls.length, 1);
});

test('an original whose bytes no longer match the recorded digest is refused before extraction', async () => {
	const stale = storeHarness({ assets: new Map([['video-source', new Blob([OTHER_BODY])]]) });
	const extractor = extractorHarness();

	await assert.rejects(providerFor({ store: stale.store, createExtractor: extractor.createExtractor })(request()),
		/original changed before authentication/u);
	assert.deepEqual(extractor.log, [], 'authentication precedes opening a decoder session');

	const frames = await providerFor({ store: stale.store, createExtractor: extractor.createExtractor })(request({
		source: videoSource({ contentSha256: OTHER_DIGEST }), startFrame: 0, endFrame: 1,
	}));
	assert.equal(frames.length, 1, 'the digest the source records is the one that must match');
});

test('an extractor factory that returns an unusable session is refused', async () => {
	const invalid = [null, {}, { capture: () => ({ blob: new Blob([]) }) }, { dispose: () => {} }];

	for (const value of invalid) {
		const provider = providerFor({ createExtractor: (() => Promise.resolve(value)) as never });
		await assert.rejects(provider(request()), (error: unknown) =>
			error instanceof TypeError && /frame extractor is invalid/u.test(error.message));
	}
});

test('a capture that yields no image body fails the run and still disposes the extractor', async () => {
	const extractor = extractorHarness({ capture: () => ({ blob: 'data:image/png;base64,' } as never) });
	const progress: Progress[] = [];
	const provider = providerFor({ createExtractor: extractor.createExtractor });

	await assert.rejects(provider(request({ onProgress: (value) => progress.push(value) })), (error: unknown) =>
		error instanceof TypeError && /returned no pathless image body/u.test(error.message));
	assert.deepEqual(extractor.log, ['create', 'capture', 'dispose']);
	assert.deepEqual(progress, []);
});

test('a decode failure is rethrown after release, and aggregated when release fails as well', async () => {
	const failure = new RangeError('the gray frame exceeded its pixel bound');
	const cleanup = new Error('the decoder session could not be released');
	const decodeGray = (): GrayVideoFrameV1 => { throw failure };
	const extractor = extractorHarness();

	await assert.rejects(
		providerFor({ createExtractor: extractor.createExtractor, decodeGray })(request()),
		(error: unknown) => error === failure,
	);
	assert.deepEqual(extractor.log, ['create', 'capture', 'dispose']);

	await assert.rejects(
		providerFor({ createExtractor: extractorHarness({ failDispose: cleanup }).createExtractor, decodeGray })(
			request(),
		),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(error.message, /decoding and extractor cleanup both failed/u);
			assert.deepEqual(error.errors, [failure, cleanup]);
			assert.equal(error.cause, failure);
			return true;
		},
	);
});

test('a disposal failure on an otherwise complete run is thrown on its own', async () => {
	const cleanup = new Error('the decoder session could not be released');
	const provider = providerFor({
		createExtractor: extractorHarness({ failDispose: cleanup }).createExtractor,
	});

	await assert.rejects(provider(request({ startFrame: 0, endFrame: 1 })), (error: unknown) => {
		assert.equal(error, cleanup);
		assert.ok(!(error instanceof AggregateError), 'no decode failure means no aggregate');
		return true;
	});
});

test('a run cancelled before it starts reports the abort reason and opens nothing', async () => {
	const held = storeHarness();
	const extractor = extractorHarness();
	const provider = providerFor({ store: held.store, createExtractor: extractor.createExtractor });
	const controller = new AbortController();
	const reason = new Error('the operator cancelled motion analysis');
	controller.abort(reason);

	await assert.rejects(provider(request({ signal: controller.signal })), (error: unknown) => error === reason);
	assert.deepEqual(held.loads, []);
	assert.deepEqual(extractor.log, []);

	const reasonless = { aborted: true, reason: undefined } as unknown as AbortSignal;
	await assert.rejects(provider(request({ signal: reasonless })), (error: unknown) =>
		error instanceof DOMException && error.name === 'AbortError'
		&& /Motion frame decoding was cancelled/u.test(error.message));
});

test('a run cancelled between frames stops decoding, releases the extractor, and keeps no frames', async () => {
	const held = storeHarness();
	const extractor = extractorHarness();
	const controller = new AbortController();
	const progress: Progress[] = [];
	const provider = providerFor({
		store: held.store,
		createExtractor: extractor.createExtractor,
		decodeGray: (_body, frameNumber) => {
			if (frameNumber === 1) controller.abort(new Error('the operator cancelled motion analysis'));
			return grayFrame(frameNumber);
		},
	});

	await assert.rejects(provider(request({
		startFrame: 0, endFrame: 4, signal: controller.signal, onProgress: (value) => progress.push(value),
	})), /operator cancelled motion analysis/u);
	assert.deepEqual(extractor.log, ['create', 'capture', 'capture', 'dispose']);
	assert.deepEqual(progress, [{ phase: 'decoding', completed: 1, total: 4 }]);
	assert.equal(held.loads[0]?.signal, controller.signal, 'the run signal reaches the media store');
	assert.equal(extractor.captures[0]?.options?.signal, controller.signal);
});

test('a variable-rate source takes its timestamps from the verified timing asset', async () => {
	const published = timingAsset();
	const held = storeHarness({ assets: new Map<string, BlobLike>([
		['video-source', new Blob([BODY as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })],
		// Served as a foreign blob-like value so the timing adapter has to copy it into a Blob.
		[published.reference.storageKey, blobLike(published.bytes, 'application/octet-stream')],
	]) });
	const extractor = extractorHarness();

	const frames = await providerFor({ store: held.store, createExtractor: extractor.createExtractor })(request({
		source: videoSource({ timingAsset: published.reference }), startFrame: 0, endFrame: 3,
	}));

	assert.deepEqual(frames.map((entry) => entry.frameNumber), [0, 1, 2]);
	// Midpoints of the 0-400, 400-1000 and 1000-1600 tick spans at a 1000 timescale.
	assert.deepEqual(extractor.captures.map((entry) => entry.timestamp), [0.2, 0.7, 1.3]);
	assert.deepEqual(held.loads.map((entry) => entry.key),
		[published.reference.storageKey, 'video-source'],
		'timing is resolved before the original is fetched');
});

test('a frame beyond the timing asset extent is refused rather than extrapolated', async () => {
	const published = timingAsset();
	const provider = providerFor({ store: storeHarness({ assets: timingAssets(published) }).store });

	await assert.rejects(provider(request({
		source: videoSource({ timingAsset: published.reference }), startFrame: 2, endFrame: 4,
	})), (error: unknown) =>
		error instanceof RangeError && /boundary exceeds its timing view/u.test(error.message));
});

test('a timing asset that is missing, corrupt, or bound to another source refuses the run', async () => {
	const published = timingAsset();
	const media = new Map<string, BlobLike>([['video-source', new Blob([BODY as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })]]);
	const rejects = async (assets: ReadonlyMap<string, BlobLike>, reference: unknown, pattern: RegExp) => {
		const provider = providerFor({ store: storeHarness({ assets }).store });
		await assert.rejects(provider(request({ source: videoSource({ timingAsset: reference }) })), pattern);
	};

	await rejects(media, published.reference, /timing asset is missing/u);
	await rejects(media, { storageKey: 'timing' }, /timing asset is corrupt/u);
	await rejects(media, { ...published.reference, sourceSha256: OTHER_DIGEST },
		/timing asset is source-mismatch/u);
	await rejects(
		new Map<string, BlobLike>([...media, [published.reference.storageKey, new Blob([OTHER_BODY])]]),
		published.reference, /timing asset is corrupt/u,
	);
});

test('the default frame extractor requires a browser video pipeline', async () => {
	const provider = createProvider({ store: storeHarness().store });

	await assert.rejects(provider(request()), /Browser video decoding is unavailable/u);
});

test('the default gray decoder requires browser image decoding and canvas readback', async () => {
	const extractor = extractorHarness();
	const provider = createProvider({
		store: storeHarness().store, createExtractor: extractor.createExtractor,
	});

	await assert.rejects(provider(request()), /Browser image decoding is unavailable/u);
	assert.deepEqual(extractor.log, ['create', 'capture', 'dispose']);

	const bitmap = fakeBitmap(1, 1);
	await withBrowserImageGlobals({ bitmap }, async () => {
		await assert.rejects(provider(request()), /Browser canvas creation is unavailable/u);
	});
	assert.equal(bitmap.closes.length, 1, 'the decoded bitmap is released even when readback is impossible');

	await withBrowserImageGlobals({ bitmap, context: null }, async () => {
		await assert.rejects(provider(request()), /Canvas pixel readback is unavailable/u);
	});
	assert.equal(bitmap.closes.length, 2);
});

test('the default gray decoder converts captured pixels to Rec. 709 luma', async () => {
	const extractor = extractorHarness();
	const provider = createProvider({
		store: storeHarness().store, createExtractor: extractor.createExtractor,
	});
	const rgba = Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
	const bitmap = fakeBitmap(2, 2);
	const canvases: { width: number; height: number }[] = [];
	const contextOptions: unknown[] = [];
	const decoded: Blob[] = [];

	const frames = await withBrowserImageGlobals(
		{ bitmap, rgba, canvases, contextOptions, decoded },
		async () => provider(request({ startFrame: 0, endFrame: 1 })),
	);
	const frame = frames[0]?.frame;

	assert.deepEqual(frames.map((entry) => entry.frameNumber), [0]);
	// White, black, then the pure red and green Rec. 709 luma weights.
	assert.deepEqual(frame?.samples.map((value) => Number(value.toFixed(6))), [1, 0, 0.2126, 0.7152]);
	assert.deepEqual({ width: frame?.width, height: frame?.height }, { width: 2, height: 2 });
	assert.ok(Object.isFrozen(frame), 'the decoder returns an authenticated gray frame');
	assert.deepEqual(canvases, [{ width: 2, height: 2 }]);
	assert.deepEqual(contextOptions, [{ alpha: false, willReadFrequently: true }]);
	assert.equal(decoded[0]?.type, 'image/png', 'the captured still is what gets decoded');
	assert.equal(bitmap.closes.length, 1);
});

function providerFor(options: Readonly<{
	readonly store?: FakeStore; readonly createExtractor?: ExtractorFactory;
	readonly decodeGray?: (body: Blob, frameNumber: number) => GrayVideoFrameV1;
}> = {}) {
	return createProvider({
		store: options.store ?? storeHarness().store,
		createExtractor: options.createExtractor ?? extractorHarness().createExtractor,
		decodeGray: options.decodeGray ?? ((_body, frameNumber) => grayFrame(frameNumber)),
	});
}

function request(overrides: Partial<Request> = {}): Request {
	return {
		projectId: 'project-1', source: videoSource(), startFrame: 0, endFrame: 2,
		onProgress: () => {}, ...overrides,
	};
}

function videoSource(overrides: Data = {}): Data {
	return {
		kind: 'video', id: 'video-source', contentSha256: BODY_DIGEST,
		frameRate: { num: 25, den: 1 }, ...overrides,
	};
}

function storeHarness(
	options: Readonly<{ readonly assets?: ReadonlyMap<string, BlobLike>; readonly linked?: BlobLike | null }> = {},
): StoreHarness {
	const loads: { key: string; signal: AbortSignal | undefined }[] = [];
	const linkedCalls: { projectId: string; source: Data }[] = [];
	const assets = options.assets
		?? new Map<string, BlobLike>([['video-source', new Blob([BODY as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })]]);
	const store: FakeStore = {
		loadMediaAsset: async (key, loadOptions) => {
			loads.push({ key, signal: loadOptions?.signal });
			return assets.get(key) ?? null;
		},
	};
	if (options.linked !== undefined) {
		const linked = options.linked;
		store.resolveLinkedVideoOriginal = async (projectId, source) => {
			linkedCalls.push({ projectId, source: source as Data });
			return linked === null ? null : { blob: linked };
		};
	}
	return { store, loads, linkedCalls };
}

function extractorHarness(options: Readonly<{
	readonly capture?: (timestamp: number) => Readonly<{ readonly blob: Blob }>; readonly failDispose?: Error;
}> = {}): ExtractorHarness {
	const captures: { timestamp: number; options: CaptureOptions | undefined }[] = [];
	const bodies: Blob[] = [];
	const log: string[] = [];
	const createExtractor: ExtractorFactory = async (body) => {
		bodies.push(body);
		log.push('create');
		return {
			capture: async (timestamp, captureOptions) => {
				captures.push({ timestamp, options: captureOptions });
				log.push('capture');
				return options.capture?.(timestamp) ?? { blob: new Blob(['still'], { type: 'image/png' }) };
			},
			dispose: () => {
				log.push('dispose');
				if (options.failDispose) throw options.failDispose;
			},
		};
	};
	return { createExtractor, captures, bodies, log };
}

function timingAsset(): Readonly<{ reference: Data & { storageKey: string }; bytes: Uint8Array }> {
	const published = createVideoTimingAssetPublication(BODY_DIGEST, {
		timescale: 1_000, presentationTicks: [0n, 400n, 1_000n], finalFrameDurationTicks: 600n,
	});
	return { reference: published.reference as unknown as Data & { storageKey: string }, bytes: published.bytes };
}

function timingAssets(published: ReturnType<typeof timingAsset>): ReadonlyMap<string, BlobLike> {
	return new Map<string, BlobLike>([
		['video-source', new Blob([BODY as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })],
		[published.reference.storageKey, new Blob([published.bytes as Uint8Array<ArrayBuffer>])],
	]);
}

function blobLike(bytes: Uint8Array, type = 'video/mp4'): BlobLike {
	const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
	return {
		size: blob.size, type, arrayBuffer: () => blob.arrayBuffer(),
		slice: (start?: number, end?: number, contentType?: string) => blob.slice(start, end, contentType),
	};
}

function fakeBitmap(width: number, height: number): { width: number; height: number; closes: number[]; close(): void } {
	const closes: number[] = [];
	return { width, height, closes, close: () => { closes.push(closes.length + 1) } };
}

/** Runs one body against the browser image-decoding globals the default gray decoder reaches for. */
async function withBrowserImageGlobals<T>(fixture: Readonly<{
	readonly bitmap: Readonly<{ readonly width: number; readonly height: number; close(): void }>;
	readonly rgba?: Uint8ClampedArray; readonly context?: null; readonly decoded?: Blob[];
	readonly canvases?: { width: number; height: number }[]; readonly contextOptions?: unknown[];
}>, body: () => Promise<T>): Promise<T> {
	const names = ['document', 'createImageBitmap'];
	const originals = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
	const document = { createElement(name: string): unknown {
		assert.equal(name, 'canvas');
		const canvas = {
			width: 0,
			height: 0,
			getContext(kind: string, contextOptions: unknown): unknown {
				assert.equal(kind, '2d');
				fixture.contextOptions?.push(contextOptions);
				fixture.canvases?.push({ width: canvas.width, height: canvas.height });
				if (fixture.context === null) return null;
				return {
					drawImage: () => {},
					getImageData: () => ({ data: fixture.rgba ?? new Uint8ClampedArray(4) }),
				};
			},
		};
		return canvas;
	} };
	const definitions: PropertyDescriptorMap = { createImageBitmap: {
		configurable: true,
		value: async (value: Blob) => { fixture.decoded?.push(value); return fixture.bitmap },
	} };
	// Withholding the document proves the decoder refuses to invent a canvas of its own.
	if (fixture.canvases !== undefined || fixture.context === null) {
		definitions.document = { configurable: true, value: document };
	}
	Object.defineProperties(globalThis, definitions);
	try {
		return await body();
	} finally {
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	}
}

function grayFrame(seed: number): GrayVideoFrameV1 {
	const samples: number[] = [];
	for (let index = 0; index < 4; index += 1) samples.push(((index + seed) % 4) / 3);
	return { width: 2, height: 2, samples };
}
