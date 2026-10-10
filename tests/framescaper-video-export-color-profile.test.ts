/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from './helpers/async-test-control.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperVideoExportStrategyFinishing } from '../src/framescaper/video-export-strategy-finishing.ts';
import type { CreateFramescaperVideoExportSupplementalPictureExecutionFinishing } from '../src/framescaper/video-export-exact-execution-finishing.ts';
import type { ProductVideoExportStrategyEncodeRequest } from '../src/common/editor/controller/export/product-video-export-strategy.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

for (const space of ['srgb', 'rec709'] as const) for (const keyed of [false, true]) for (const sink of [false, true]) {
	test(`${keyed ? 'keyed' : 'generator'} ${sink ? 'sink' : 'download'} carries the exported primary ${space} context`, async () => {
		const built = harness(space, keyed);
		const previousEncoder = Object.getOwnPropertyDescriptor(globalThis, 'VideoEncoder');
		const previousFrame = Object.getOwnPropertyDescriptor(globalThis, 'VideoFrame');
		Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, value: class {} });
		Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, value: class {} });
		try {
			if (sink) await built.strategy.encodeToSink(built.request, {} as never);
			else await built.strategy.encode(built.request);
			assert.equal(built.seen.length, 1);
			const decision = built.seen[0]?.webCodecs as Data;
			assert.equal(decision.rgbaColorSpace, space);
			assert.equal(decision.bitrate, 737, 'color propagation does not rewrite quality');
			assert.equal(decision.codec, 'avc1.4d001e');
		} finally {
			if (previousEncoder) Object.defineProperty(globalThis, 'VideoEncoder', previousEncoder);
			else Reflect.deleteProperty(globalThis, 'VideoEncoder');
			if (previousFrame) Object.defineProperty(globalThis, 'VideoFrame', previousFrame);
			else Reflect.deleteProperty(globalThis, 'VideoFrame');
		}
	});
}

test('a changed canonical output context refuses before any encoder is invoked', async () => {
	const built = harness('rec709', true);
	built.project.videoColorContexts = (built.project.videoColorContexts as Data[]).map(row => row.sequenceId === 'main-sequence' ? { ...row, outputSpace: 'srgb' } : row);
	await assert.rejects(built.strategy.encode(built.request), /stale|changed/u);
	assert.equal(built.seen.length, 0);
});

test('a stated encoder profile cannot contradict the exact exported color authority', async () => {
	const built = harness('rec709', true);
	await assert.rejects(built.strategy.encode({ ...built.request,
		webCodecs: { ...built.request.webCodecs!, rgbaColorSpace: 'srgb' } } as ProductVideoExportStrategyEncodeRequest));
	assert.equal(built.seen.length, 0);
});

test('an unsupported future canonical profile refuses before the encoder', async () => {
	const built = harness('rec709', true);
	built.project.videoColorContexts = (built.project.videoColorContexts as Data[]).map(row => row.sequenceId === 'main-sequence' ? { ...row, outputSpace: 'display-p3' } : row);
	await assert.rejects(built.strategy.encode(built.request), /color output space/iu);
	assert.equal(built.seen.length, 0);
});

for (const keyed of [false, true]) for (const sink of [false, true]) {
	test(`${keyed ? 'keyed' : 'generator'} ${sink ? 'sink' : 'download'} captures the caller profile before held supplemental startup`, async () => {
		const entered = deferred<void>();
		const release = deferred<void>();
		const built = harness('rec709', keyed, async () => {
			entered.resolve();
			await release.promise;
			return { resolve: () => [], dispose() {} };
		});
		const decision = { ...built.request.webCodecs!, rgbaColorSpace: 'rec709' as 'srgb' | 'rec709' };
		await withEncoderGlobals(async () => {
			const pending = sink ? built.strategy.encodeToSink({ ...built.request, webCodecs: decision }, {} as never)
				: built.strategy.encode({ ...built.request, webCodecs: decision });
			await entered.promise;
			decision.rgbaColorSpace = 'srgb';
			release.resolve();
			await pending;
		});
		assert.equal((built.seen[0]?.webCodecs as Data).rgbaColorSpace, 'rec709');
	});
	for (const invalid of ['getter', 'future'] as const) {
		test(`${keyed ? 'keyed' : 'generator'} ${sink ? 'sink' : 'download'} refuses ${invalid} caller profile before supplemental startup`, async () => {
			let starts = 0; let reads = 0;
			const built = harness('rec709', keyed, () => {
				starts += 1;
				return { resolve: () => [], dispose() {} };
			});
			const decision = { ...built.request.webCodecs };
			Object.defineProperty(decision, 'rgbaColorSpace', invalid === 'getter'
				? { enumerable: true, get() { reads += 1; return 'rec709'; } }
				: { enumerable: true, value: 'display-p3' });
			const request = { ...built.request, webCodecs: decision } as ProductVideoExportStrategyEncodeRequest;
			await assert.rejects(sink ? built.strategy.encodeToSink(request, {} as never) : built.strategy.encode(request), /rgbaColorSpace/u);
			assert.equal(starts, 0);
			assert.equal(reads, 0);
			assert.equal(built.seen.length, 0);
		});
	}
}

for (const sink of [false, true]) for (const refusal of ['conflict', 'preflight'] as const) {
	test(`generator ${sink ? 'sink' : 'download'} joins supplemental disposal after ${refusal} refusal`, async () => {
		const entered = deferred<void>();
		const release = deferred<void>();
		let disposals = 0; let settled = false; let failure: unknown;
		const built = harness('rec709', false, () => ({ resolve: () => [], async dispose() {
			disposals += 1; entered.resolve(); await release.promise;
		} }));
		const request = refusal === 'conflict' ? { ...built.request, webCodecs: { ...built.request.webCodecs!, rgbaColorSpace: 'srgb' as const } }
			: { ...built.request, maximumOutputBytes: 0 };
		const pending = sink ? built.strategy.encodeToSink(request, {} as never) : built.strategy.encode(request);
		const completion = pending.then(() => { settled = true; }, error => { settled = true; failure = error; });
		try {
			await Promise.race([entered.promise, completion]);
			assert.equal(disposals, 1);
			assert.equal(settled, false, 'refusal must join the acquired supplemental owner');
		} finally { release.resolve(); await completion; }
		assert.match((failure as Error).message, refusal === 'conflict' ? /contradicts/u : /maximumOutputBytes/u);
		assert.equal(built.seen.length, 0);
	});
}

for (const sink of [false, true]) {
	test(`generator ${sink ? 'sink' : 'download'} preserves preflight primary and opaque disposal failure`, async () => {
		const cleanup = Object.freeze({ cleanup: 'supplemental' });
		let disposals = 0;
		const built = harness('rec709', false, () => ({ resolve: () => [], dispose() {
			disposals += 1; throw cleanup;
		} }));
		const request = { ...built.request, maximumOutputBytes: 0 };
		await assert.rejects(sink ? built.strategy.encodeToSink(request, {} as never) : built.strategy.encode(request), error => {
			assert.ok(error instanceof AggregateError);
			assert.ok(error.cause instanceof RangeError);
			assert.match(error.cause.message, /maximumOutputBytes/u);
			assert.equal(error.errors[0], error.cause);
			assert.ok(error.errors[1] instanceof AggregateError);
			assert.equal(error.errors[1].errors[0], cleanup);
			return true;
		});
		assert.equal(disposals, 1);
		assert.equal(built.seen.length, 0);
	});
}

async function withEncoderGlobals(consume: () => Promise<void>) {
	const encoder = Object.getOwnPropertyDescriptor(globalThis, 'VideoEncoder');
	const frame = Object.getOwnPropertyDescriptor(globalThis, 'VideoFrame');
	Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, value: class {} });
	Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, value: class {} });
	try { await consume(); } finally {
		if (encoder) Object.defineProperty(globalThis, 'VideoEncoder', encoder); else Reflect.deleteProperty(globalThis, 'VideoEncoder');
		if (frame) Object.defineProperty(globalThis, 'VideoFrame', frame); else Reflect.deleteProperty(globalThis, 'VideoFrame');
	}
}

function harness(space: 'srgb' | 'rec709', keyed: boolean, supplemental?: CreateFramescaperVideoExportSupplementalPictureExecutionFinishing) {
	const options = { ...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] } } as Data;
	options.sequences = [...options.sequences as Data[], { id: 'unrelated-sequence', rate: { num: 10, den: 1 }, trackIds: [] }];
	if (!keyed) {
		options.clips = [...(options.clips as Data[]).filter(row => row.id !== 'video-clip'), {
			schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		}];
		options.tracks = (options.tracks as Data[]).map(row => row.id === 'video-track' ? { ...row, clipIds: ['generator-clip'] } : row);
		options.visualModel = { stillSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
			generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Slate',
				width: 4, height: 2, frameRate: { num: 10, den: 1 }, frameCount: 100, generator: { kind: 'solid', color: '#3366ccff' } }],
		};
	}
	const initial = createFramescaperProjectFinishing(PROFILE, options as never);
	options.finishing = { colorContexts: initial.videoColorContexts.map(context => ({ ...context,
		outputSpace: context.sequenceId === 'main-sequence' ? space : space === 'srgb' ? 'rec709' : 'srgb',
	})).reverse() };
	const project = createFramescaperProjectFinishing(PROFILE, options as never) as unknown as Data;
	const seen: Data[] = [];
	async function observe(request: Data, picture: boolean) {
		seen.push(request);
		if (picture) {
			const producer = request.producer as { byteLength: number; produce(frame: unknown, rgba: Uint8Array, options: Data): Promise<void> };
			await producer.produce((request.frameSource as { frame(index: number): unknown }).frame(0), new Uint8Array(producer.byteLength), { signal: request.signal });
		} else {
			const canvas = request.canvas as { width: number; height: number };
			await (request.rgbaCompositor as (value: Data) => Promise<void>)({
				frame: { index: 0, timelineSample: 0, timelinePosition: { num: 0, den: 1 }, layers: [] }, layers: [],
				...canvas, rgba: new Uint8Array(canvas.width * canvas.height * 4), signal: request.signal,
			});
		}
	}
	const result = () => ({ videoEncoder: 'webcodecs', format: 'mp4', extension: '.mp4', mimeType: 'video/mp4',
		bytes: Uint8Array.of(1), byteLength: 1, codec: 'avc1.4d001e', output: 'sink', outputChunkCount: 1 });
	const strategy = createFramescaperVideoExportStrategyFinishing(PROFILE, {
		async encodeOffline(request: Data) { await observe(request, false); return result(); },
		async encodeOfflineToSink(request: Data) { await observe(request, false); return result(); },
		async encodePicture(_runtime: unknown, request: Data) { await observe(request, true); return result(); },
		async encodePictureToSink(_runtime: unknown, request: Data) { await observe(request, true); return result(); },
	} as never, undefined, undefined, supplemental);
	const exportProject = strategy.createExportProject({ canonicalProject: project, delivery: {
		project: { deliveryProjection: true }, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	} } as never);
	const plan = strategy.createPlan({ canonicalProject: project, exportProject, format: 'mp4', range: 'project', includeAudio: false } as never)!;
	const timingViewsBySourceId = new Map((project.sources as Data[]).flatMap(row => row.kind === 'video'
		? [[String(row.id), { kind: 'cfr', rate: row.frameRate, frameCount: row.sourceFrameCount }] as const] : []));
	const request = { canonicalProject: project, exportProject, plan, timingBySourceId: new Map(), timingViewsBySourceId,
		videoBlobs: keyed ? new Map([['video-source', new Blob(['picture'])]]) : new Map(), audioMix: null, editorFfmpeg: {},
		webCodecs: { codec: 'avc1.4d001e', bitrate: 737 }, signal: new AbortController().signal,
		assertCurrent() {}, maximumOutputBytes: undefined } as unknown as ProductVideoExportStrategyEncodeRequest;
	return { project, strategy, request, seen };
}
