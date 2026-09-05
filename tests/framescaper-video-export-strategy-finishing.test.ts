/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ProductVideoExportPlan,
	ProductVideoExportStrategy,
} from '../src/common/editor/controller/product-video-export-strategy.ts';
import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import {
	createFramescaperVideoExportStrategyFinishing,
	framescaperVideoExportDispositionFinishingFor,
} from '../src/framescaper/video-export-strategy-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const GENERATOR_WIDTH = 4;
const GENERATOR_HEIGHT = 2;

function baseOptions(): Data {
	return { ...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] } };
}

/** The sole video track carries a solid generator, so no decoded picture is keyed. */
function generatorOptions(): Data {
	const options = baseOptions();
	options.clips = [
		...(options.clips as Data[]).filter(({ id }) => id !== 'video-clip'),
		{
			schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10,
		},
	];
	options.tracks = (options.tracks as Data[]).map((track) => (
		track.id === 'video-track' ? { ...track, clipIds: ['generator-clip'] } : track
	));
	options.visualModel = {
		stillSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
		generatorSources: [{
			schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Slate',
			width: GENERATOR_WIDTH, height: GENERATOR_HEIGHT, frameRate: { num: 10, den: 1 },
			frameCount: 100, generator: { kind: 'solid', color: '#3366ccff' },
		}],
	};
	return options;
}

function projectOf(options: Data): Data {
	return createFramescaperProjectFinishing(PROFILE, options as never) as unknown as Data;
}

const ENCODED_IDENTITY = Object.freeze({
	videoEncoder: 'ffmpeg', format: 'mp4', extension: '.mp4', mimeType: 'video/mp4',
});

function encodedBytes() {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	return { ...ENCODED_IDENTITY, bytes, byteLength: bytes.byteLength, codec: 'h264' };
}

function encodedSink() {
	return { ...ENCODED_IDENTITY, output: 'sink-handle', byteLength: 12, outputChunkCount: 3 };
}

function keyedEncoders(overrides: Data = {}): Data {
	return {
		encodeOffline: async () => encodedBytes(),
		encodeOfflineToSink: async () => encodedSink(),
		...overrides,
	};
}

function delivery(): Data {
	return {
		project: { deliveryProjection: true },
		audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	};
}

function timingViews(project: Data): ReadonlyMap<string, unknown> {
	return new Map((project.sources as Data[]).flatMap((source) => (
		source.kind === 'video'
			? [[String(source.id), {
				kind: 'cfr', rate: source.frameRate, frameCount: Number(source.sourceFrameCount),
			}] as const]
			: []
	)));
}

interface Harness {
	readonly strategy: ProductVideoExportStrategy;
	readonly project: Data;
	readonly exportProject: Data;
}

function harness(
	options: Data = generatorOptions(),
	dependencies: Data = keyedEncoders(),
	createSupplemental?: unknown,
): Harness {
	const project = projectOf(options);
	const strategy = createFramescaperVideoExportStrategyFinishing(
		PROFILE, dependencies as never, undefined, undefined, createSupplemental as never,
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

function encodeRequest(built: Harness, plan: ProductVideoExportPlan, overrides: Data = {}): never {
	return {
		canonicalProject: built.project, exportProject: built.exportProject, plan,
		timingBySourceId: new Map(), timingViewsBySourceId: timingViews(built.project),
		videoBlobs: new Map(), audioMix: null, editorFfmpeg: { id: 'editor-ffmpeg' },
		webCodecs: null, signal: new AbortController().signal,
		assertCurrent: () => undefined, maximumOutputBytes: undefined,
		...overrides,
	} as unknown as never;
}

test('a finishing export strategy refuses a runtime profile it cannot authenticate', () => {
	assert.throws(
		() => createFramescaperVideoExportStrategyFinishing({ product: 'framescaper' }),
		TypeError,
	);
});

test('picture encoders must be own enumerable functions or be left unstated', () => {
	const hidden = keyedEncoders();
	Object.defineProperty(hidden, 'encodePictureToSink', {
		value: () => undefined, enumerable: false, configurable: true, writable: true,
	});
	const inherited = Object.assign(
		Object.create({ encodePictureToSink: () => undefined }) as Data, keyedEncoders(),
	);

	assert.throws(
		() => createFramescaperVideoExportStrategyFinishing(
			PROFILE, keyedEncoders({ encodePicture: 'encode' }) as never,
		),
		/dependencies\.encodePicture must be an own function/u,
	);
	assert.throws(
		() => createFramescaperVideoExportStrategyFinishing(PROFILE, hidden as never),
		/dependencies\.encodePictureToSink must be an own function/u,
	);
	// An inherited encoder is not an own property, so the shipped encoder stands.
	assert.doesNotThrow(() => createFramescaperVideoExportStrategyFinishing(PROFILE, inherited as never));
});

test('a stated exact capture dependency that is not a function is refused at construction', () => {
	assert.throws(
		() => createFramescaperVideoExportStrategyFinishing(
			PROFILE, keyedEncoders({ captureExactFrame: 7 }) as never,
		),
		/dependencies\.captureExactFrame must be an own function/u,
	);
	assert.throws(
		() => createFramescaperVideoExportStrategyFinishing(
			PROFILE, keyedEncoders({ createExactAcceleratorCanvas: null }) as never,
		),
		/dependencies\.createExactAcceleratorCanvas must be an own function/u,
	);
});

test('stated dependencies must still carry the retime offline encoders the delegate needs', () => {
	assert.throws(
		() => createFramescaperVideoExportStrategyFinishing(
			PROFILE, { encodePicture: () => undefined } as never,
		),
		/dependencies\.encodeOffline must be an own function/u,
	);
});

test('omitted dependencies fall back to the shipped encoders without refusing construction', () => {
	assert.doesNotThrow(() => createFramescaperVideoExportStrategyFinishing(PROFILE));
});

test('the export projection handed back is the delivery project record itself', () => {
	const project = projectOf(generatorOptions());
	const strategy = createFramescaperVideoExportStrategyFinishing(PROFILE, keyedEncoders() as never);
	const stated = delivery();
	const exportProject = strategy.createExportProject({
		canonicalProject: project as never, delivery: stated as never,
	});

	assert.equal(exportProject, stated.project);
});

test('a delivery that is not a plain record or states a rendered fallback is refused', () => {
	const project = projectOf(generatorOptions());
	const strategy = createFramescaperVideoExportStrategyFinishing(PROFILE, keyedEncoders() as never);
	const canonical = project as never;

	assert.throws(() => strategy.createExportProject({
		canonicalProject: canonical, delivery: { ...delivery(), project: [] } as never,
	}), TypeError);
	assert.throws(() => strategy.createExportProject({
		canonicalProject: canonical,
		delivery: { ...delivery(), videoRenderedFallback: { storageKey: 'rendered' } } as never,
	}), /refuses a rendered-fallback delivery projection/u);
});

test('a legacy unmanaged source colour interpretation is refused before export projection', () => {
	const project = projectOf(generatorOptions());
	const unmanaged = {
		...project,
		videoSourceColorInterpretations: (project.videoSourceColorInterpretations as Data[])
			.map((entry) => ({ ...entry, provenance: 'legacy-unmanaged-encoded' })),
	};
	const strategy = createFramescaperVideoExportStrategyFinishing(PROFILE, keyedEncoders() as never);

	assert.throws(
		() => strategy.createExportProject({
			canonicalProject: unmanaged as never, delivery: delivery() as never,
		}),
		/refuses a legacy unmanaged source/u,
	);
});

test('picture ownership reports a generator on a visible track and not a keyed video clip', () => {
	const generator = harness();
	const keyed = harness(baseOptions());

	assert.equal(generator.strategy.hasPicture!(generator.exportProject), true);
	assert.equal(keyed.strategy.hasPicture!(keyed.exportProject), false);
	// A look-alike record is not the projection this strategy issued.
	assert.throws(
		() => generator.strategy.hasPicture!({ deliveryProjection: true }),
		/requires an owned export project/u,
	);
});

test('a caption request is refused because finishing delivers captions as sidecars only', () => {
	const built = harness();

	assert.throws(
		() => built.strategy.createPlan(planRequest(built, { captions: { trackIds: [] } })),
		/sidecar-only through Caption Tracks/u,
	);
});

test('a plan request is refused when its projection is unowned or its project moved on', () => {
	const built = harness();

	assert.throws(
		() => built.strategy.createPlan(planRequest(built, { exportProject: { other: true } })),
		/not owned by this exact finishing project/u,
	);
	(built.project.tracks as Data[])[0]!.name = 'Renamed after projection';
	assert.throws(
		() => built.strategy.createPlan(planRequest(built)),
		/browser export projection is stale/u,
	);
});

test('a picture-only timeline plans the exact V13 RGBA route with its own canvas', () => {
	const built = harness();

	const plan = built.strategy.createPlan(planRequest(built))!;
	const withAudio = built.strategy.createPlan(planRequest(built, { includeAudio: true }))!;

	assert.equal(plan.version, 13);
	assert.equal(plan.strategy, 'framescaper-visual-rgba');
	assert.deepEqual(
		[(plan.canvas as Data).width, (plan.canvas as Data).height],
		[GENERATOR_WIDTH, GENERATOR_HEIGHT],
	);
	assert.deepEqual(plan.activeSourceIds, []);
	assert.deepEqual(plan.inputs, []);
	assert.deepEqual(withAudio.inputs.map(({ kind }) => kind), ['staged-audio-mix']);
});

test('a timeline whose visible picture is video delegates to the keyed retime plan', () => {
	const built = harness(baseOptions());

	const plan = built.strategy.createPlan(planRequest(built))!;

	assert.equal(plan.version, 7);
	assert.deepEqual(plan.activeSourceIds, ['video-source']);
});

test('a timeline whose picture track is hidden plans nothing at all', () => {
	const options = generatorOptions();
	options.tracks = (options.tracks as Data[]).map((track) => (
		track.id === 'video-track' ? { ...track, hidden: true } : track
	));
	const built = harness(options);

	assert.throws(
		() => built.strategy.createPlan(planRequest(built)),
		/no active still or generator/u,
	);
});

test('timing closure names every canonical video source in code-unit order', () => {
	const options = generatorOptions();
	options.sources = [...(options.sources as Data[]), {
		...structuredClone((options.sources as Data[])[0]!),
		id: 'Z-source', name: 'Z', storageKey: 'Z-source', contentSha256: '34'.repeat(32),
	}];
	const built = harness(options);

	const plan = built.strategy.createPlan(planRequest(built))!;

	assert.deepEqual(built.strategy.captureTimingSourceIds!(plan), ['Z-source', 'video-source']);
	assert.throws(
		() => built.strategy.captureTimingSourceIds!({ version: 13 } as never),
		/timing closure requires an owned export plan/u,
	);
});

test('an encode is refused when its plan belongs to a different project snapshot', async () => {
	const first = harness();
	const second = harness();
	const plan = first.strategy.createPlan(planRequest(first))!;

	await assert.rejects(
		() => second.strategy.encode(encodeRequest(second, plan)),
		/not owned by this exact project snapshot/u,
	);
});

test('a picture-only encode refuses inputs and timing its detached plan never stated', async () => {
	const built = harness();
	const plan = built.strategy.createPlan(planRequest(built))!;

	await assert.rejects(() => built.strategy.encode(encodeRequest(built, plan, {
		videoBlobs: new Map([['video-source', new Blob(['x'])]]),
	})), /refuses unplanned video inputs/u);
	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan, { audioMix: new Blob(['x']) })),
		/audio must exactly match its detached plan/u,
	);
	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan, { timingViewsBySourceId: undefined })),
		/lost its raw exact timing authority/u,
	);
});

/** Drive the encoder request the strategy built for exactly one output frame. */
async function compositeOneFrame(request: Data): Promise<void> {
	const frame = (request.frameSource as { frame(index: number): unknown }).frame(0);
	const producer = request.producer as {
		byteLength: number;
		produce(frame: unknown, target: Uint8Array, options: Data): Promise<void>;
	};
	await producer.produce(frame, new Uint8Array(producer.byteLength), { signal: request.signal });
}

test('a picture-only encode returns the encoder output and records its V13 disposition', async () => {
	const seen: Data[] = [];
	const built = harness(generatorOptions(), keyedEncoders({
		encodePicture: async (editorFfmpeg: Data, request: Data) => {
			seen.push({ editorFfmpeg, request });
			await compositeOneFrame(request);
			return encodedBytes();
		},
	}));
	const plan = built.strategy.createPlan(planRequest(built))!;
	assert.throws(() => framescaperVideoExportDispositionFinishingFor(plan), ReferenceError);

	const result = await built.strategy.encode(encodeRequest(built, plan));

	assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
	assert.deepEqual(
		[result.byteLength, result.extension, result.mimeType, result.codec],
		[4, '.mp4', 'video/mp4', 'h264'],
	);
	assert.deepEqual((seen[0]!.editorFfmpeg as Data).id, 'editor-ffmpeg');
	const disposition = framescaperVideoExportDispositionFinishingFor(plan);
	assert.equal(disposition.exactPlanVersion, 13);
	assert.equal(disposition.captionDisposition, 'sidecar-only');
	assert.equal(disposition.audioDisposition, 'shared-v21-delivery');
	assert.ok(disposition.nodeDispositions.some(({ kind }) => kind === 'finishing'));
});

test('a picture-only sink encode reports the chunk count and receives the stated sink', async () => {
	const sinks: unknown[] = [];
	const built = harness(generatorOptions(), keyedEncoders({
		encodePictureToSink: async (_ffmpeg: unknown, request: Data, sink: unknown) => {
			sinks.push(sink);
			await compositeOneFrame(request);
			return encodedSink();
		},
	}));
	const plan = built.strategy.createPlan(planRequest(built))!;
	const sink = { id: 'output-sink' };

	const result = await built.strategy.encodeToSink(encodeRequest(built, plan), sink as never);

	assert.deepEqual(
		[result.output, result.byteLength, result.chunkCount], ['sink-handle', 12, 3],
	);
	assert.deepEqual(sinks, [sink]);
	assert.equal(framescaperVideoExportDispositionFinishingFor(plan).exactPlanVersion, 13);
});

test('a picture encoder that never composites a frame is refused after the encode', async () => {
	const built = harness(generatorOptions(), keyedEncoders({
		encodePicture: async () => encodedBytes(),
	}));

	await assert.rejects(
		() => built.strategy.encode(
			encodeRequest(built, built.strategy.createPlan(planRequest(built))!),
		),
		/did not invoke its exact source-layer compositor/u,
	);
});

test('a picture encoder whose output contradicts its plan is refused', async () => {
	const built = harness(generatorOptions(), keyedEncoders({
		encodePicture: async (_ffmpeg: unknown, request: Data) => {
			await compositeOneFrame(request);
			return { ...encodedBytes(), format: 'webm', extension: '.webm', mimeType: 'video/webm' };
		},
	}));

	await assert.rejects(
		() => built.strategy.encode(
			encodeRequest(built, built.strategy.createPlan(planRequest(built))!),
		),
		/picture encoder output does not match its exact plan/u,
	);
});

test('a failing picture encoder propagates its own failure and disposes the exact execution', async () => {
	const ledger = { resolved: 0, disposed: 0 };
	const failure = new RangeError('the encoder ran out of room');
	const built = harness(generatorOptions(), keyedEncoders({
		encodePicture: async (_ffmpeg: unknown, request: Data) => {
			await compositeOneFrame(request);
			throw failure;
		},
	}), () => ({
		resolve: () => { ledger.resolved += 1; return []; },
		dispose: () => { ledger.disposed += 1; },
	}));
	const plan = built.strategy.createPlan(planRequest(built))!;

	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan)),
		(error: unknown) => {
			assert.equal(error, failure);
			return true;
		},
	);
	assert.deepEqual([ledger.resolved, ledger.disposed], [1, 1]);
});

test('a supplemental picture execution that is not an execution is refused', async () => {
	const built = harness(generatorOptions(), keyedEncoders({
		encodePicture: async (_ffmpeg: unknown, request: Data) => {
			await compositeOneFrame(request);
			return encodedBytes();
		},
	}), () => 'not an execution');
	const plan = built.strategy.createPlan(planRequest(built))!;

	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan)),
		/supplemental picture execution is invalid/u,
	);
});

test('a picture-only encode forwards its stated output ceiling and refuses an invalid one', async () => {
	const seen: Data[] = [];
	const built = harness(generatorOptions(), keyedEncoders({
		encodePicture: async (_ffmpeg: unknown, request: Data) => {
			seen.push(request);
			await compositeOneFrame(request);
			return encodedBytes();
		},
	}));
	const plan = built.strategy.createPlan(planRequest(built))!;

	await built.strategy.encode(encodeRequest(built, plan, { maximumOutputBytes: 4_096 }));

	assert.equal(seen[0]!.maximumOutputBytes, 4_096);
	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan, { maximumOutputBytes: 0 })),
		/maximumOutputBytes must be a positive safe integer/u,
	);
});

test('a picture-only encode refuses a WebCodecs decision this runtime cannot honour', async () => {
	const built = harness(generatorOptions(), keyedEncoders({
		encodePicture: async () => encodedBytes(),
	}));
	const plan = built.strategy.createPlan(planRequest(built))!;

	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan, {
			webCodecs: { codec: 'avc1.42001f', bitrate: 1_000_000 },
		})),
		/no longer exposes the WebCodecs encoder/u,
	);
});

test('a keyed encode hands the retime delegate the retime projection and the exact compositor', async () => {
	const seen: Data[] = [];
	const built = harness(baseOptions(), keyedEncoders({
		encodeOffline: async (request: Data) => {
			seen.push(request);
			const canvas = request.canvas as Data;
			const width = Number(canvas.width);
			const height = Number(canvas.height);
			await (request.rgbaCompositor as (input: Data) => Promise<void>)({
				frame: { index: 0, timelineSample: 0, timelinePosition: { num: 0, den: 1 }, layers: [] },
				layers: [], width, height,
				rgba: new Uint8Array(width * height * 4),
				signal: request.signal,
			});
			return encodedBytes();
		},
	}));
	const plan = built.strategy.createPlan(planRequest(built))!;

	const result = await built.strategy.encode(encodeRequest(built, plan, {
		videoBlobs: new Map([['video-source', new Blob(['picture'])]]),
	}));

	assert.equal(result.byteLength, 4);
	assert.equal(typeof seen[0]!.rgbaCompositor, 'function');
	// The delegate encodes the retime projection, never the finishing delivery record.
	assert.notEqual(seen[0]!.project, built.exportProject);
	assert.equal(framescaperVideoExportDispositionFinishingFor(plan).exactPlanVersion, 13);
	await assert.rejects(
		() => built.strategy.encode(encodeRequest(built, plan)),
		/must exactly match its active source IDs/u,
	);
});
