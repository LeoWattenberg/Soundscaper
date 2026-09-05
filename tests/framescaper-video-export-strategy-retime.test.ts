/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSetVideoKeyframesCommand } from '../src/common/editor/commands/factories.ts';
import type {
	ProductVideoExportPlan,
	ProductVideoExportStrategy,
} from '../src/common/editor/controller/product-video-export-strategy.ts';
import {
	FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandRetime,
} from '../src/framescaper/editor-project-retime-commands.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';
import {
	createFramescaperVideoExportStrategyRetime,
} from '../src/framescaper/video-export-strategy-retime.ts';
import { framescaperV20Options, opacityKeyframes } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

/** The V20 fixture authors no curves, so its only video clip dispatches to legacy V6. */
function neutralProject(): Data {
	return createFramescaperProjectRetime(PROFILE, framescaperV20Options() as never) as unknown as Data;
}

/** Authoring one opacity curve is what moves the same range onto the keyed route. */
function keyedProject(): Data {
	const project = neutralProject();
	const clip = (project.clips as Data[]).find(({ id }) => id === 'video-clip')!;
	return applyFramescaperProjectCommandRetime(
		PROFILE, project as never,
		createSetVideoKeyframesCommand('video-clip', clip.videoKeyframes, opacityKeyframes()) as never,
		{ now: '2026-09-01T00:00:00.000Z' } as never,
	) as unknown as Data;
}

function delivery(): Data {
	return {
		project: { deliveryProjection: true },
		audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	};
}

const ENCODED_IDENTITY = Object.freeze({
	videoEncoder: 'ffmpeg', format: 'mp4', extension: '.mp4', mimeType: 'video/mp4',
});

function encodedBytes(overrides: Data = {}): Data {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	return { ...ENCODED_IDENTITY, bytes, byteLength: bytes.byteLength, ...overrides };
}

function encodedSink(overrides: Data = {}): Data {
	return { ...ENCODED_IDENTITY, output: 'sink-handle', byteLength: 12, outputChunkCount: 3, ...overrides };
}

function encoders(overrides: Data = {}): Data {
	return {
		encodeOffline: async () => encodedBytes(),
		encodeOfflineToSink: async () => encodedSink(),
		...overrides,
	};
}

interface Harness {
	readonly strategy: ProductVideoExportStrategy;
	readonly project: Data;
	readonly exportProject: Data;
}

function harness(
	project: Data = keyedProject(),
	dependencies: Data = encoders(),
	options: Data = {},
): Harness {
	const strategy = createFramescaperVideoExportStrategyRetime(
		PROFILE, dependencies as never, options as never,
	);
	const exportProject = strategy.createExportProject({
		canonicalProject: project as never, delivery: delivery() as never,
	}) as Data;
	return { strategy, project, exportProject };
}

function planRequest(built: Harness, overrides: Data = {}): never {
	return {
		canonicalProject: built.project, exportProject: built.exportProject,
		format: 'mp4', range: 'project', includeAudio: false, canvas: undefined,
		...overrides,
	} as unknown as never;
}

function videoBlobs(): ReadonlyMap<string, Blob> {
	return new Map([['video-source', new Blob(['picture'])]]);
}

function encodeRequest(built: Harness, plan: ProductVideoExportPlan, overrides: Data = {}): never {
	return {
		canonicalProject: built.project, exportProject: built.exportProject, plan,
		timingBySourceId: new Map(), videoBlobs: videoBlobs(), audioMix: null,
		editorFfmpeg: { id: 'editor-ffmpeg' }, webCodecs: null,
		signal: new AbortController().signal, assertCurrent: () => undefined,
		maximumOutputBytes: undefined,
		...overrides,
	} as unknown as never;
}

function keyedPlan(built: Harness, overrides: Data = {}): ProductVideoExportPlan {
	return built.strategy.createPlan(planRequest(built, overrides))!;
}

test('a retime export strategy refuses a runtime profile it cannot authenticate', () => {
	assert.throws(() => createFramescaperVideoExportStrategyRetime({ product: 'framescaper' }), TypeError);
	assert.throws(() => createFramescaperVideoExportStrategyRetime(null), TypeError);
});

test('stated dependencies must be an object carrying both offline encoders as own functions', () => {
	const hidden = encoders();
	Object.defineProperty(hidden, 'encodeOfflineToSink', {
		value: () => undefined, enumerable: false, configurable: true, writable: true,
	});
	const inherited = Object.create({ encodeOffline: () => undefined }) as Data;
	inherited.encodeOfflineToSink = () => undefined;

	assert.throws(
		() => createFramescaperVideoExportStrategyRetime(PROFILE, null),
		/dependencies must be an object/u,
	);
	assert.throws(
		() => createFramescaperVideoExportStrategyRetime(PROFILE, [encoders()]),
		/dependencies must be an object/u,
	);
	assert.throws(
		() => createFramescaperVideoExportStrategyRetime(PROFILE, encoders({ encodeOffline: 'encode' })),
		/dependencies\.encodeOffline must be an own function/u,
	);
	assert.throws(
		() => createFramescaperVideoExportStrategyRetime(PROFILE, hidden),
		/dependencies\.encodeOfflineToSink must be an own function/u,
	);
	assert.throws(
		() => createFramescaperVideoExportStrategyRetime(PROFILE, inherited),
		/dependencies\.encodeOffline must be an own function/u,
	);
});

test('omitted dependencies fall back to the shipped offline encoders without refusing', () => {
	assert.doesNotThrow(() => createFramescaperVideoExportStrategyRetime(PROFILE));
});

test('the export projection is a deeply frozen retime projection, not the delivery record', () => {
	const stated = delivery();
	const project = keyedProject();
	const strategy = createFramescaperVideoExportStrategyRetime(PROFILE, encoders() as never);

	const exportProject = strategy.createExportProject({
		canonicalProject: project as never, delivery: stated as never,
	}) as Data;

	// Retime encodes its own playback projection; the delivery record is only authenticated.
	assert.notEqual(exportProject, stated.project);
	assert.ok(Object.hasOwn(exportProject, 'trackFolders'));
	assert.equal(Object.isFrozen(exportProject), true);
	assert.equal(Object.isFrozen(exportProject.sources), true);
	assert.equal(Object.isFrozen((exportProject.sources as Data[])[0]), true);
	assert.throws(() => { exportProject.title = 'Renamed'; }, TypeError);
});

test('a delivery that states a rendered fallback or required sources is refused', () => {
	const project = keyedProject();
	const strategy = createFramescaperVideoExportStrategyRetime(PROFILE, encoders() as never);
	const refusals: Data[] = [
		{ audioRenderedFallback: { storageKey: 'rendered' } },
		{ videoRenderedFallback: { storageKey: 'rendered' } },
		{ requiredAudioSourceIds: ['audio-source'] },
		{ requiredVideoSourceIds: ['video-source'] },
	];

	for (const override of refusals) {
		assert.throws(() => strategy.createExportProject({
			canonicalProject: project as never, delivery: { ...delivery(), ...override } as never,
		}), /refuses a rendered-fallback delivery projection/u);
	}
});

test('delivery fields must be own data properties and its project must be a record', () => {
	const project = keyedProject();
	const strategy = createFramescaperVideoExportStrategyRetime(PROFILE, encoders() as never);
	const accessor = delivery();
	Object.defineProperty(accessor, 'audioRenderedFallback', { get: () => null, enumerable: true });

	assert.throws(() => strategy.createExportProject({
		canonicalProject: project as never, delivery: accessor as never,
	}), /delivery\.audioRenderedFallback must be an own data property/u);
	assert.throws(() => strategy.createExportProject({
		canonicalProject: project as never, delivery: { ...delivery(), project: [] } as never,
	}), /retime delivery project must be a record/u);
	assert.throws(() => strategy.createExportProject({
		canonicalProject: project as never, delivery: { ...delivery(), project: null } as never,
	}), /retime delivery project must be a record/u);
});

test('a plan request is refused when its projection was issued for another canonical project', () => {
	const built = harness();
	const twin = keyedProject();

	assert.throws(
		() => built.strategy.createPlan(planRequest(built, { exportProject: { other: true } })),
		/not owned by its exact canonical project/u,
	);
	// Equal data is not the same authority: ownership is recorded by identity.
	assert.deepEqual(twin.id, built.project.id);
	assert.throws(
		() => built.strategy.createPlan(planRequest(built, { canonicalProject: twin })),
		/not owned by its exact canonical project/u,
	);
});

test('a plan request is refused when the canonical project moved on after its projection', () => {
	const built = harness();

	built.project.title = 'Renamed after projection';

	assert.throws(
		() => built.strategy.createPlan(planRequest(built)),
		/retime export projection diverges from its exact canonical retime project/u,
	);
});

test('a range with no authored keyframes and no retime plans nothing at all', () => {
	const built = harness(neutralProject());

	assert.equal(built.strategy.createPlan(planRequest(built)), null);
});

test('a forced-keyed strategy plans the exact route even without authored keyframes', () => {
	const built = harness(neutralProject(), encoders(), { forceKeyed: true });

	const plan = keyedPlan(built);

	assert.equal(plan.version, 7);
	assert.equal(plan.strategy, 'framescaper-keyframed-rgba-v1');
	assert.deepEqual(plan.activeSourceIds, ['video-source']);
});

test('an authored keyframe range plans the keyed V7 route with its own canvas and inputs', () => {
	const built = harness();

	const plan = keyedPlan(built);
	const withAudio = keyedPlan(built, { includeAudio: true });

	assert.equal(plan.version, 7);
	assert.deepEqual(
		[plan.format, plan.extension, plan.mimeType], ['mp4', 'mp4', 'video/mp4'],
	);
	assert.deepEqual(plan.range, { startFrame: 0, endFrame: 48_000, durationFrames: 48_000 });
	assert.deepEqual((plan.canvas as Data).referenceClipId, 'video-clip');
	assert.deepEqual(plan.inputs.map(({ kind }) => kind), ['video-source']);
	assert.deepEqual(withAudio.inputs.map(({ kind }) => kind), ['video-source', 'staged-audio-mix']);
});

test('a stated delivery quality, layout and format reach the built plan', () => {
	const built = harness();

	const plan = keyedPlan(built, {
		format: 'webm', includeAudio: true, quality: 'high', audioLayout: 'stereo',
	});

	assert.deepEqual(
		[plan.format, plan.extension, plan.mimeType], ['webm', 'webm', 'video/webm'],
	);
	assert.equal(plan.quality, 'high');
	assert.equal((plan.inputs[1] as Data).channelLayout, 'stereo');
	assert.throws(
		() => built.strategy.createPlan(planRequest(built, { quality: 'lossless' })),
		/unsupported delivery quality|must be one of/u,
	);
});

test('a caption request reaches the plan builder and is refused rather than silently dropped', () => {
	const built = harness();

	assert.throws(
		() => built.strategy.createPlan(planRequest(built, { captions: { trackIds: ['caption-track'] } })),
		/keyed export path cannot deliver captions/u,
	);
	// A stated-but-empty caption decision is forwarded and costs the plan nothing.
	assert.equal(keyedPlan(built, { captions: null }).version, 7);
});

test('an encode is refused when its plan is not an exact V7 plan or belongs elsewhere', async () => {
	const built = harness();
	const other = harness();
	const plan = keyedPlan(built);

	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, { version: 7 } as never)),
		TypeError,
	);
	await assert.rejects(
		() => other.strategy.encode(encodeRequest(other, plan)),
		/not owned by this exact retime project snapshot/u,
	);
	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan, { exportProject: { other: true } })),
		/not owned by this exact retime project snapshot/u,
	);
	await assert.rejects(
		() => built.strategy.encodeToSink(
			encodeRequest(built, plan, { canonicalProject: keyedProject() }), {} as never,
		),
		/not owned by this exact retime project snapshot/u,
	);
});

test('an encode requires exactly one authenticated Blob per active source', async () => {
	const built = harness();
	const plan = keyedPlan(built);

	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan, { videoBlobs: new Map() })),
		/must exactly match its active source IDs/u,
	);
	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan, {
			videoBlobs: { get: () => new Blob(['x']), size: 1 },
		})),
		/must exactly match its active source IDs/u,
	);
	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan, {
			videoBlobs: new Map([['other-source', new Blob(['x'])]]),
		})),
		/active source video-source has no authenticated video Blob/u,
	);
});

test('an encode refuses an audio mix that contradicts its detached plan', async () => {
	const built = harness();
	const silent = keyedPlan(built);
	const sounded = keyedPlan(built, { includeAudio: true });

	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, silent, { audioMix: new Blob(['mix']) })),
		/audio mix must exactly match its detached plan/u,
	);
	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, sounded)),
		/audio mix must exactly match its detached plan/u,
	);
});

test('the offline request forwards the projection, canvas and range and omits unstated fields', async () => {
	const seen: Data[] = [];
	const built = harness(keyedProject(), encoders({
		encodeOffline: async (request: Data) => { seen.push(request); return encodedBytes(); },
	}));
	const plan = keyedPlan(built);
	const blobs = videoBlobs();
	const timing = new Map([['video-source', { kind: 'cfr' }]]);
	const signal = new AbortController().signal;
	const assertCurrent = (): undefined => undefined;

	await built.strategy.encode(encodeRequest(built, plan, {
		videoBlobs: blobs, timingBySourceId: timing, signal, assertCurrent,
	}));

	const request = seen[0]!;
	assert.equal(request.project, built.exportProject);
	assert.equal(request.timingBySourceId, timing);
	assert.equal(request.signal, signal);
	assert.equal(request.assertCurrent, assertCurrent);
	assert.deepEqual((request.editorFfmpeg as Data).id, 'editor-ffmpeg');
	assert.deepEqual(Object.keys(request.canvas as Data), [
		'width', 'height', 'frameRate', 'fit', 'backgroundColor',
	]);
	assert.deepEqual([request.startFrame, request.endFrame, request.format, request.quality],
		[0, 48_000, 'mp4', 'balanced']);
	assert.deepEqual(request.sources, [{ sourceId: 'video-source', blob: blobs.get('video-source') }]);
	assert.equal(Object.isFrozen(request), true);
	assert.equal(Object.isFrozen(request.sources), true);
	for (const key of ['webCodecs', 'audioMix', 'maximumOutputBytes', 'rgbaPostprocessor', 'rgbaCompositor']) {
		assert.equal(Object.hasOwn(request, key), false, key);
	}
});

test('stated WebCodecs, an output ceiling and the RGBA hooks reach the offline encoder', async () => {
	const seen: Data[] = [];
	const built = harness(keyedProject(), encoders({
		encodeOffline: async (request: Data) => { seen.push(request); return encodedBytes(); },
	}));
	const plan = keyedPlan(built, { includeAudio: true });
	const webCodecs = { codec: 'avc1.42001f', bitrate: 1_000_000 };
	const audioMix = new Blob(['mix']);
	const rgbaPostprocessor = (): undefined => undefined;
	const rgbaCompositor = (): undefined => undefined;

	await built.strategy.encode(encodeRequest(built, plan, {
		webCodecs, audioMix, maximumOutputBytes: 4_096, rgbaPostprocessor, rgbaCompositor,
	}));

	const request = seen[0]!;
	assert.equal(request.webCodecs, webCodecs);
	assert.equal(request.audioMix, audioMix);
	assert.equal(request.maximumOutputBytes, 4_096);
	assert.equal(request.rgbaPostprocessor, rgbaPostprocessor);
	assert.equal(request.rgbaCompositor, rgbaCompositor);
});

test('an encode returns the encoder bytes and states a codec only when the encoder did', async () => {
	const built = harness();
	const plan = keyedPlan(built);
	const coded = harness(keyedProject(), encoders({
		encodeOffline: async () => encodedBytes({ codec: 'h264' }),
	}));

	const result = await built.strategy.encode(encodeRequest(built, plan));
	const withCodec = await coded.strategy.encode(encodeRequest(coded, keyedPlan(coded)));

	assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
	assert.deepEqual(Object.keys(result), [
		'bytes', 'byteLength', 'videoEncoder', 'extension', 'mimeType',
	]);
	assert.deepEqual(
		[result.byteLength, result.videoEncoder, result.extension, result.mimeType],
		[4, 'ffmpeg', '.mp4', 'video/mp4'],
	);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(withCodec.codec, 'h264');
});

test('an encoder result whose identity contradicts the detached plan is refused', async () => {
	const contradictions: Data[] = [
		{ format: 'webm' },
		{ extension: 'mp4' },
		{ mimeType: 'video/webm' },
		{ byteLength: -1 },
		{ byteLength: 4.5 },
	];

	for (const override of contradictions) {
		const built = harness(keyedProject(), encoders({
			encodeOffline: async () => encodedBytes(override),
		}));
		await assert.rejects(
			() => built.strategy.encode(encodeRequest(built, keyedPlan(built))),
			/keyed encoder output does not match its detached export plan/u,
			JSON.stringify(override),
		);
	}
});

test('a browser encode refuses bytes whose length contradicts the stated byte length', async () => {
	const short = harness(keyedProject(), encoders({
		encodeOffline: async () => ({ ...encodedBytes(), bytes: new Uint8Array([1, 2, 3]) }),
	}));
	const untyped = harness(keyedProject(), encoders({
		encodeOffline: async () => ({ ...encodedBytes(), bytes: new ArrayBuffer(4) }),
	}));

	await assert.rejects(
		() => short.strategy.encode(encodeRequest(short, keyedPlan(short))),
		/keyed browser output byte length is inconsistent/u,
	);
	await assert.rejects(
		() => untyped.strategy.encode(encodeRequest(untyped, keyedPlan(untyped))),
		/keyed browser output byte length is inconsistent/u,
	);
});

test('a sink encode reports the chunk count and hands the encoder the stated sink', async () => {
	const sinks: unknown[] = [];
	const built = harness(keyedProject(), encoders({
		encodeOfflineToSink: async (_request: Data, sink: unknown) => {
			sinks.push(sink);
			return encodedSink({ codec: 'vp9' });
		},
	}));
	const sink = { id: 'output-sink' };

	const result = await built.strategy.encodeToSink(
		encodeRequest(built, keyedPlan(built)), sink as never,
	);

	assert.deepEqual(sinks, [sink]);
	assert.deepEqual(
		[result.output, result.byteLength, result.chunkCount, result.codec],
		['sink-handle', 12, 3, 'vp9'],
	);
	assert.deepEqual(Object.keys(result), [
		'output', 'byteLength', 'chunkCount', 'videoEncoder', 'codec', 'extension', 'mimeType',
	]);
	assert.equal(Object.isFrozen(result), true);
});

test('a sink encode refuses an output chunk count that is not a whole non-negative count', async () => {
	for (const outputChunkCount of [-1, 1.5, Number.NaN]) {
		const built = harness(keyedProject(), encoders({
			encodeOfflineToSink: async () => encodedSink({ outputChunkCount }),
		}));
		await assert.rejects(
			() => built.strategy.encodeToSink(encodeRequest(built, keyedPlan(built)), {} as never),
			RangeError,
			String(outputChunkCount),
		);
	}
});

test('the offline encoders run on their stated dependency object and may answer synchronously', async () => {
	const dependencies: Data = {
		id: 'stated-dependencies',
		receipts: [] as string[],
		encodeOffline(this: Data) {
			(this.receipts as string[]).push(String(this.id));
			return encodedBytes();
		},
		encodeOfflineToSink(this: Data) {
			(this.receipts as string[]).push(`${String(this.id)}:sink`);
			return encodedSink();
		},
	};
	const built = harness(keyedProject(), dependencies);
	const plan = keyedPlan(built);
	// The construction-time snapshot is what runs, not whatever the object holds later.
	dependencies.encodeOffline = () => { throw new Error('the replaced encoder ran'); };

	await built.strategy.encode(encodeRequest(built, plan));
	await built.strategy.encodeToSink(encodeRequest(built, plan), {} as never);

	assert.deepEqual(dependencies.receipts, ['stated-dependencies', 'stated-dependencies:sink']);
});
