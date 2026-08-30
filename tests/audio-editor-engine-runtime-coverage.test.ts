/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import {
	abortable,
	createAbortError,
	longSourceError,
	parametricEqProcessingError,
	throwIfAborted,
} from '../src/common/editor/engine/async-utils.ts';
import {
	automaticCrossfadeRanges,
	getTrackClips,
	mergeFrameRanges,
	normalizeChunkSource,
	normalizeSourceResolver,
	resolveClipSource,
} from '../src/common/editor/engine/clip-schedule-plan.ts';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import {
	effectGraphKey,
	effectRackLatencyFrames,
	postEffectMessage,
	readParametricEqSpectrumEntry,
	safeMessageSequence,
} from '../src/common/editor/engine/effect-rack.ts';
import {
	activeRackEffects,
	projectEffectRacks,
	projectRackEffect,
	projectWithEffectParams,
	projectWithParametricEqParams,
} from '../src/common/editor/engine/project-effects.ts';
import { ENGINE_SCHEDULE_CURRENT_PLAYBACK } from '../src/common/editor/engine/runtime-symbols.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import type {
	EngineChunkSource,
	EngineProject,
} from '../src/common/editor/engine/types.ts';

test('async helpers settle, abort, and preserve structured processing errors', async () => {
	const nativeAbort = createAbortError();
	assert.equal(nativeAbort.name, 'AbortError');
	const previousDomException = globalThis.DOMException;
	Object.defineProperty(globalThis, 'DOMException', { configurable: true, writable: true, value: undefined });
	try {
		const fallbackAbort = createAbortError();
		assert.equal(fallbackAbort.name, 'AbortError');
		assert.ok(fallbackAbort instanceof Error);
	} finally {
		Object.defineProperty(globalThis, 'DOMException', {
			configurable: true,
			writable: true,
			value: previousDomException,
		});
	}

	throwIfAborted(null);
	const aborted = new AbortController();
	aborted.abort();
	assert.throws(() => throwIfAborted(aborted.signal), { name: 'AbortError' });
	assert.equal(await abortable(Promise.resolve('done'), null), 'done');

	const resolving = new AbortController();
	assert.equal(await abortable(Promise.resolve(4), resolving.signal), 4);
	const rejection = new Error('mock rejection');
	const rejecting = new AbortController();
	await assert.rejects(abortable(Promise.reject(rejection), rejecting.signal), rejection);

	let resolvePending!: (value: string) => void;
	const pendingController = new AbortController();
	const pending = abortable(new Promise<string>((resolve) => { resolvePending = resolve; }), pendingController.signal);
	pendingController.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	resolvePending('late');

	assert.equal(longSourceError('render it').code, 'LONG_SOURCE_RENDER_REQUIRED');
	assert.deepEqual(
		Object.assign({}, parametricEqProcessingError({ message: 'EQ failed', status: 5, effectId: 'eq-1' })),
		{ name: 'ParametricEqProcessingError', status: 5, effectId: 'eq-1' },
	);
	assert.match(parametricEqProcessingError(null).message, /failed during rendering/u);
	assert.equal(parametricEqProcessingError({ message: '', status: null, effectId: '' }).status, undefined);
});

test('clip planning validates providers, resolver results, and inline track clips', async () => {
	assert.equal(normalizeSourceResolver(undefined), null);
	assert.throws(() => normalizeSourceResolver(4), /must be a function or null/u);
	assert.throws(() => normalizeChunkSource(null), /provider is required/u);
	assert.throws(() => normalizeChunkSource({
		channelCount: 1,
		frameCount: 1,
		chunkFrames: 65_537,
		sampleRate: 48_000,
		readStorageChunk() { return [Float32Array.of(0)]; },
	}), /cannot exceed/u);

	const owner = {
		descriptor: { channelCount: 1, frameLength: 2, sampleRate: 48_000 },
		readChunk(this: { marker?: string }, index: number) {
			assert.equal(this.marker, 'provider');
			return [Float32Array.of(index, 1)];
		},
		marker: 'provider',
	};
	const normalized = normalizeChunkSource(owner);
	assert.equal(normalized.chunkFrames, 0);
	assert.deepEqual(await normalized.readStorageChunk(3), [Float32Array.of(3, 1)]);

	const clipsById = new Map([['stored', { id: 'stored' }]]);
	assert.deepEqual(getTrackClips({ clips: [{ id: 'inline' }, 'stored', null] }, clipsById)
		.map((clip) => clip.id), ['inline', 'stored']);
	assert.deepEqual(getTrackClips({}, clipsById), []);
	assert.throws(() => automaticCrossfadeRanges(null as unknown as []), /must be an array/u);
	assert.deepEqual(mergeFrameRanges([[5, 9], [1, 3], [3, 6], [8, 8], [Number.NaN, 2]]), [[1, 9]]);

	const audioBuffer = {
		length: 4,
		sampleRate: 48_000,
		getChannelData: () => new Float32Array(4),
	} as unknown as AudioBuffer;
	const clip = { id: 'clip', sourceId: 'source', sourceStartFrame: 2 };
	const project: EngineProject = { clips: [clip] };
	assert.strictEqual(resolveClipSource(clip, project, new Map(), () => audioBuffer).buffer, audioBuffer);
	assert.throws(
		() => resolveClipSource(clip, project, new Map(), () => ({ buffer: {} })),
		/invalid AudioBuffer/u,
	);
});

test('reversed offline chunk scheduling reads cross-chunk ranges in reverse order', async () => {
	const context = new TestAudioContext(4);
	const provider: EngineChunkSource = {
		channelCount: 1,
		frameCount: 6,
		chunkFrames: 4,
		sampleRate: 4,
		readStorageChunk(index) {
			if (index === 0) return [Float32Array.of(0, 1, 2, 3)];
			if (index === 1) return { channels: [Float32Array.of(4, 5)] };
			throw new RangeError('missing chunk');
		},
	};
	const project: EngineProject = {
		sampleRate: 4,
		clips: [{
			id: 'clip',
			sourceId: 'source',
			timelineStartFrame: 0,
			durationFrames: 6,
			sourceStartFrame: 0,
			sourceDurationFrames: 6,
			reversed: true,
		}],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
	};
	const progress: number[] = [];
	const activeSources = new Set<import('../src/common/editor/engine/project-graph.ts').AudioScheduledSourceNode>();
	await scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project,
		sources: new Map(),
		chunkSources: new Map([['source', provider]]),
		trackInputs: new Map([['track', new TestAudioNode() as unknown as AudioNode]]),
		fromFrame: 0,
		toFrame: 6,
		contextStartTime: 0,
		sampleRate: 4,
		reversedBuffers: new WeakMap(),
		sourceResolver: null,
		activeSources,
		allNodes: [] as AudioNode[],
		mode: 'offline',
		onProgress: ({ progress: value }) => progress.push(value),
	});

	assert.deepEqual(context.buffers.map((buffer) => [...buffer.getChannelData(0)]), [
		[5, 4, 3, 2],
		[1, 0],
	]);
	assert.deepEqual(context.sources.map((source) => source.started), [
		[0, 0, 1],
		[1, 0, 0.5],
	]);
	assert.equal(activeSources.size, 2);
	assert.equal(progress.at(-1), 1);

	const directProject: EngineProject = {
		sampleRate: 4,
		clips: [{
			id: 'direct-clip', sourceId: 'direct-source', timelineStartFrame: 0,
			durationFrames: 6, sourceStartFrame: 0, sourceDurationFrames: 6, reversed: false,
		}],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['direct-clip'] }],
	};
	const directOptions = (chunkSource: EngineChunkSource, directContext = new TestAudioContext(4)) => ({
		context: directContext as unknown as BaseAudioContext,
		project: directProject,
		sources: new Map<unknown, AudioBuffer>(),
		chunkSources: new Map([['direct-source', chunkSource]]),
		trackInputs: new Map([['track', new TestAudioNode() as unknown as AudioNode]]),
		fromFrame: 0,
		toFrame: 6,
		contextStartTime: 0,
		sampleRate: 4,
		reversedBuffers: new WeakMap<AudioBuffer, AudioBuffer>(),
		sourceResolver: null,
		activeSources: new Set<import('../src/common/editor/engine/project-graph.ts').AudioScheduledSourceNode>(),
		allNodes: [] as AudioNode[],
	});
	await assert.rejects(scheduleProjectClips({
		...directOptions(provider),
		mode: 'live',
		chunkStreamClient: null,
	}), { code: 'LONG_SOURCE_RENDER_REQUIRED' });
	await scheduleProjectClips({
		...directOptions({
			...provider,
			readStorageChunk() { return [new Float32Array()]; },
		}),
		mode: 'offline',
	});
	await assert.rejects(scheduleProjectClips({
		...directOptions({
			...provider,
			channelCount: 2,
			readStorageChunk() { return [new Float32Array(4)]; },
		}),
		mode: 'offline',
	}), /missing channels/u);
});

test('offline time-stretched chunks use one phase-continuous resample', async () => {
	const context = new TestAudioContext(8);
	const input = Float32Array.from({ length: 20 }, (_, frame) => Math.sin(frame * 0.7));
	const reads: number[] = [];
	const provider: EngineChunkSource = {
		channelCount: 1, frameCount: 20, chunkFrames: 4, sampleRate: 8,
		readStorageChunk(index) {
			reads.push(index);
			return [input.slice(index * 4, Math.min(input.length, (index + 1) * 4))];
		},
	};
	await scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project: {
			sampleRate: 8,
			clips: [{
				id: 'clip', sourceId: 'source', timelineStartFrame: 0,
				durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 13,
			}],
			tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		},
		sources: new Map(), chunkSources: new Map([['source', provider]]),
		trackInputs: new Map([['track', new TestAudioNode() as unknown as AudioNode]]),
		fromFrame: 1, toFrame: 8, contextStartTime: 0, sampleRate: 8,
		reversedBuffers: new WeakMap(), sourceResolver: null,
		activeSources: new Set(), allNodes: [] as AudioNode[], mode: 'offline',
	});
	assert.deepEqual(reads, [0, 1, 2, 3, 4]);
	assert.deepEqual(context.buffers.map(({ length }) => length), [7]);
	assert.equal(context.sources.length, 1);
	const resampler = createStreamingWindowedSincResampler(11.375, 7, 1, {
		initialInputPosition: 1.625,
	}) as unknown as {
		push(channels: Float32Array[]): Float32Array[];
		finish(frames: number): Float32Array[];
	};
	const first = resampler.push([input])[0] as Float32Array;
	const tail = resampler.finish(7)[0] as Float32Array;
	assert.deepEqual([...context.buffers[0]!.getChannelData(0)], [...first, ...tail]);
});

test('effect rack and project helpers cover invalid and inactive graph paths', () => {
	assert.equal(effectRackLatencyFrames(undefined), 0);
	assert.deepEqual(activeRackEffects(null), []);
	assert.deepEqual(activeRackEffects({ effectsActive: false, effects: [{ type: 'limiter' }] }), []);
	assert.deepEqual(activeRackEffects({ effects: null as unknown as [] }), []);
	assert.deepEqual([...projectEffectRacks(undefined)], [{
		scope: 'master', targetId: null, effectsActive: true, effects: [],
	}]);

	const delay = { id: 'delay', type: 'delay', params: { mix: 0.2 } };
	const eq = { id: 'eq', type: 'eq', params: { outputGain: 0 } };
	const project: EngineProject = {
		tracks: [
			{ id: 'labels', type: 'label' },
			{ id: 'track', type: 'audio', effects: [delay, eq] },
		],
		mixer: {
			groups: [{ id: 'group', effects: [delay] }],
			sends: [{ id: 'send', effects: [eq] }],
		},
		master: { effects: [eq] },
	};
	assert.equal(projectRackEffect(project, 'track', 'missing', 'delay'), null);
	assert.equal(projectRackEffect(project, 'invalid', null, 'eq'), null);
	assert.equal(projectWithEffectParams(null, 'master', null, 'eq', {}), null);
	assert.equal(projectWithEffectParams(project, 'unknown', null, 'eq', {}), null);
	assert.equal(projectWithEffectParams(project, 'track', 'missing', 'delay', {}), null);
	assert.equal(projectWithEffectParams(project, 'master', null, 'missing', {}), null);
	assert.equal(projectWithParametricEqParams(project, 'track', 'track', 'delay', {}), null);
	assert.deepEqual(
		projectWithEffectParams(project, 'send', 'send', 'eq', { outputGain: 3 })?.mixer?.sends?.[0]?.effects?.[0]?.params,
		{ outputGain: 3 },
	);

	assert.throws(() => effectGraphKey('', null, 'effect'), /Unsupported effect scope/u);
	assert.throws(() => effectGraphKey('track', null, 'effect'), /target ID is required/u);
	assert.throws(() => effectGraphKey('master', null, ''), /stable effect ID/u);
	assert.throws(() => safeMessageSequence(-1, 'revision'), /non-negative safe integer/u);
	assert.equal(postEffectMessage(null, 'master', null, 'effect', {}), false);

	const missingTarget = new Float32Array(2).fill(0);
	assert.equal(readParametricEqSpectrumEntry(null, 'input', missingTarget), null);
	assert.deepEqual([...missingTarget], [-Infinity, -Infinity]);
	assert.throws(
		() => readParametricEqSpectrumEntry(null, 'side', new Float32Array(2)),
		/must be input or output/u,
	);
	assert.throws(
		() => readParametricEqSpectrumEntry(null, 'input', [] as unknown as Float32Array),
		/Float32Array/u,
	);
});

test('rendering and transport public guards cover empty, fallback, and subscription paths', async () => {
	const empty = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: null,
	});
	await assert.rejects(empty.renderMix(), /Load an audio editor project/u);
	await assert.rejects(empty.renderMixRealtime({ onChunk() {} }), /Load an audio editor project/u);
	await assert.rejects(empty.play(), /Load an audio editor project/u);
	await assert.rejects(empty.playAtSpeed(2), /Load an audio editor project/u);
	await assert.rejects(empty.playAt(0), /Load an audio editor project/u);
	await assert.rejects(empty.scrub(0), /Load an audio editor project/u);

	const invalidSubscriptions = empty as unknown as {
		subscribePosition(listener: unknown): () => void;
		subscribeMeters(listener: unknown): () => void;
		subscribeState(listener: unknown): () => void;
	};
	invalidSubscriptions.subscribePosition(null)();
	invalidSubscriptions.subscribeMeters(null)();
	invalidSubscriptions.subscribeState(null)();

	const host = empty as unknown as EngineRuntimeHost;
	host.playbackMode = 'staffpad';
	host.preparedSpeedPlayback = {
		channels: [Float32Array.of(0)],
		frameCount: 1,
		sampleRate: 48_000,
		durationFrames: 1,
		playbackRate: 2,
		audioBuffer: null,
	};
	await host[ENGINE_SCHEDULE_CURRENT_PLAYBACK](0);
	await empty.dispose();

	const rendered = { channels: [Float32Array.of(0.5)] };
	const renderOptions: Readonly<Record<string, unknown>>[] = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: null,
		softwareRenderer: (options) => {
			renderOptions.push(options);
			return rendered;
		},
	});
	engine.loadProject({
		sampleRate: 48_000,
		clips: [{ id: 'clip', durationFrames: 10, timelineStartFrame: 0 }],
		tracks: [{
			id: 'track',
			type: 'audio',
			clipIds: ['clip'],
			effects: [{ id: 'eq', type: 'eq', params: { outputGain: 0 } }],
		}],
		master: { effects: [] },
	});
	assert.throws(
		() => engine.configureRackEffect('track', 'track', 'eq', null as unknown as Record<string, unknown>),
		/Rack effect parameters must be an object/u,
	);
	assert.equal(engine.configureRackEffect('track', 'track', 'eq', {}), false);
	assert.throws(
		() => engine.configureParametricEq('track', 'track', 'eq', [] as unknown as Record<string, unknown>),
		/Parametric EQ parameters must be an object/u,
	);
	assert.throws(
		() => engine.auditionParametricEq('track', 'track', 'eq', 4 as unknown as string),
		/audition band ID/u,
	);
	await assert.rejects(
		engine.createParametricEqPreview({ numberOfChannels: 0 } as AudioBuffer, {}),
		/between one and 32 channels/u,
	);
	assert.strictEqual(await engine.renderMix({ includeTail: 2, trackId: 'track' }), rendered);
	assert.strictEqual(await engine.renderTrack('track', { includeTail: true }), rendered);
	assert.equal(renderOptions.length, 2);
	await assert.rejects(engine.renderTrack('missing'), /could not be found/u);
	await assert.rejects(engine.renderMixRealtime(), /onChunk callback/u);
	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(engine.renderMixRealtime({ onChunk() {}, signal: aborted.signal }), { name: 'AbortError' });
	await assert.rejects(engine.renderMixRealtime({ onChunk() {} }), /not supported/u);
	await engine.dispose();
});

class TestAudioParam {
	value = 0;

	setValueAtTime(value: number): void {
		this.value = value;
	}

	linearRampToValueAtTime(value: number): void {
		this.value = value;
	}
}

class TestAudioNode {
	disconnected = false;

	connect(): TestAudioNode {
		return this;
	}

	disconnect(): void {
		this.disconnected = true;
	}
}

class TestGainNode extends TestAudioNode {
	readonly gain = new TestAudioParam();
}

class TestAudioBuffer {
	readonly channels: Float32Array[];

	constructor(
		readonly numberOfChannels: number,
		readonly length: number,
		readonly sampleRate: number,
	) {
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	copyToChannel(values: Float32Array, channel: number): void {
		this.channels[channel]?.set(values);
	}

	getChannelData(channel: number): Float32Array {
		return this.channels[channel] as Float32Array;
	}
}

class TestBufferSourceNode extends TestAudioNode {
	buffer: TestAudioBuffer | null = null;
	readonly playbackRate = new TestAudioParam();
	onended: (() => void) | null = null;
	started: readonly [number, number, number] | null = null;

	start(when = 0, offset = 0, duration = 0): void {
		this.started = [when, offset, duration];
	}
}

class TestAudioContext {
	readonly currentTime = 0;
	readonly buffers: TestAudioBuffer[] = [];
	readonly sources: TestBufferSourceNode[] = [];

	constructor(readonly sampleRate: number) {}

	createGain(): TestGainNode {
		return new TestGainNode();
	}

	createBuffer(channelCount: number, frameCount: number, sampleRate: number): TestAudioBuffer {
		const buffer = new TestAudioBuffer(channelCount, frameCount, sampleRate);
		this.buffers.push(buffer);
		return buffer;
	}

	createBufferSource(): TestBufferSourceNode {
		const source = new TestBufferSourceNode();
		this.sources.push(source);
		return source;
	}
}
