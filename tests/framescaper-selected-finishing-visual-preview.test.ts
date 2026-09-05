/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import {
	createFramescaperSelectedProjectBinThumbnailFinishing as createThumbnail,
	createFramescaperSelectedVisualPreviewSessionFinishing as createSession,
} from '../src/framescaper/editor-selected-finishing-visual-preview.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { transitionProjectOptions } from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;

interface PreviewEntry {
	readonly kind: string; readonly clipId: string; readonly sourceId: string;
	readonly available: boolean; readonly opacity: number;
	readonly displayWidth: number; readonly displayHeight: number;
	readonly effects: readonly unknown[];
	readonly video: Readonly<{ videoWidth: number; videoHeight: number; readyState: number }>;
}

interface PreviewFrame {
	readonly layers: readonly Readonly<{
		trackId: string; trackIndex: number; blendMode: string; entries: readonly PreviewEntry[];
	}>[];
	readonly adjustments: readonly Readonly<{
		targetTrackIds: readonly string[]; effects: readonly unknown[];
		opacity: number; blendMode: string; maskIds: readonly string[];
	}>[];
	readonly ledger: Readonly<{ requestedNodeIds: readonly string[]; consumedNodeIds: readonly string[] }>;
}

interface PreviewSession {
	resolve(timelineSample: number): PreviewFrame;
	resolveTransitionWeight(clipId: string, timelineSample: number): number | null;
	renderExact(request: Readonly<{
		readonly timelineSample: number; readonly mediaLayers: readonly unknown[];
	}>): Promise<Readonly<{ layers: readonly Data[]; renderedEffectIds: readonly string[] }>>;
	dispose(): void;
}

const FRAME_SAMPLES = 4_800;

/** A store that answers every media request with the one asset the test seeded. */
function store(asset: Blob | null = null): never {
	return { loadMediaAsset: async () => asset, loadSource: async () => null } as unknown as never;
}

function canvasStub(): Data {
	const canvas: Data = { width: 0, height: 0 };
	canvas.getContext = () => ({
		putImageData: () => undefined,
		clearRect: () => undefined,
		drawImage: () => undefined,
		getImageData: (_x: number, _y: number, width: number, height: number) => ({
			data: new Uint8ClampedArray(width * height * 4),
		}),
	});
	return canvas;
}

/** Give the module the browser image surfaces its drawables and still decode demand. */
function installPreviewDom(bitmap?: Readonly<{ width: number; height: number }>): () => void {
	const root = globalThis as unknown as Data;
	const previous = {
		document: root.document, ImageData: root.ImageData, createImageBitmap: root.createImageBitmap,
	};
	root.document = { createElement: () => canvasStub() };
	root.ImageData = class {
		constructor(
			readonly data: Uint8ClampedArray, readonly width: number, readonly height: number,
		) {}
	};
	if (bitmap) root.createImageBitmap = async () => ({ ...bitmap, close: () => undefined });
	return () => {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete root[name];
			else root[name] = value;
		}
	};
}

function useDom(t: TestContext, bitmap?: Readonly<{ width: number; height: number }>): void {
	t.after(installPreviewDom(bitmap));
}

function generatorSource(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Solid',
		width: 1_920, height: 1_080, frameRate: { num: 10, den: 1 }, frameCount: 100,
		generator: { kind: 'solid', color: '#20406080' }, ...overrides,
	};
}

function generatorClip(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10, ...overrides,
	};
}

function visualModel(overrides: Data = {}): Data {
	return {
		stillSources: [], generatorSources: [], adjustmentLayers: [],
		presets: [], maskMattes: [], freezeFallbacks: [], ...overrides,
	};
}

function presentation(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, id: 'presentation-1', owner: { kind: 'generator', id: 'generator-source' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: null, maskMatteIds: [], ...overrides,
	};
}

function adjustmentLayer(effectIds: readonly string[] = []): Data {
	return {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		targetTrackIds: ['video-track'], effectIds,
	};
}

/** The shared timeline fixture with one placed solid generator on the video track. */
function generatorOptions(): Data {
	const options = { ...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] } } as Data;
	(options.clips as Data[]).push(generatorClip());
	((options.tracks as Data[])[0]!.clipIds as string[]).push('generator-clip');
	options.visualModel = visualModel({ generatorSources: [generatorSource()] });
	return options;
}

/** Place an external generator, which only an OpenFX host may draw. */
function externalGeneratorOptions(): Data {
	const options = generatorOptions();
	options.visualModel = visualModel({
		generatorSources: [generatorSource({
			generator: { kind: 'external-generator', bindingId: 'video-source', inputs: [] },
		})],
	});
	return options;
}

function projectOf(options: Data): Data {
	return createFramescaperProjectFinishing(PROFILE, options as never) as unknown as Data;
}

async function openSession(t: TestContext, overrides: Data = {}): Promise<PreviewSession> {
	const preview = await createSession({
		profile: PROFILE, project: projectOf(generatorOptions()), store: store(),
		width: 320, height: 180, ...overrides,
	} as never);
	assert.ok(preview, 'the placed generator fixture must compose a preview session');
	const session = preview as unknown as PreviewSession;
	t.after(() => { session.dispose(); });
	return session;
}

function binThumbnail(options: Data, overrides: Data = {}): Promise<unknown> {
	return createThumbnail({
		profile: PROFILE, project: projectOf(options), store: store(),
		clipId: 'bin-generator', width: 8, height: 4, ...overrides,
	} as never);
}

interface Thumbnail {
	readonly clipId: string; readonly sourceId: string;
	readonly width: number; readonly height: number; readonly pixels: Uint8Array;
	readonly opacity: number; readonly blendMode: string;
	readonly presentationIds: readonly string[]; readonly maskIds: readonly string[];
}

test('a placed generator is published as a compositor layer with its materialized geometry', async (t) => {
	useDom(t);
	const preview = await openSession(t);

	const frame = preview.resolve(0);

	assert.equal(frame.layers.length, 1);
	assert.equal(frame.layers[0]!.trackId, 'video-track');
	assert.equal(frame.layers[0]!.blendMode, 'normal');
	const entry = frame.layers[0]!.entries[0]!;
	assert.deepEqual(
		{
			kind: entry.kind, clipId: entry.clipId, sourceId: entry.sourceId,
			available: entry.available, opacity: entry.opacity,
			displayWidth: entry.displayWidth, displayHeight: entry.displayHeight,
			effects: entry.effects, videoWidth: entry.video.videoWidth,
			videoHeight: entry.video.videoHeight, readyState: entry.video.readyState,
		},
		{
			kind: 'solid', clipId: 'generator-clip', sourceId: 'generator-source',
			available: true, opacity: 1, displayWidth: 320, displayHeight: 180,
			effects: [], videoWidth: 320, videoHeight: 180, readyState: 4,
		},
	);
	assert.deepEqual(frame.ledger.consumedNodeIds, frame.ledger.requestedNodeIds);
});

test('an odd preview canvas is rounded down to the even dimensions the codec admits', async (t) => {
	useDom(t);
	const preview = await openSession(t, { width: 321, height: 181 });

	const entry = preview.resolve(0).layers[0]!.entries[0]!;

	assert.deepEqual(
		[entry.displayWidth, entry.displayHeight],
		[320, 180],
		'an odd request must not leak an odd materialized drawable',
	);
});

test('resolving the same timeline sample twice reuses one resolved frame', async (t) => {
	useDom(t);
	const preview = await openSession(t);

	// The published wrapper is rebuilt per call; the ledger it carries is the cached
	// consumer frame, so identity there is the observable cache hit.
	assert.equal(preview.resolve(0).ledger, preview.resolve(0).ledger);
	assert.notEqual(preview.resolve(0).ledger, preview.resolve(FRAME_SAMPLES).ledger);
});

test('a preview session refuses a negative or fractional timeline sample', async (t) => {
	useDom(t);
	const preview = await openSession(t);

	assert.throws(() => preview.resolve(-1), /preview timeline sample must be non-negative/u);
	assert.throws(() => preview.resolve(1.5), /preview timeline sample must be non-negative/u);
});

test('a disposed preview session refuses further frames and tolerates a second dispose', async (t) => {
	useDom(t);
	const preview = await openSession(t);

	preview.dispose();
	preview.dispose();

	assert.throws(() => preview.resolve(0), /visual preview session is disposed/u);
	assert.throws(() => preview.resolveTransitionWeight('generator-clip', 0), /disposed/u);
	await assert.rejects(() => preview.renderExact({ timelineSample: 0, mediaLayers: [] }), /disposed/u);
});

test('a transition weight query requires a stable clip identity', async (t) => {
	useDom(t);
	const preview = await openSession(t);

	assert.throws(() => preview.resolveTransitionWeight('', 0), TypeError);
	assert.throws(
		() => preview.resolveTransitionWeight(7 as unknown as string, 0),
		/A transition clip ID is required/u,
	);
	assert.equal(preview.resolveTransitionWeight('generator-clip', 0), null);
});

test('a dissolve reports complementary outgoing and incoming weights across its span', async (t) => {
	useDom(t);
	const preview = await openSession(t, { project: projectOf(transitionProjectOptions()) });
	const at = (frame: number) => ({
		outgoing: Number(preview.resolveTransitionWeight('outgoing-clip', frame * FRAME_SAMPLES)),
		incoming: Number(preview.resolveTransitionWeight('incoming-clip', frame * FRAME_SAMPLES)),
	});

	const early = at(6);
	const late = at(9);

	assert.equal(early.outgoing + early.incoming, 1);
	assert.equal(late.outgoing + late.incoming, 1);
	assert.ok(early.outgoing > late.outgoing, 'a dissolve must hand the picture over as it runs');
	assert.equal(
		preview.resolveTransitionWeight('outgoing-clip', 0),
		null,
		'a sample before the transition span carries no weight at all',
	);
});

test('a hidden track withholds its visual from the published frame', async (t) => {
	useDom(t);
	const options = generatorOptions();
	(options.tracks as Data[])[0]!.hidden = true;
	const preview = await openSession(t, { project: projectOf(options) });

	assert.deepEqual(preview.resolve(0).layers, []);
});

test('a soloed track withholds every visual that is not soloed with it', async (t) => {
	useDom(t);
	const options = generatorOptions();
	(options.tracks as Data[]).splice(1, 0, {
		id: 'solo-track', name: 'Solo', type: 'video', clipIds: [], height: 96,
		collapsed: false, mute: false, solo: true, hidden: false,
	});
	(options.sequences as Data[])[0]!.trackIds = ['video-track', 'solo-track', 'audio-track'];
	const preview = await openSession(t, { project: projectOf(options) });

	assert.deepEqual(
		preview.resolve(0).layers,
		[],
		'a solo elsewhere silences the generator track the same way hiding it does',
	);
});

test('an active adjustment layer publishes the plan-owned effects it names', async (t) => {
	useDom(t);
	const options = generatorOptions();
	options.visualModel = visualModel({
		generatorSources: [generatorSource()], adjustmentLayers: [adjustmentLayer(['effect-1'])],
	});
	(options.clips as Data[])[0]!.videoEffects = [
		{ id: 'effect-1', type: 'pixelate', enabled: true, params: { blockSize: 2 } },
	];
	const preview = await openSession(t, { project: projectOf(options) });

	const [adjustment, ...rest] = preview.resolve(0).adjustments;

	assert.deepEqual(rest, []);
	assert.deepEqual(
		{
			targetTrackIds: adjustment!.targetTrackIds, opacity: adjustment!.opacity,
			blendMode: adjustment!.blendMode, maskIds: adjustment!.maskIds,
			effectIds: adjustment!.effects.map((effect) => (effect as Data).id),
		},
		{
			targetTrackIds: ['video-track'], opacity: 1, blendMode: 'normal',
			maskIds: [], effectIds: ['effect-1'],
		},
	);
});

test('renderExact composes the exact output layer over the published preview frame', async (t) => {
	useDom(t);
	const preview = await openSession(t);

	const result = await preview.renderExact({ timelineSample: 0, mediaLayers: [] });

	assert.equal(result.layers.length, 1);
	assert.equal(result.layers[0]!.trackId, 'framescaper-exact-output');
	assert.deepEqual(result.renderedEffectIds, []);
});

test('a picture range that misses the primary sequence composes no preview plan', async (t) => {
	useDom(t);
	const options = generatorOptions();
	(options.sequences as Data[]).push({ id: 'alt-sequence', rate: { num: 10, den: 1 }, trackIds: [] });
	options.primarySequenceId = 'alt-sequence';

	await assert.rejects(
		() => openSession(t, { project: projectOf(options) }),
		/requires a non-empty picture range/u,
	);
});

test('a video source whose exact timing index is unregistered refuses the preview', async (t) => {
	useDom(t);
	const options = generatorOptions();
	const source = (options.sources as Data[])[0]!;
	source.timingDecision = { mode: 'exact', rate: { num: 10, den: 1 } };
	source.timingAsset = {
		encoding: 'soundscaper-video-timing-v1',
		storageKey: `video-timing-sha256:${'ab'.repeat(32)}`,
		sha256: 'ab'.repeat(32), sourceSha256: '12'.repeat(32),
		byteLength: 32 + 10 * 8, frameCount: 10, timescale: 600, finalFrameDurationTicks: '60',
	};

	await assert.rejects(
		() => openSession(t, { project: projectOf(options) }),
		/exact timing is not loaded for preview/u,
	);
});

test('a placed external generator without an OpenFX host is refused before the session opens', async (t) => {
	useDom(t);

	await assert.rejects(
		() => openSession(t, { project: projectOf(externalGeneratorOptions()) }),
		/unconsumed active nodes: render:visual:generator-clip/u,
	);
});

test('an OpenFX host admits the external generator at full canvas size with a blank plate', async (t) => {
	useDom(t);
	const preview = await openSession(t, {
		project: projectOf(externalGeneratorOptions()),
		createOpenFxExecution: ({ foundationPlan }: Data) => ({
			// The host owns a V14 graph; this fixture carries no OpenFX node to execute.
			plan: { ...(foundationPlan as Data), version: 14 },
			execute: () => Promise.reject(new Error('never invoked')),
		}),
	});

	const entry = preview.resolve(0).layers[0]!.entries[0]!;

	assert.deepEqual(
		{ kind: entry.kind, width: entry.displayWidth, height: entry.displayHeight },
		{ kind: 'external-generator', width: 320, height: 180 },
	);
});

test('a Project Bin generator thumbnail materializes its solid at the requested size', async () => {
	const options = generatorOptions();
	(options.projectBin as Data).clips = [generatorClip({ id: 'bin-generator' })];

	const thumbnail = await binThumbnail(options) as Thumbnail;

	assert.deepEqual(
		{
			clipId: thumbnail.clipId, sourceId: thumbnail.sourceId,
			width: thumbnail.width, height: thumbnail.height, length: thumbnail.pixels.length,
			opacity: thumbnail.opacity, blendMode: thumbnail.blendMode,
			presentationIds: thumbnail.presentationIds, maskIds: thumbnail.maskIds,
		},
		{
			clipId: 'bin-generator', sourceId: 'generator-source', width: 8, height: 4,
			length: 8 * 4 * 4, opacity: 1, blendMode: 'normal', presentationIds: [], maskIds: [],
		},
	);
	assert.deepEqual([...thumbnail.pixels.slice(0, 4)], [0x20, 0x40, 0x60, 0x80]);
});

test('an authored presentation opacity is baked into the Project Bin thumbnail alpha', async () => {
	const options = generatorOptions();
	(options.projectBin as Data).clips = [generatorClip({ id: 'bin-generator' })];
	options.finishing = { visualPresentations: [presentation({ opacity: 0.5, blendMode: 'screen' })] };

	const thumbnail = await binThumbnail(options) as Thumbnail;

	assert.deepEqual(
		{ opacity: thumbnail.opacity, blendMode: thumbnail.blendMode, ids: thumbnail.presentationIds },
		{ opacity: 0.5, blendMode: 'screen', ids: ['presentation-1'] },
	);
	assert.deepEqual(
		[...thumbnail.pixels.slice(0, 4)],
		[0x20, 0x40, 0x60, 0x40],
		'only the alpha channel carries the presentation opacity',
	);
});

test('a Project Bin thumbnail refuses a non-positive requested size', async () => {
	const options = generatorOptions();
	(options.projectBin as Data).clips = [generatorClip({ id: 'bin-generator' })];

	await assert.rejects(
		() => binThumbnail(options, { width: 0 }),
		/Project Bin thumbnail width must be positive/u,
	);
	await assert.rejects(
		() => binThumbnail(options, { height: -4 }),
		/Project Bin thumbnail height must be positive/u,
	);
});

test('a Project Bin thumbnail refuses a dormant external generator', async () => {
	const options = generatorOptions();
	options.visualModel = visualModel({
		generatorSources: [generatorSource({
			id: 'external-source',
			generator: { kind: 'external-generator', bindingId: 'video-source', inputs: [] },
		}), generatorSource()],
	});
	(options.projectBin as Data).clips = [generatorClip({
		id: 'bin-generator', sourceId: 'external-source',
	})];

	await assert.rejects(
		() => binThumbnail(options),
		/Dormant external generators have no Project Bin thumbnail/u,
	);
});

test('an already aborted signal cancels a Project Bin thumbnail before it materializes', async () => {
	const options = generatorOptions();
	(options.projectBin as Data).clips = [generatorClip({ id: 'bin-generator' })];
	const controller = new AbortController();
	const reason = new DOMException('the bin selection moved on', 'AbortError');
	controller.abort(reason);

	await assert.rejects(
		() => binThumbnail(options, { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
});

/** A still fixture whose declared digest genuinely authenticates the seeded body. */
async function stillOptions(bodyDigest?: string): Promise<Readonly<{ options: Data; body: Blob }>> {
	const body = new Blob([new Uint8Array([1, 2, 3, 4])]);
	const options = generatorOptions();
	options.visualModel = visualModel({
		stillSources: [{
			schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate',
			mimeType: 'image/png', storageKey: 'still-storage',
			contentSha256: bodyDigest ?? await digestMediaContent(body),
			width: 1_920, height: 1_080, hasAlpha: true,
		}],
		generatorSources: [generatorSource()],
	});
	(options.projectBin as Data).clips = [{
		schemaVersion: 1, kind: 'still', id: 'bin-still', sourceId: 'still-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
	}];
	return { options, body };
}

function stillThumbnail(options: Data, body: Blob | null): Promise<unknown> {
	return createThumbnail({
		profile: PROFILE, project: projectOf(options), store: store(body),
		clipId: 'bin-still', width: 8, height: 4,
	} as never);
}

test('a Project Bin still thumbnail decodes its authenticated body through the browser surfaces', async (t) => {
	useDom(t, { width: 4, height: 2 });
	const { options, body } = await stillOptions();

	const thumbnail = await stillThumbnail(options, body) as Thumbnail;

	assert.deepEqual(
		{
			clipId: thumbnail.clipId, sourceId: thumbnail.sourceId,
			width: thumbnail.width, height: thumbnail.height, length: thumbnail.pixels.length,
		},
		{ clipId: 'bin-still', sourceId: 'still-source', width: 8, height: 4, length: 8 * 4 * 4 },
	);
});

test('a Project Bin still thumbnail refuses an unauthenticated, absent, or undecodable body', async (t) => {
	let restore = installPreviewDom({ width: 4, height: 2 });
	t.after(() => { restore(); });
	const unauthenticated = await stillOptions('ab'.repeat(32));
	const { options, body } = await stillOptions();

	await assert.rejects(
		() => stillThumbnail(unauthenticated.options, unauthenticated.body),
		/still still-storage failed content authentication/u,
	);
	await assert.rejects(() => stillThumbnail(options, null), /still still-storage is unavailable/u);
	restore();
	restore = installPreviewDom();
	await assert.rejects(
		() => stillThumbnail(options, body),
		/still preview requires browser image decode/u,
	);
});
