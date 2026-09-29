/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { buildProjectGraph, type ProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import { registerParallelStackPlayback } from '../src/common/editor/engine/parallel-stack-playback.ts';
import {
	ENGINE_ENSURE_MASTER_LOUDNESS_METER,
	ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK,
} from '../src/common/editor/engine/runtime-symbols.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createProject } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

function delayedPlayback(graphLatencyFrames: number | null = null) {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as never });
	engine.loadProject(createProject() as EngineProject, new Map([
		['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
	]));
	const runtime = engine as unknown as EngineRuntimeHost;
	// A controlled graph stands in for asynchronous desktop worker startup.
	runtime.projectGraphSelection = 'v21';
	let release: () => void = () => { throw new Error('Preparation has not begun'); };
	let started: () => void = () => { throw new Error('Preparation has not begun'); };
	const entered = new Promise<void>((resolve) => { started = resolve; });
	const meteringRequests: boolean[] = [];
	registerParallelStackPlayback(runtime, (request, signal) => {
		meteringRequests.push(request.metering);
		const graph = buildProjectGraph(request.context, request.destination, request.project, {
			graph: 'legacy', metering: request.metering,
		});
		if (graphLatencyFrames !== null) Object.assign(graph, { latencyFrames: graphLatencyFrames });
		if (meteringRequests.length > 1) return Promise.resolve(graph);
		started();
		return new Promise<ProjectGraph>((resolve, reject) => {
			const aborted = (): void => { reject(new DOMException('Playback cancelled', 'AbortError')); };
			signal.addEventListener('abort', aborted, { once: true });
			release = () => { signal.removeEventListener('abort', aborted); resolve(graph); };
		});
	});
	return { engine, runtime, entered, meteringRequests, release: () => release() };
}

test('a loop changed during worker startup bounds the first scheduled run', async () => {
	const { engine, runtime, entered, release } = delayedPlayback();
	const playing = engine.play();
	await entered;
	assert.equal(engine.getState().state, 'stopped');
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 4_800 });
	release();
	await playing;
	assert.equal(runtime.playEndFrame, 4_800);
	engine.stop();
	await engine.dispose();
});

test('a short play range changed during worker startup bounds the first scheduled run', async () => {
	const { engine, runtime, entered, release } = delayedPlayback();
	const playing = engine.play();
	await entered;
	engine.setPlayRange({ startFrame: 0, endFrame: 6_000 });
	release();
	await playing;
	assert.equal(runtime.playEndFrame, 6_000);
	engine.stop();
	await engine.dispose();
});

test('a meter added during worker startup receives a metered graph', async () => {
	const { engine, runtime, entered, meteringRequests, release } = delayedPlayback();
	const playing = engine.play();
	await entered;
	const unsubscribe = engine.subscribeMeters(() => {});
	release();
	await playing;
	assert.deepEqual(meteringRequests, [false, true]);
	assert.ok(runtime.graph?.masterAnalyser);
	unsubscribe();
	engine.stop();
	await engine.dispose();
});

test('a metering rebuild preserves the recorder start barrier', async () => {
	const { engine, entered, release } = delayedPlayback();
	let acknowledgements = 0;
	const starting = engine.playAt(0, 0, async (candidate) => {
		acknowledgements += 1;
		return candidate;
	});
	await entered;
	const unsubscribe = engine.subscribeMeters(() => {});
	release();
	await starting;
	assert.equal(acknowledgements, 1);
	unsubscribe();
	engine.stop();
	await engine.dispose();
});

test('a newer Play retires a still preparing Play without resurrecting its graph', async () => {
	const { engine, runtime, entered, meteringRequests } = delayedPlayback();
	const first = engine.play();
	await entered;
	const second = engine.play();
	await Promise.all([first, second]);
	assert.equal(engine.getState().state, 'playing');
	assert.equal(meteringRequests.length, 2);
	assert.ok(runtime.graph);
	assert.equal(runtime.graph.abortController.signal.aborted, false);
	engine.stop();
	await engine.dispose();
});

test('clocked recording starts can read active graph latency in context frames', async () => {
	const { engine, entered, release } = delayedPlayback(1_536);
	assert.equal(engine.getPlaybackGraphLatencyFrames(), 0);
	assert.equal(engine.getPlaybackAudibleStartTime(), null);
	const starting = engine.playAt(0, 0);
	await entered;
	release();
	const scheduled = await starting;
	assert.equal(engine.getPlaybackGraphLatencyFrames(), 1_536);
	assert.equal(engine.getPlaybackAudibleStartTime(), scheduled + 1_536 / 48_000);
	engine.stop();
	assert.equal(engine.getPlaybackGraphLatencyFrames(), 0);
	assert.equal(engine.getPlaybackAudibleStartTime(), null);
	await engine.dispose();
});

test('clocked playback reserves recorder startup time after parallel graph preparation', async () => {
	const { engine, entered, release } = delayedPlayback();
	const context = await engine.getAudioContext() as unknown as MockAudioContext;
	const starting = engine.playAt(0.08, 0);
	await entered;
	context.currentTime = 1;
	release();
	const scheduled = await starting;
	assert.ok(scheduled >= 1.25, `source started too soon at ${String(scheduled)}`);
	assert.equal(context.bufferSources.at(-1)?.started?.[0], scheduled);
	engine.stop();
	await engine.dispose();
});

test('clocked playback waits for capture acknowledgement before scheduling a source', async () => {
	const { engine, entered, release } = delayedPlayback();
	const context = await engine.getAudioContext() as unknown as MockAudioContext;
	let acknowledged = false;
	const starting = engine.playAt(0, 0, async (candidate) => {
		assert.equal(context.bufferSources.at(-1)?.started, undefined);
		acknowledged = true;
		return candidate + 0.125;
	});
	await entered;
	context.currentTime = 1;
	release();
	const scheduled = await starting;
	assert.equal(acknowledged, true);
	assert.ok(scheduled >= 1.375, `source did not use the acknowledged origin: ${String(scheduled)}`);
	assert.equal(context.bufferSources.at(-1)?.started?.[0], scheduled);
	engine.stop();
	await engine.dispose();
});

test('stopping during capture acknowledgement never starts the retired source', async () => {
	const { engine, entered, release } = delayedPlayback();
	const context = await engine.getAudioContext() as unknown as MockAudioContext;
	let acknowledge: () => void = () => { throw new Error('The recorder was not armed.'); };
	let armed: () => void = () => { throw new Error('The recorder was not armed.'); };
	const armedPromise = new Promise<void>((resolve) => { armed = resolve; });
	const acknowledged = new Promise<void>((resolve) => { acknowledge = resolve; });
	const starting = engine.playAt(0, 0, async (candidate) => {
		armed();
		await acknowledged;
		return candidate;
	});
	await entered;
	release();
	await armedPromise;
	engine.stop();
	acknowledge();
	await assert.rejects(starting, /cancel|abort/iu);
	assert.equal(context.bufferSources.at(-1)?.started, undefined);
	await engine.dispose();
});

test('clocked playback reserves recorder startup time with no clips after meter preparation', async () => {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const project = createProject();
	project.clips = [];
	project.tracks[0]!.clipIds = [];
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as never });
	engine.loadProject(project as EngineProject, new Map());
	const runtime = engine as unknown as EngineRuntimeHost;
	const unsubscribe = engine.subscribeMeters(() => {});
	let release: () => void = () => { throw new Error('Meter preparation has not begun'); };
	let entered: () => void = () => { throw new Error('Meter preparation has not begun'); };
	const meterEntered = new Promise<void>((resolve) => { entered = resolve; });
	const meterReady = new Promise<null>((resolve) => { release = () => resolve(null); });
	runtime[ENGINE_ENSURE_MASTER_LOUDNESS_METER] = async () => { entered(); return meterReady; };
	const starting = engine.playAt(0.08, 0);
	await meterEntered;
	context.currentTime = 1;
	release();
	const scheduled = await starting;
	assert.ok(scheduled >= 1.25, `source started too soon at ${String(scheduled)}`);
	assert.equal(engine.getPlaybackAudibleStartTime(), scheduled);
	unsubscribe();
	engine.stop();
	await engine.dispose();
});

test('a worker startup fault rejects clocked playAt without reporting the fault twice', async () => {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as never });
	engine.loadProject(createProject() as EngineProject, new Map([
		['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
	]));
	const runtime = engine as unknown as EngineRuntimeHost;
	runtime.projectGraphSelection = 'v21';
	const fault = new Error('Parallel worker missed its deadline');
	const errors: unknown[] = [];
	const unsubscribe = engine.subscribePlaybackErrors((error) => { errors.push(error); });
	registerParallelStackPlayback(runtime, async (request) => {
		const graph = buildProjectGraph(request.context, request.destination, request.project, { graph: 'legacy' });
		request.onFailure(fault);
		return graph;
	});
	await assert.rejects(engine.playAt(0, 0), fault);
	assert.deepEqual(errors, [fault]);
	assert.equal(engine.getState().state, 'stopped');
	unsubscribe();
	await engine.dispose();
});

test('stop during asynchronous meter setup cannot restart a retired transport', async () => {
	const { engine, runtime, entered, meteringRequests, release } = delayedPlayback();
	const playing = engine.play();
	await entered;
	release();
	await playing;
	assert.equal(engine.getState().state, 'playing');
	assert.equal(runtime.graph?.masterAnalyser, null);
	let continueMeter: () => void = () => { throw new Error('Meter setup has not begun'); };
	let meterStarted: () => void = () => { throw new Error('Meter setup has not begun'); };
	const meterEntered = new Promise<void>((resolve) => { meterStarted = resolve; });
	const meterReady = new Promise<void>((resolve) => { continueMeter = resolve; });
	runtime[ENGINE_ENSURE_MASTER_LOUDNESS_METER] = async () => { meterStarted(); await meterReady; return null; };
	const unsubscribe = engine.subscribeMeters(() => {});
	await meterEntered;
	engine.stop();
	continueMeter();
	await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	assert.equal(engine.getState().state, 'stopped');
	assert.equal(runtime.graph, null);
	assert.deepEqual(meteringRequests, [false]);
	unsubscribe();
	await engine.dispose();
});

test('older meter setup cannot replace the graph scheduled by a newer loop change', async () => {
	const { engine, runtime, entered, meteringRequests, release } = delayedPlayback();
	const playing = engine.play();
	await entered;
	release();
	await playing;
	let continueMeter: () => void = () => { throw new Error('Meter setup has not begun'); };
	let meterStarted: () => void = () => { throw new Error('Meter setup has not begun'); };
	const meterEntered = new Promise<void>((resolve) => { meterStarted = resolve; });
	const meterReady = new Promise<void>((resolve) => { continueMeter = resolve; });
	let meterCalls = 0;
	runtime[ENGINE_ENSURE_MASTER_LOUDNESS_METER] = async () => {
		meterCalls += 1;
		if (meterCalls === 1) { meterStarted(); await meterReady; }
		return null;
	};
	const meterListener = () => {};
	runtime.meterListeners.add(meterListener);
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 24_000 });
	await meterEntered;
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 12_000 });
	await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	const latestGraph = runtime.graph;
	assert.ok(latestGraph);
	assert.equal(runtime.playEndFrame, 12_000);
	continueMeter();
	await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	const finalGraph = runtime.graph;
	const requests = [...meteringRequests];
	runtime.meterListeners.delete(meterListener);
	engine.stop();
	await engine.dispose();
	assert.strictEqual(finalGraph, latestGraph);
	assert.deepEqual(requests, [false, true]);
});

for (const playbackMode of ['staffpad', 'audio-warp-exact'] as const) {
	test(`stop during ${playbackMode} meter setup cannot start a retired transport`, async () => {
		const context = new MockAudioContext({ sampleRate: 48_000 });
		const engine = createAudioEditorEngine({ audioContextFactory: () => context as never });
		engine.loadProject(createProject() as EngineProject, new Map([
			['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
		]));
		await engine.getAudioContext();
		const runtime = engine as unknown as EngineRuntimeHost;
		runtime.playbackMode = playbackMode;
		if (playbackMode === 'staffpad') {
			runtime.preparedSpeedPlayback = {
				channels: [new Float32Array(48_000)], frameCount: 48_000, sampleRate: 48_000,
				durationFrames: 48_000, playbackRate: 1, audioBuffer: null,
			};
		} else {
			runtime.preparedAudioWarpPlayback = {
				project: runtime.project as EngineProject, authorityFingerprint: '', startFrame: 0,
				endFrame: 48_000, channels: [new Float32Array(48_000)], frameCount: 48_000,
				sampleRate: 48_000, audioBuffer: null,
			};
		}
		runtime.meterListeners.add(() => {});
		let meterStarted: () => void = () => { throw new Error('Meter setup has not begun'); };
		const entered = new Promise<void>((resolve) => { meterStarted = resolve; });
		let release: () => void = () => { throw new Error('Meter setup has not begun'); };
		const ready = new Promise<void>((resolve) => { release = resolve; });
		runtime[ENGINE_ENSURE_MASTER_LOUDNESS_METER] = async () => { meterStarted(); await ready; return null; };
		const starting = runtime[ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](0, 0);
		await entered;
		engine.stop();
		release();
		await starting;
		const state = engine.getState().state;
		const graph = runtime.graph;
		await engine.dispose();
		assert.equal(state, 'stopped');
		assert.equal(graph, null);
		assert.equal(context.bufferSources.length, 0);
	});

	test(`${playbackMode} keeps the clocked source start ahead after meter setup`, async () => {
		const context = new MockAudioContext({ sampleRate: 48_000 });
		const engine = createAudioEditorEngine({ audioContextFactory: () => context as never });
		engine.loadProject(createProject() as EngineProject, new Map([
			['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
		]));
		await engine.getAudioContext();
		const runtime = engine as unknown as EngineRuntimeHost;
		runtime.playbackMode = playbackMode;
		if (playbackMode === 'staffpad') runtime.preparedSpeedPlayback = {
			channels: [new Float32Array(48_000)], frameCount: 48_000, sampleRate: 48_000,
			durationFrames: 48_000, playbackRate: 1, audioBuffer: null,
		};
		else runtime.preparedAudioWarpPlayback = {
			project: runtime.project as EngineProject, authorityFingerprint: '', startFrame: 0,
			endFrame: 48_000, channels: [new Float32Array(48_000)], frameCount: 48_000,
			sampleRate: 48_000, audioBuffer: null,
		};
		runtime.meterListeners.add(() => {});
		let entered: () => void = () => { throw new Error('Meter setup has not begun'); };
		const meterEntered = new Promise<void>((resolve) => { entered = resolve; });
		let release: () => void = () => { throw new Error('Meter setup has not begun'); };
		const meterReady = new Promise<void>((resolve) => { release = resolve; });
		runtime[ENGINE_ENSURE_MASTER_LOUDNESS_METER] = async () => { entered(); await meterReady; return null; };
		const starting = runtime[ENGINE_SCHEDULE_PREPARED_SPEED_PLAYBACK](0, 0.08, 0.08);
		await meterEntered;
		context.currentTime = 1;
		release();
		const scheduled = await starting;
		assert.ok(scheduled >= 1.08, `source started too soon at ${String(scheduled)}`);
		assert.equal(context.bufferSources.at(-1)?.started?.[0], scheduled);
		assert.equal(runtime.playbackStartTime, scheduled);
		engine.stop();
		await engine.dispose();
	});
}
