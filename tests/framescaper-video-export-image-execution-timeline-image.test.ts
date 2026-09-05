/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import type { BlobLike } from '../src/common/editor/storage/media-records.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	type FramescaperImageSourceV1,
} from '../src/common/editor/timeline-image-model.ts';
import {
	applyFramescaperProjectCommandTimelineImage as applyCommand,
} from '../src/framescaper/editor-project-timeline-image-commands.ts';
import {
	createFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperVideoExportImageExecutionTimelineImage as createExecution,
} from '../src/framescaper/video-export-image-execution-timeline-image.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;
type Rational = Readonly<{ readonly num: number; readonly den: number }>;

const NOW = '2026-09-05T12:00:00.000Z';
const ENCODER = new TextEncoder();
const CANVAS: Readonly<{ width: number; height: number }> = Object.freeze({ width: 1_280, height: 720 });
const RATE = Object.freeze({ num: 10, den: 1 });
const RED_FRAME = [255, 0, 0, 255, 0, 0, 0, 0];
const GREEN_FRAME = [0, 255, 0, 128, 0, 0, 255, 255];
const RELEASED_FRAME = [0, 0, 0, 0, 0, 0, 0, 0];

interface Picture {
	readonly trackId: string; readonly clipId: string; readonly sourceId: string;
	readonly frame: Readonly<{ readonly width: number; readonly height: number; readonly pixels: Uint8Array }>;
	readonly displayWidth: number; readonly displayHeight: number; readonly opacity: number;
	readonly renderDescription: Readonly<{
		readonly sourceDisplayToCanvas: readonly number[]; readonly opacityStart: number;
	}>;
}

interface Execution {
	resolve(frame: Readonly<{
		readonly sequencePosition: Rational; readonly width: number;
		readonly height: number; readonly signal: AbortSignal;
	}>): Promise<readonly Picture[]>;
	dispose(): void;
}

interface PackedImage {
	readonly source: FramescaperImageSourceV1; readonly bytes: Uint8Array;
}

interface ClipSpec {
	readonly clipId: string; readonly sourceId: string;
	readonly trackId: string; readonly sequenceStartFrame?: number;
}

interface TrackSpec {
	readonly id: string; readonly hidden?: boolean;
	readonly solo?: boolean; readonly foreignSequence?: boolean;
}

/** Two canonical frames: one second of opaque red, then four seconds of green. */
function packImage(id: string, receiptPadBytes = 0): PackedImage {
	const publication = createFramescaperImageFramePackV1({
		original: ENCODER.encode(`exact original for ${id}`),
		receipt: {
			schemaVersion: 1, decoder: { id: 'test-decoder', version: '1' },
			...(receiptPadBytes > 0 ? { pad: 'a'.repeat(receiptPadBytes) } : {}),
		},
		width: 2, height: 1, timingMode: 'embedded',
		frames: [
			{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: Uint8Array.from(RED_FRAME) },
			{ presentationTicks: 1_000_000n, durationTicks: 4_000_000n, rgba: Uint8Array.from(GREEN_FRAME) },
		],
	});
	const source = {
		schemaVersion: 1, kind: 'image', id, name: `Image ${id}`,
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, storageKey: id,
		contentSha256: publication.contentSha256, assetByteLength: publication.assetByteLength,
		original: {
			fileName: `${id}.png`, mimeType: 'image/png', recognizedFormat: 'apng',
			byteLength: publication.originalByteLength, sha256: publication.originalSha256,
		},
		canonical: {
			width: publication.width, height: publication.height, hasAlpha: publication.hasAlpha,
			frameCount: publication.frameCount, durationTicks: publication.durationTicks,
			timingMode: publication.timingMode,
		},
		conversionReceiptSha256: publication.conversionReceiptSha256,
	} as FramescaperImageSourceV1;
	return Object.freeze({ bytes: publication.bytes, source: Object.freeze(source) });
}

/** Overstate one asset's declared byte length without touching its authentic body. */
function declaringAssetBytes(pack: PackedImage, assetByteLength: number): PackedImage {
	return Object.freeze({
		bytes: pack.bytes, source: Object.freeze({ ...pack.source, assetByteLength }) as FramescaperImageSourceV1,
	});
}

function imageProject(
	packs: readonly PackedImage[],
	clips: readonly ClipSpec[],
	tracks: readonly TrackSpec[] = [{ id: 'video-track' }],
): FramescaperProjectTimelineImage {
	const options = framescaperV20Options();
	const foreign = tracks.filter(({ foreignSequence }) => foreignSequence === true);
	const home = tracks.filter(({ foreignSequence }) => foreignSequence !== true);
	const videoTrack = (track: TrackSpec): Data => createVideoTrack({
		id: track.id, name: `Video ${track.id}`, clipIds: track.id === tracks[0]!.id ? ['video-clip'] : [],
		hidden: track.hidden === true, solo: track.solo === true,
	}) as Data;
	// project.tracks must list every track in the preorder its sequences derive.
	options.tracks = [
		...home.map(videoTrack),
		{ id: 'audio-track', name: 'Audio', type: 'audio', clipIds: ['audio-clip'], height: 96, collapsed: false },
		...foreign.map(videoTrack),
	];
	options.sequences = [
		{ id: 'main-sequence', rate: RATE, trackIds: [...home.map(({ id }) => id), 'audio-track'] },
		...(foreign.length === 0 ? [] : [{
			id: 'second-sequence', rate: RATE, trackIds: foreign.map(({ id }) => id),
		}]),
	];
	let project = createFramescaperProjectTimelineImage(PROFILE, options as never);
	for (const { source } of packs) {
		project = applyCommand(PROFILE, project, {
			type: 'image-source/set', sourceId: source.id, expectedSource: null, source,
		}, { now: NOW });
	}
	for (const spec of clips) {
		project = applyCommand(PROFILE, project, {
			type: 'image-clip/set', clipId: spec.clipId, expectedClip: null, expectedPlacement: null,
			clip: {
				schemaVersion: 1, kind: 'image', id: spec.clipId, sourceId: spec.sourceId,
				sequenceId: 'main-sequence', sequenceStartFrame: spec.sequenceStartFrame ?? 0,
				sequenceFrameCount: 20, sourceStartTicks: '0',
			},
			placement: { scope: 'timeline', trackId: spec.trackId },
		}, { now: NOW });
	}
	return project;
}

function generatorNode(modelId: string): Data {
	return {
		kind: 'visual', modelId, placement: { trackId: 'video-track' },
		authoredState: { source: { kind: 'generator', id: `${modelId}-source` } },
	};
}

function plan(clipIds: readonly string[], canvas = CANVAS, extraNodes: readonly Data[] = []): Data {
	return {
		output: { canvas: { width: canvas.width, height: canvas.height, fit: 'contain' } },
		nodes: [...clipIds.map(generatorNode), ...extraNodes],
	};
}

function blobLike(bytes: Uint8Array): BlobLike {
	return {
		size: bytes.byteLength,
		slice: () => blobLike(bytes),
		arrayBuffer: () => Promise.resolve(bytes.slice().buffer as ArrayBuffer),
	};
}

function assetStore(packs: readonly PackedImage[], withheld: ReadonlySet<string> = new Set()): Readonly<{
	readonly store: Data; readonly keys: string[];
}> {
	const keys: string[] = [];
	const bodies = new Map(packs.map(({ source, bytes }) => [source.storageKey, bytes] as const));
	return {
		keys,
		store: {
			loadMediaAsset(key: string): Promise<BlobLike | null> {
				keys.push(key);
				const bytes = bodies.get(key);
				return Promise.resolve(bytes && !withheld.has(key) ? blobLike(bytes) : null);
			},
		},
	};
}

function createOptions(overrides: Data): Parameters<typeof createExecution>[0] {
	return {
		profile: PROFILE, signal: new AbortController().signal, assertCurrent: () => undefined,
		...overrides,
	} as unknown as Parameters<typeof createExecution>[0];
}

async function execution(overrides: Data): Promise<Execution> {
	const created = await createExecution(createOptions(overrides));
	assert.ok(created !== null, 'the fixture must compose a supplemental picture execution');
	return created as unknown as Execution;
}

function request(overrides: Data = {}): Parameters<Execution['resolve']>[0] {
	return {
		sequencePosition: { num: 0, den: 1 }, width: CANVAS.width, height: CANVAS.height,
		signal: new AbortController().signal, ...overrides,
	} as unknown as Parameters<Execution['resolve']>[0];
}

/** One clip on one track, backed by one authentic frame pack the store may withhold. */
function singleClip(options: Readonly<{
	readonly tracks?: readonly TrackSpec[];
	readonly trackId?: string;
	readonly withheld?: boolean;
}> = {}): Readonly<{
	readonly store: ReturnType<typeof assetStore>;
	readonly project: FramescaperProjectTimelineImage;
	readonly foundationPlan: Data;
}> {
	const pack = packImage('image-source-1');
	return {
		store: assetStore([pack], new Set(options.withheld === true ? ['image-source-1'] : [])),
		project: imageProject([pack], [{
			clipId: 'image-clip-1', sourceId: 'image-source-1', trackId: options.trackId ?? 'video-track',
		}], options.tracks),
		foundationPlan: plan(['image-clip-1']),
	};
}

async function singleClipExecution(overrides: Data = {}): Promise<Readonly<{
	readonly execution: Execution;
	readonly store: ReturnType<typeof assetStore>;
}>> {
	const { store, ...base } = singleClip();
	return { store, execution: await execution({ ...base, store: store.store, ...overrides }) };
}

test('a visible image clip resolves into one straight-linear supplemental picture', async () => {
	const { execution: subject } = await singleClipExecution();

	const pictures = await subject.resolve(request());

	assert.equal(pictures.length, 1);
	const picture = pictures[0]!;
	assert.deepEqual(
		[picture.trackId, picture.clipId, picture.sourceId, picture.displayWidth, picture.displayHeight, picture.opacity],
		['video-track', 'image-clip-1', 'image-source-1', 2, 1, 1],
	);
	assert.deepEqual([picture.frame.width, picture.frame.height], [2, 1]);
	assert.deepEqual([...picture.frame.pixels], RED_FRAME);
	// A 2x1 source contained in a 1280x720 canvas scales by 640 and sits 40 rows down.
	assert.deepEqual([...picture.renderDescription.sourceDisplayToCanvas], [640, 0, 0, 640, 0, 40]);
	assert.equal(picture.renderDescription.opacityStart, 1);
	assert.ok(Object.isFrozen(pictures) && Object.isFrozen(picture));
	subject.dispose();
});

test('a fractional sequence position floors onto the next frame of the packed tick table', async () => {
	const { execution: subject } = await singleClipExecution();

	// 105/10 floors to sequence frame 10, which is one second in at 10 fps.
	const pictures = await subject.resolve(request({ sequencePosition: { num: 105, den: 10 } }));

	assert.deepEqual([...pictures[0]!.frame.pixels], GREEN_FRAME);
	subject.dispose();
});

test('a sequence frame beyond every clip resolves to no pictures at all', async () => {
	const { execution: subject } = await singleClipExecution();

	assert.deepEqual(await subject.resolve(request({ sequencePosition: { num: 40, den: 1 } })), []);
	subject.dispose();
});

test('supplemental pictures are ordered by track index, then start frame, then clip identity', async () => {
	const pack = packImage('image-source-1');
	const store = assetStore([pack]);
	const clipIds = ['image-clip-zulu', 'image-clip-alpha', 'image-clip-beta', 'image-clip-first'];
	const subject = await execution({
		project: imageProject([pack], [
			{ clipId: 'image-clip-zulu', sourceId: 'image-source-1', trackId: 'video-track', sequenceStartFrame: 0 },
			{ clipId: 'image-clip-alpha', sourceId: 'image-source-1', trackId: 'video-track', sequenceStartFrame: 3 },
			{ clipId: 'image-clip-beta', sourceId: 'image-source-1', trackId: 'video-track', sequenceStartFrame: 3 },
			{ clipId: 'image-clip-first', sourceId: 'image-source-1', trackId: 'video-track-2', sequenceStartFrame: 0 },
		], [{ id: 'video-track' }, { id: 'video-track-2' }]),
		foundationPlan: plan(clipIds),
		store: store.store,
	});

	const pictures = await subject.resolve(request({ sequencePosition: { num: 5, den: 1 } }));

	assert.deepEqual(pictures.map(({ clipId }) => clipId), clipIds);
	assert.deepEqual(store.keys, ['image-source-1'], 'one shared source opens exactly one frame-pack reader');
	assert.equal(pictures[0]!.frame, pictures[3]!.frame, 'one decoded frame serves every clip addressing it');
	subject.dispose();
});

test('a hidden video track contributes no clip and demands no asset store', async () => {
	const { store, ...base } = singleClip({ tracks: [{ id: 'video-track', hidden: true }] });

	assert.equal(await createExecution(createOptions(base)), null);
	assert.deepEqual(store.keys, []);
});

test('a soloed video track suppresses the clips of its unsoloed peers', async () => {
	const pack = packImage('image-source-1');
	const store = assetStore([pack]);
	const subject = await execution({
		project: imageProject([pack], [
			{ clipId: 'image-clip-muted', sourceId: 'image-source-1', trackId: 'video-track' },
			{ clipId: 'image-clip-solo', sourceId: 'image-source-1', trackId: 'video-track-2' },
		], [{ id: 'video-track' }, { id: 'video-track-2', solo: true }]),
		foundationPlan: plan(['image-clip-muted', 'image-clip-solo']),
		store: store.store,
	});

	const pictures = await subject.resolve(request());

	assert.deepEqual(pictures.map(({ clipId }) => clipId), ['image-clip-solo']);
	subject.dispose();
});

test('a clip owned by a track outside the primary sequence is not exported', async () => {
	const { store, ...base } = singleClip({
		trackId: 'video-track-2',
		tracks: [{ id: 'video-track' }, { id: 'video-track-2', foreignSequence: true }],
	});

	assert.equal(await createExecution(createOptions(base)), null);
	assert.deepEqual(store.keys, []);
});

test('only a placed generator-backed visual node admits its clip into the export', async () => {
	const { project } = singleClip();
	const rejected: readonly Data[] = [
		{ ...generatorNode('image-clip-1'), kind: 'clip' },
		{ ...generatorNode('image-clip-1'), placement: null },
		{ kind: 'visual', modelId: 'image-clip-1', placement: { trackId: 'video-track' }, authoredState: {} },
		{
			kind: 'visual', modelId: 'image-clip-1', placement: { trackId: 'video-track' },
			authoredState: { source: { kind: 'video' } },
		},
	];

	for (const node of rejected) {
		assert.equal(
			await createExecution(createOptions({ project, foundationPlan: plan([], CANVAS, [node]) })),
			null,
			`a ${String(node.kind)} node must not activate the image clip`,
		);
	}
});

test('a visible image clip without its authenticated asset store is refused', async () => {
	const { store, ...base } = singleClip();

	await assert.rejects(
		() => createExecution(createOptions(base)),
		/requires its authenticated asset store/u,
	);
	assert.deepEqual(store.keys, []);
});

test('a frame pack the store cannot supply fails the export before any frame is resolved', async () => {
	const { store, ...base } = singleClip({ withheld: true });

	await assert.rejects(
		() => createExecution(createOptions({ ...base, store: store.store })),
		/image frame pack image-source-1 is unavailable or has the wrong byte length/u,
	);
	assert.deepEqual(store.keys, ['image-source-1']);
});

test('active image assets that exceed their aggregate byte bound are refused', async () => {
	const packs = [
		declaringAssetBytes(packImage('image-source-1'), 300 * 1024 * 1024),
		declaringAssetBytes(packImage('image-source-2'), 300 * 1024 * 1024),
	];
	const store = assetStore(packs);

	await assert.rejects(
		() => createExecution(createOptions({
			project: imageProject(packs, [
				{ clipId: 'image-clip-1', sourceId: 'image-source-1', trackId: 'video-track' },
				{ clipId: 'image-clip-2', sourceId: 'image-source-2', trackId: 'video-track' },
			]),
			foundationPlan: plan(['image-clip-1', 'image-clip-2']),
			store: store.store,
		})),
		/active image assets exceed their byte bound/u,
	);
	assert.deepEqual(store.keys, [], 'the byte bound is admitted before any body is loaded');
});

test('an image snapshot that exceeds the execution working byte bound is refused', async () => {
	const pack = declaringAssetBytes(packImage('image-source-1'), 400 * 1024 * 1024);
	const store = assetStore([pack]);

	await assert.rejects(
		() => createExecution(createOptions({
			project: imageProject([pack], [{
				clipId: 'image-clip-1', sourceId: 'image-source-1', trackId: 'video-track',
			}]),
			foundationPlan: plan(['image-clip-1']),
			store: store.store,
		})),
		/snapshots exceed their working byte bound/u,
	);
	assert.deepEqual(store.keys, []);
});

test('resident reader metadata that exceeds the working byte bound is refused mid-open', async () => {
	const packs = [packImage('image-source-1', 8_000_000), packImage('image-source-2', 8_000_000)];
	const store = assetStore(packs);

	await assert.rejects(
		() => createExecution(createOptions({
			project: imageProject(packs, [
				{ clipId: 'image-clip-1', sourceId: 'image-source-1', trackId: 'video-track' },
				{ clipId: 'image-clip-2', sourceId: 'image-source-2', trackId: 'video-track' },
			]),
			foundationPlan: plan(['image-clip-1', 'image-clip-2']),
			store: store.store,
		})),
		/reader metadata exceeds its working byte bound/u,
	);
	assert.deepEqual(store.keys, ['image-source-1', 'image-source-2']);
});

test('resolved frames that exceed the compositing working byte bound are refused', async () => {
	const canvas = { width: 8_192, height: 8_192 };
	const { execution: subject } = await singleClipExecution({ foundationPlan: plan(['image-clip-1'], canvas) });

	await assert.rejects(
		() => subject.resolve(request({ width: canvas.width, height: canvas.height })),
		/exceed their compositing working byte bound/u,
	);
	subject.dispose();
});

test('a canvas that changed after planning is refused before any frame is read', async () => {
	const { execution: subject, store } = await singleClipExecution();

	await assert.rejects(() => subject.resolve(request({ width: 640 })), /canvas changed after planning/u);

	assert.deepEqual(store.keys, ['image-source-1']);
	subject.dispose();
});

test('an invalid sequence position is refused rather than addressed', async () => {
	const { execution: subject } = await singleClipExecution();

	for (const sequencePosition of [{ num: 0, den: 0 }, { num: -1, den: 1 }, { num: 1.5, den: 1 }]) {
		await assert.rejects(
			() => subject.resolve(request({ sequencePosition })),
			/sequence position is invalid/u,
		);
	}
	subject.dispose();
});

test('a decoded frame is retained across repeated requests and released when the address moves', async () => {
	const { execution: subject } = await singleClipExecution();

	const first = await subject.resolve(request());
	const repeated = await subject.resolve(request({ sequencePosition: { num: 5, den: 1 } }));
	assert.equal(repeated[0]!.frame, first[0]!.frame, 'the same source frame is served from the cache');

	const moved = await subject.resolve(request({ sequencePosition: { num: 10, den: 1 } }));

	assert.notEqual(moved[0]!.frame, first[0]!.frame);
	assert.deepEqual([...first[0]!.frame.pixels], RELEASED_FRAME, 'the evicted frame is zeroed');
	subject.dispose();
});

test('disposal zeroes every retained frame and refuses further resolution', async () => {
	const { execution: subject } = await singleClipExecution();
	const pictures = await subject.resolve(request());

	subject.dispose();
	subject.dispose();

	assert.deepEqual([...pictures[0]!.frame.pixels], RELEASED_FRAME);
	await assert.rejects(() => subject.resolve(request()), /export execution is disposed/u);
});

test('overlapping frame resolutions are refused while one is in flight', async () => {
	const { execution: subject } = await singleClipExecution();

	const inFlight = subject.resolve(request());
	await assert.rejects(() => subject.resolve(request()), /cannot overlap frames/u);

	assert.equal((await inFlight).length, 1, 'the first resolution still completes');
	subject.dispose();
});

test('disposal during an in-flight frame is refused so its buffers survive the read', async () => {
	const { execution: subject } = await singleClipExecution();

	const inFlight = subject.resolve(request());
	assert.throws(() => subject.dispose(), /export execution is active/u);

	await inFlight;
	subject.dispose();
});

test('a cancelled frame request surfaces the caller reason and drops the decoded cache', async () => {
	const { execution: subject } = await singleClipExecution();
	const pictures = await subject.resolve(request());
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the frame');
	controller.abort(reason);

	await assert.rejects(
		() => subject.resolve(request({ signal: controller.signal })),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);

	assert.deepEqual([...pictures[0]!.frame.pixels], RELEASED_FRAME);
	subject.dispose();
});

test('a project that advanced under an in-flight frame is refused', async () => {
	let current = true;
	const stale = new RangeError('the project advanced under the export');
	const { execution: subject } = await singleClipExecution({
		assertCurrent: () => {
			if (!current) throw stale;
		},
	});

	current = false;
	await assert.rejects(
		() => subject.resolve(request()),
		(error: unknown) => {
			assert.equal(error, stale);
			return true;
		},
	);
	subject.dispose();
});
