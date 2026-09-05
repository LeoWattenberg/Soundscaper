/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import {
	prepareFramescaperSelectedAuthoringFinishing as prepare,
} from '../src/framescaper/editor-selected-finishing-authoring-workflows.ts';

type Data = Record<string, unknown>;

interface Prepared {
	readonly command: Data;
	readonly rollback?: () => Promise<void>;
}

interface StoreCalls {
	readonly writes: Array<Readonly<{ sourceId: string; blob: Blob; metadata: Data }>>;
	readonly deletes: string[];
	readonly derivatives: Array<Readonly<{ sourceId: string; selector: Data }>>;
}

interface BrowserOptions {
	readonly file?: File | null;
	readonly event?: 'change' | 'cancel';
	readonly bitmap?: Readonly<{ width: number; height: number }> | null;
}

interface Browser {
	readonly state: Readonly<{ removed: number; appended: number; closed: number }>;
	readonly input: Readonly<{ type: string; accept: string; hidden: boolean }>;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const NO_DISSOLVE = /Select or create two adjacent unlinked video clips before adding a dissolve/u;
const PNG = new File([new Uint8Array([1, 2, 3, 4])], 'Beach shot.png', { type: 'image/png' });

function project(overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1, sampleRate: 48_000, primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 } }],
		tracks: [], clips: [], sources: [], videoAdjustmentLayers: [], videoMaskMattes: [], selection: {},
		...overrides,
	};
}

function videoTrack(id: string, clipIds: readonly string[], locked = false): Data {
	return { id, type: 'video', locked, clipIds: [...clipIds] };
}

function videoClip(id: string, start: number, count: number, overrides: Data = {}): Data {
	return {
		kind: 'video', id, sourceId: 'video-source', sequenceId: 'main-sequence',
		sequenceStartFrame: start, sequenceFrameCount: count, ...overrides,
	};
}

/** One unlocked video track holding two abutting ten-frame clips. */
function adjacent(overrides: Data = {}): Data {
	return project({
		tracks: [videoTrack('video-track', ['clip-a', 'clip-b'])],
		clips: [videoClip('clip-a', 0, 10), videoClip('clip-b', 10, 10)],
		...overrides,
	});
}

function store(poster: Blob | null = null): Readonly<{ calls: StoreCalls; value: unknown }> {
	const calls: StoreCalls = { writes: [], deletes: [], derivatives: [] };
	return {
		calls,
		value: {
			writeMediaAsset: async (sourceId: string, blob: Blob, metadata: Data): Promise<void> => {
				calls.writes.push({ sourceId, blob, metadata });
			},
			deleteMediaAsset: async (sourceId: string): Promise<void> => { calls.deletes.push(sourceId); },
			loadVideoDerivative: async (sourceId: string, selector: Data): Promise<Blob | null> => {
				calls.derivatives.push({ sourceId, selector });
				return poster;
			},
		},
	};
}

async function author(surface: string, value: unknown, storeValue: unknown = store().value): Promise<Prepared | null> {
	return await prepare(surface as never, value, storeValue as never) as unknown as Prepared | null;
}

function batched(prepared: Prepared | null): Data[] {
	assert.ok(prepared, 'the surface must prepare a command');
	assert.equal(prepared.command.type, 'batch', 'a multi-command preparation is one batch');
	return prepared.command.commands as Data[];
}

function commandOfType(commands: readonly Data[], type: string): Data {
	const found = commands.find((command) => command.type === type);
	assert.ok(found, `the batch must carry a ${type} command`);
	return found;
}

function types(commands: readonly Data[]): unknown[] {
	return commands.map((command) => command.type);
}

function sourceOf(commands: readonly Data[]): Data {
	return commandOfType(commands, 'video-visual-source/set').source as Data;
}

async function digestValue(value: unknown): Promise<string> {
	return await digestMediaContent(new Blob([JSON.stringify(value)], { type: 'application/json' }));
}

/** Stand in for the file input and bitmap decoder the still workflows reach for. */
async function withBrowser(options: BrowserOptions, body: (browser: Browser) => Promise<void>): Promise<void> {
	const globals = globalThis as unknown as { document?: unknown; createImageBitmap?: unknown };
	const had = { document: Object.hasOwn(globals, 'document'), bitmap: Object.hasOwn(globals, 'createImageBitmap') };
	const previous = { document: globals.document, bitmap: globals.createImageBitmap };
	const listeners = new Map<string, () => void>();
	const state = { removed: 0, appended: 0, closed: 0 };
	const file = options.file ?? null;
	const bitmap = options.bitmap ?? null;
	const input = {
		type: '', accept: '', hidden: false, files: file ? [file] : null,
		addEventListener: (name: string, listener: () => void): void => { listeners.set(name, listener); },
		remove: (): void => { state.removed += 1; },
		click: (): void => { listeners.get(options.event ?? 'change')?.(); },
	};
	globals.document = { createElement: (): unknown => input, body: { append: (): void => { state.appended += 1; } } };
	if (bitmap === null) delete globals.createImageBitmap;
	else {
		globals.createImageBitmap = async (): Promise<unknown> => ({
			width: bitmap.width, height: bitmap.height, close: (): void => { state.closed += 1; },
		});
	}
	try {
		await body({ state, input });
	} finally {
		if (had.document) globals.document = previous.document;
		else delete globals.document;
		if (had.bitmap) globals.createImageBitmap = previous.bitmap;
		else delete globals.createImageBitmap;
	}
}

test('a title generator authors its own video track, source, and clip in one batch', async () => {
	const prepared = await author('video-title', project());

	const commands = batched(prepared);
	const track = commands[0]?.track as Data;
	const source = sourceOf(commands);
	const clipCommand = commandOfType(commands, 'video-visual-clip/set');
	const clip = clipCommand.clip as Data;
	assert.deepEqual(types(commands), ['track/add', 'video-visual-source/set', 'video-visual-clip/set']);
	assert.deepEqual(
		{ type: track.type, name: track.name, index: commands[0]?.index },
		{ type: 'video', name: 'Visuals', index: 0 },
	);
	assert.deepEqual({
		kind: source.kind, name: source.name, width: source.width, height: source.height,
		frameRate: source.frameRate, frameCount: source.frameCount,
	}, {
		kind: 'generator', name: 'Title', width: 1_920, height: 1_080,
		frameRate: { num: 10, den: 1 }, frameCount: 50,
	});
	assert.deepEqual(clipCommand.placement, { scope: 'timeline', trackId: track.id });
	assert.deepEqual({
		kind: clip.kind, sourceId: clip.sourceId, sequenceId: clip.sequenceId, start: clip.sequenceStartFrame,
		count: clip.sequenceFrameCount, inFrame: clip.sourceInFrame, sourceCount: clip.sourceFrameCount,
	}, {
		kind: 'generator', sourceId: source.id, sequenceId: 'main-sequence', start: 0,
		count: 50, inFrame: 0, sourceCount: 50,
	});
	assert.equal(prepared?.rollback, undefined, 'a generator roots no owned media to roll back');
});

test('each generator surface carries its own kind and default styling', async () => {
	const generators = new Map<string, Data>();
	for (const surface of ['video-title', 'video-text', 'video-shape', 'video-solid']) {
		const source = sourceOf(batched(await author(surface, project())));
		generators.set(String(source.name), source.generator as Data);
	}

	assert.deepEqual([...generators.keys()], ['Title', 'Text', 'Shape', 'Solid']);
	assert.deepEqual(generators.get('Title'), {
		kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
		color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
	});
	assert.deepEqual(generators.get('Text'), {
		kind: 'text', text: 'Text', fontFamily: 'soundscaper-sans', fontSize: 64,
		color: '#ffffffff', horizontalAlign: 'start', verticalAlign: 'middle',
	});
	assert.deepEqual(generators.get('Shape'), {
		kind: 'shape', shape: 'rectangle', fillColor: '#ffffffff', strokeColor: null, strokeWidth: 0,
	});
	assert.deepEqual(generators.get('Solid'), { kind: 'solid', color: '#000000ff' });
});

test('a generator follows the selected unlocked track and lands after the clips already on it', async () => {
	const placed = project({
		tracks: [videoTrack('locked', ['locked-clip'], true), videoTrack('track-a', ['a1']), videoTrack('track-b', ['b1', 'b2'])],
		clips: [
			videoClip('locked-clip', 0, 500), videoClip('a1', 0, 120), videoClip('b1', 0, 4),
			videoClip('b2', 10, 6, { sequenceId: 'other-sequence' }),
		],
	});
	const placement = async (surface: string, trackIds: readonly string[]): Promise<Data> => commandOfType(
		batched(await author(surface, { ...placed, selection: { trackIds: [...trackIds] } })), 'video-visual-clip/set',
	);

	const selected = await placement('video-shape', ['track-b']);
	const fallback = await placement('video-solid', ['locked']);

	assert.deepEqual(selected.placement, { scope: 'timeline', trackId: 'track-b' });
	assert.equal((selected.clip as Data).sequenceStartFrame, 4, 'a clip in another sequence must not push the start');
	assert.deepEqual(fallback.placement, { scope: 'timeline', trackId: 'track-a' }, 'a locked track is never the target');
	assert.equal((fallback.clip as Data).sequenceStartFrame, 120);
});

test('visual authoring refuses an unresolvable primary sequence and an unsafe clip range', async () => {
	const missing = /Framescaper visual authoring requires a primary sequence/u;
	await assert.rejects(() => author('video-title', project({ primarySequenceId: 'ghost' })), missing);
	await assert.rejects(() => author('video-title', project({ primarySequenceId: 42, sequences: [] })), missing);
	await assert.rejects(() => author('video-title', project({
		tracks: [videoTrack('track-a', ['huge'])], clips: [videoClip('huge', Number.MAX_SAFE_INTEGER, 1)],
	})), /The visual clip range exceeds safe integers/u);
});

test('the sequence rate sets the generator duration and must be a positive integer pair', async () => {
	const withRate = async (rate: unknown): Promise<Prepared | null> => author('video-text', project({
		sequences: [{ id: 'main-sequence', ...(rate === null ? {} : { rate }) }],
	}));

	const source = sourceOf(batched(await withRate({ num: 30_000, den: 1_001 })));
	assert.deepEqual(source.frameRate, { num: 30_000, den: 1_001 });
	assert.equal(source.frameCount, 150, '30000/1001 for five seconds rounds to 150 frames');
	await assert.rejects(() => withRate(null), /sequence rate must be an object/u);
	await assert.rejects(() => withRate({ num: 0, den: 1 }), /sequence rate numerator must be positive/u);
	await assert.rejects(() => withRate({ num: 10, den: 0 }), /sequence rate denominator must be positive/u);
});

test('an adjustment layer targets the selected video clip and the track that holds it', async () => {
	const commands = batched(await author('video-adjustment-layer', project({
		tracks: [videoTrack('locked', ['clip-a'], true), videoTrack('video-track', ['clip-a', 'clip-b'])],
		clips: [videoClip('clip-a', 0, 10), videoClip('clip-b', 10, 25)],
		selection: { clipIds: ['clip-b'] },
	})));

	const effect = commandOfType(commands, 'video-effect/add');
	const effectValue = effect.effect as Data;
	const layerCommand = commandOfType(commands, 'video-adjustment-layer/set');
	const layer = layerCommand.adjustmentLayer as Data;
	assert.equal(effect.clipId, 'clip-b', 'the selected clip outranks the first candidate');
	assert.equal(effectValue.type, 'color-adjust');
	assert.deepEqual(effectValue.params, { brightness: 0.25, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 });
	assert.equal(layerCommand.expectedAdjustmentLayer, null);
	assert.equal(layerCommand.adjustmentLayerId, layer.id);
	assert.deepEqual({
		kind: layer.kind, sequenceId: layer.sequenceId, start: layer.sequenceStartFrame,
		count: layer.sequenceFrameCount, tracks: layer.targetTrackIds, effects: layer.effectIds,
	}, {
		kind: 'adjustment-layer', sequenceId: 'main-sequence', start: 10, count: 25,
		tracks: ['video-track'], effects: [effectValue.id],
	});
});

test('an adjustment layer ignores locked tracks, audio tracks, and non-video clips', async () => {
	await assert.rejects(() => author('video-adjustment-layer', project({
		tracks: [
			{ id: 'audio-track', type: 'audio', clipIds: ['audio-clip'] }, videoTrack('locked', ['clip-a'], true),
			videoTrack('stills', ['still-clip', 'ghost-clip']), { id: 'no-clip-list', type: 'video' },
		],
		clips: [
			videoClip('clip-a', 0, 10), { kind: 'audio', id: 'audio-clip' },
			{ kind: 'still', id: 'still-clip', sequenceStartFrame: 0, sequenceFrameCount: 5 },
		],
	})), /Import and select a timeline video clip before adding an adjustment layer/u);
});

test('an adjustment layer refuses a clip whose sequence placement is not well formed', async () => {
	const rejected = async (clip: Data, message: RegExp): Promise<void> => {
		await assert.rejects(() => author('video-adjustment-layer', project({
			tracks: [videoTrack('video-track', ['clip-a'])], clips: [clip],
		})), message);
	};

	await rejected(videoClip('clip-a', 0, 10, { sequenceId: 'not a stable id' }), /adjustment sequence ID must be a stable ID/u);
	await rejected(videoClip('clip-a', -1, 10), /adjustment start must be non-negative/u);
	await rejected(videoClip('clip-a', 0, 0), /adjustment duration must be positive/u);
});

test('a mask matte is authored as one rectangle command rather than a batch', async () => {
	const prepared = await author('video-mask-matte', project());

	assert.ok(prepared);
	const matte = prepared.command.maskMatte as Data;
	assert.equal(prepared.command.type, 'video-mask-matte/set');
	assert.equal(prepared.command.expectedMaskMatte, null);
	assert.equal(prepared.command.maskMatteId, matte.id);
	assert.deepEqual(matte.inputs, []);
	assert.deepEqual(matte.nodes, [{
		id: matte.outputNodeId, kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1,
	}]);
});

test('a visual preset fingerprints the last authored model and ignores foreign source kinds', async () => {
	const generator = { schemaVersion: 1, kind: 'generator', id: 'gen-1', generator: { kind: 'solid' } };
	const matte = { schemaVersion: 1, id: 'mask-1', kind: 'mask', inputs: [], nodes: [] };
	const sources = [generator, { kind: 'video', id: 'video-source' }, { kind: 'still', id: 'still-1' }];

	const last = await author('video-visual-preset', project({
		sources, videoMaskMattes: [matte],
		videoAdjustmentLayers: [{ schemaVersion: 1, id: 'layer-1', kind: 'adjustment-layer' }],
	}));
	const only = await author('video-visual-preset', project({ sources }));

	assert.ok(last);
	assert.ok(only);
	const preset = last.command.preset as Data;
	assert.equal(last.command.type, 'video-visual-preset/set');
	assert.equal(last.command.presetId, preset.id);
	assert.deepEqual({
		kind: preset.kind, name: preset.name, modelKind: preset.modelKind, sha: preset.authoredStateSha256,
	}, {
		kind: 'video-preset', name: 'Visual Preset', modelKind: 'mask-matte',
		sha: fingerprintNativeMediaPlan(matte).sha256,
	});
	assert.deepEqual({
		modelKind: (only.command.preset as Data).modelKind, sha: (only.command.preset as Data).authoredStateSha256,
	}, { modelKind: 'generator', sha: fingerprintNativeMediaPlan(generator).sha256 });
});

test('a dissolve moves the incoming clip back over its neighbour and allocates the transition', async () => {
	const prepared = await author('video-transition-dissolve', adjacent({
		tracks: [{ id: 'audio-track', type: 'audio', clipIds: [] }, videoTrack('video-track', ['clip-b', 'clip-a'])],
	}));

	assert.ok(prepared);
	const command = prepared.command;
	const allocations = command.videoTransitionAllocations as Data[];
	assert.deepEqual(
		{ type: command.type, clipId: command.clipId, trackId: command.trackId, start: command.timelineStartFrame },
		// Five frames of overlap at 10 fps against a 48 kHz timeline is sample frame 24000.
		{ type: 'clip/move', clipId: 'clip-b', trackId: 'video-track', start: 24_000 },
	);
	assert.equal(allocations.length, 1);
	assert.deepEqual(
		{ track: allocations[0]?.trackId, out: allocations[0]?.outgoingClipId, in: allocations[0]?.incomingClipId },
		{ track: 'video-track', out: 'clip-a', in: 'clip-b' },
	);
	assert.match(String(allocations[0]?.transitionId), /^transition-/u);
});

test('a dissolve caps its overlap at twelve frames and never drops below one', async () => {
	const capped = await author('video-transition', adjacent({
		clips: [videoClip('clip-a', 0, 100), videoClip('clip-b', 100, 100)],
	}));
	const floored = await author('video-transition', adjacent({
		clips: [videoClip('clip-a', 0, 1), videoClip('clip-b', 1, 1)],
	}));

	// 100 - 12 = 88 video frames and 1 - 1 = 0 video frames, both scaled to 48 kHz.
	assert.equal(capped?.command.timelineStartFrame, 422_400);
	assert.equal(floored?.command.timelineStartFrame, 0);
});

test('a dissolve refuses linked, overlapping, locked, cross-sequence, and unmeasurable neighbours', async () => {
	const linked = [videoClip('clip-a', 0, 10, { avLinkId: 'a1' }), videoClip('clip-b', 10, 10, { avLinkId: 'a2' })];
	const ghost = [videoClip('clip-a', 0, 10, { sequenceId: 'ghost' }), videoClip('clip-b', 10, 10, { sequenceId: 'ghost' })];
	const cases: ReadonlyArray<readonly [Data, RegExp]> = [
		[{ clips: linked }, NO_DISSOLVE],
		[{ clips: [videoClip('clip-a', 0, 10), videoClip('clip-b', 5, 10)] }, NO_DISSOLVE],
		[{ tracks: [videoTrack('video-track', ['clip-a', 'clip-b'], true)] }, NO_DISSOLVE],
		[{ clips: [videoClip('clip-a', 0, 10), videoClip('clip-b', 10, 10, { sequenceId: 'other' })] }, NO_DISSOLVE],
		[{ clips: ghost }, NO_DISSOLVE],
		[{ sampleRate: 0 }, /project\.sampleRate must be positive/u],
	];

	for (const [index, [overrides, message]] of cases.entries()) {
		await assert.rejects(
			() => author('video-transition', adjacent(overrides)), message, `dissolve case ${String(index)} must be refused`,
		);
	}
});

test('still import prepares nothing when the file dialog is cancelled', async () => {
	await withBrowser({ event: 'cancel', bitmap: { width: 8, height: 8 } }, async (browser) => {
		const backing = store();

		const prepared = await author('video-still', project(), backing.value);

		assert.equal(prepared, null);
		assert.deepEqual(backing.calls.writes, [], 'a cancelled dialog must write no media');
		assert.deepEqual(
			{ type: browser.input.type, accept: browser.input.accept, hidden: browser.input.hidden },
			{ type: 'file', accept: 'image/*', hidden: true },
		);
		assert.deepEqual({ appended: browser.state.appended, removed: browser.state.removed }, { appended: 1, removed: 1 });
	});
});

test('an imported still is written to the store with its measured size, digest, and rollback', async () => {
	await withBrowser({ file: PNG, bitmap: { width: 640, height: 480 } }, async (browser) => {
		const backing = store();

		const prepared = await author('video-still', project(), backing.value);
		const commands = batched(prepared);
		const source = sourceOf(commands);

		assert.deepEqual(types(commands), ['track/add', 'video-visual-source/set', 'video-visual-clip/set']);
		assert.deepEqual({
			kind: source.kind, name: source.name, mimeType: source.mimeType, storageKey: source.storageKey,
			width: source.width, height: source.height, hasAlpha: source.hasAlpha, sha: source.contentSha256,
		}, {
			kind: 'still', name: 'Beach shot.png', mimeType: 'image/png', storageKey: source.id,
			width: 640, height: 480, hasAlpha: true, sha: await digestMediaContent(PNG),
		});
		assert.equal(backing.calls.writes.length, 1);
		assert.equal(backing.calls.writes[0]?.sourceId, source.id);
		assert.deepEqual(backing.calls.writes[0]?.metadata, {
			name: 'Beach shot.png', mimeType: 'image/png', width: 640, height: 480,
		});
		assert.equal(browser.state.closed, 1, 'the measured bitmap must be closed');

		await prepared?.rollback?.();

		assert.deepEqual(backing.calls.deletes, [source.id]);
	});
});

test('an unnameable still file falls back to the Still label and an opaque source', async () => {
	const file = new File([new Uint8Array([9])], '  ', { type: 'image/jpeg' });
	await withBrowser({ file, bitmap: { width: 4, height: 4 } }, async () => {
		const backing = store();

		const source = sourceOf(batched(await author('video-still', project(), backing.value)));

		assert.equal(source.name, 'Still');
		assert.equal(source.hasAlpha, false, 'jpeg carries no alpha channel');
		assert.equal(backing.calls.writes[0]?.metadata.name, 'Still');
	});
});

test('still import refuses a non-image file, a missing decoder, and a zero-sized bitmap', async () => {
	const backing = store();
	const pdf = new File([new Uint8Array([1])], 'report.pdf', { type: 'application/pdf' });
	const rejected = async (message: RegExp): Promise<void> => {
		await assert.rejects(() => author('video-still', project(), backing.value), message);
	};

	await withBrowser({ file: pdf, bitmap: { width: 10, height: 10 } }, async () => {
		await rejected(/Framescaper still authoring requires an image media type/u);
	});
	await withBrowser({ file: PNG, bitmap: null }, async (browser) => {
		await rejected(/This browser cannot inspect still-image dimensions/u);
		assert.equal(browser.state.appended, 1);
	});
	await withBrowser({ file: PNG, bitmap: { width: 0, height: 480 } }, async (browser) => {
		await rejected(/still width must be positive/u);
		assert.equal(browser.state.closed, 1, 'the bitmap must be closed even when it is rejected');
	});
	assert.deepEqual(backing.calls.writes, [], 'no refused still may reach the store');
});

function freezeProject(overrides: Data = {}): Data {
	return adjacent({
		sources: [{
			kind: 'video', id: 'video-source', name: 'Beach\nVideo',
			width: 1_920, height: 1_080, contentSha256: 'ab'.repeat(32),
		}],
		selection: { clipIds: ['clip-b'] },
		...overrides,
	});
}

test('a freeze frame renders the poster into a still and binds it to a freshness fallback', async () => {
	const poster = new Blob([new Uint8Array([7, 7, 7])], { type: 'image/png' });
	const backing = store(poster);

	const prepared = await author('video-freeze', freezeProject(), backing.value);
	const commands = batched(prepared);
	const source = sourceOf(commands);
	const fallbackCommand = commandOfType(commands, 'video-freeze-fallback/set');
	const fallback = fallbackCommand.freezeFallback as Data;

	assert.deepEqual(types(commands), ['video-visual-source/set', 'video-visual-clip/set', 'video-freeze-fallback/set']);
	assert.deepEqual(backing.calls.derivatives, [{ sourceId: 'video-source', selector: { timestamp: 0, type: 'poster' } }]);
	assert.deepEqual(backing.calls.writes[0]?.metadata, {
		name: 'Beach Video Freeze', mimeType: 'image/png', width: 1_920, height: 1_080,
	});
	assert.equal(fallbackCommand.renderedSourceId, source.id);
	assert.equal(fallbackCommand.expectedFreezeFallback, null);
	assert.deepEqual({
		schemaVersion: fallback.schemaVersion, rendered: fallback.renderedSourceId,
		asset: fallback.renderedAssetSha256, authored: fallback.authoredStateSha256,
		inputs: fallback.inputIdentitiesSha256, plan: fallback.renderPlanFingerprintSha256,
		native: fallback.nativeEffectFingerprintSha256,
	}, {
		schemaVersion: 1, rendered: source.id, asset: await digestMediaContent(poster),
		authored: fingerprintNativeMediaPlan({ schemaVersion: 1, kind: 'video-freeze', renderedSourceId: source.id }).sha256,
		inputs: await digestValue({ sourceId: 'video-source', digest: 'ab'.repeat(32) }),
		// The selected clip, not the first video clip, identifies the render plan.
		plan: await digestValue({ schemaVersion: 13, clipId: 'clip-b' }),
		native: await digestValue({ nativeEffects: false }),
	});
	assert.match(String(fallback.freshnessSha256), SHA256);

	await prepared?.rollback?.();

	assert.deepEqual(backing.calls.deletes, [source.id]);
});

test('a freeze frame refuses a missing clip, a missing source, a missing poster, and a sizeless source', async () => {
	const poster = new Blob([new Uint8Array([1])], { type: 'image/png' });
	const rejected = async (overrides: Data, blob: Blob | null, message: RegExp): Promise<void> => {
		await assert.rejects(() => author('video-freeze', freezeProject(overrides), store(blob).value), message);
	};

	await rejected({ clips: [], selection: {} }, poster, /Select a timeline video clip before freezing a frame/u);
	await rejected({ sources: [] }, poster, /video source is unavailable for freeze-frame capture/u);
	await rejected({}, null, /no local poster available for a deterministic freeze frame/u);
	await rejected(
		{ sources: [{ kind: 'video', id: 'video-source', name: 'Video', width: 0, height: 1_080 }] },
		poster, /video source\.width must be positive/u,
	);
});

test('a foreign or future project schema cannot author any finishing surface', async () => {
	await assert.rejects(() => author('video-mask-matte', project({ schemaVersion: 2 })), /cannot author a future project/u);
	await assert.rejects(
		() => author('video-mask-matte', project({ schemaFamily: 'soundscaper' })), /cannot author a foreign project/u,
	);
	await assert.rejects(() => author('video-mask-matte', []), TypeError);
});
