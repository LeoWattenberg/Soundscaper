/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { scheduleProjectClips, type ScheduleProjectClipsOptions } from '../src/common/editor/engine/clip-scheduler.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
type ParamProbe = AudioParam & { events: readonly unknown[][] };
type GainProbe = ReturnType<MockAudioContext['createGain']> & { gain: ParamProbe };

function fixture({ mixed = false, alwaysSlow = false } = {}) {
	const context = new MockAudioContext({ sampleRate: 44_100 });
	const makeGain = context.createGain.bind(context);
	let primed = false;
	let consumed = false;
	let cancelled = 0;
	const streamStarts: number[] = [];
	const cleared: number[] = [];
	context.createGain = () => {
		const node = makeGain();
		const param = (node as GainProbe).gain;
		const set = param.setValueAtTime.bind(param);
		param.setValueAtTime = (value, time) => {
			set(value, time);
			if (primed && (!consumed || alwaysSlow)) {
				assert.equal(context.bufferSources.some(source => source.started), false);
				assert.deepEqual(streamStarts, []);
				consumed = true;
				context.currentTime += 0.016;
			}
			return param;
		};
		param.cancelScheduledValues = time => {
			cleared.push(time);
			param.events = param.events.filter(event => typeof event[2] !== 'number' || event[2] < time);
			return param;
		};
		return node;
	};
	const clips = ['stream', ...mixed ? ['resident'] : []].map(id => ({ id, sourceId: id, timelineStartFrame: 0,
		durationFrames: 24_000, sourceStartFrame: 0, sourceDurationFrames: 24_000, envelope: [{ frame: 0, value: .5 }, { frame: 24_000, value: 1 }] }));
	const project = { sampleRate: 48_000, masterChannels: 1, tracks: [{ id: 'track', type: 'audio', clipIds: clips.map(clip => clip.id) }], clips,
		master: { gain: 1, pan: 0, mute: false, effects: [] } };
	const sources = new Map(mixed ? [['resident', new MockAudioBuffer(1, 24_000, 48_000) as unknown as AudioBuffer]] : []);
	const chunkSources = new Map([['stream', { channelCount: 1, frameCount: 24_000, chunkFrames: 4_096, sampleRate: 48_000,
		readStorageChunk: async () => [new Float32Array(4_096)] }]]);
	const client = { open: () => ({ ready: Promise.resolve(), primed: Promise.resolve().then(() => { primed = true; }),
		done: new Promise<void>(() => {}), play: ({ contextStartFrame }: { contextStartFrame: number }) => { streamStarts.push(contextStartFrame); },
		cancel: () => { cancelled += 1; } }) };
	const chunkAudioNodeFactory = async () => Object.assign(makeGain(), { port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} } }) as unknown as AudioWorkletNode;
	return { context, project, sources, chunkSources, client, chunkAudioNodeFactory, streamStarts, cleared, cancelled: () => cancelled };
}

function scheduleOptions(f: ReturnType<typeof fixture>): ScheduleProjectClipsOptions {
	return { context: f.context as unknown as BaseAudioContext, project: f.project, sources: f.sources, chunkSources: f.chunkSources,
		trackInputs: new Map([['track', f.context.createGain() as unknown as AudioNode]]), fromFrame: 0, toFrame: 24_000, contextStartTime: 0,
		sampleRate: 48_000, reversedBuffers: new WeakMap(), sourceResolver: null, activeSources: new Set(), allNodes: [],
		chunkStreamClient: f.client as never, chunkAudioNodeFactory: f.chunkAudioNodeFactory, deferStartUntilPrimed: true, allowUnstartedStartRebase: true };
}

for (const mixed of [false, true]) test(`ordinary Play rebases an unstarted ${mixed ? 'mixed' : 'streamed'} graph after one native clock step`, async t => {
	const f = fixture({ mixed });
	const engine = createAudioEditorEngine({ audioContextFactory: () => f.context as never, chunkStreamClient: f.client as never, chunkAudioNodeFactory: f.chunkAudioNodeFactory });
	t.after(() => engine.dispose());
	engine.loadProject(f.project, f.sources, { chunkSources: f.chunkSources });
	await engine.play();
	assert.equal(engine.getState().state, 'playing');
	assert.equal(f.cancelled(), 0);
	assert.ok(f.cleared.includes(.02), 'the abandoned automation window is removed before replacement');
	const time = (engine as unknown as EngineRuntimeHost).playbackStartTime;
	assert.ok(time > f.context.currentTime + 2 * 128 / f.context.sampleRate);
	assert.deepEqual(f.streamStarts, [Math.round(time * f.context.sampleRate)]);
	if (mixed) assert.equal(f.context.bufferSources[0]!.started[0], time);
});

test('an owned recorder start is confirmed once and remains strict when automation consumes its lead', async () => {
	const f = fixture({ mixed: true });
	let confirmations = 0;
	await assert.rejects(scheduleProjectClips({
		...scheduleOptions(f),
		onBeforeStart: async candidate => { confirmations += 1; return candidate; },
	}), /shared playback start/iu);
	assert.equal(confirmations, 1);
	assert.equal(f.context.bufferSources.some(source => source.started), false);
	assert.deepEqual(f.streamStarts, []);
	assert.ok(f.cancelled() > 0);
});

test('project gain and delayed registry automation replace the complete old window at the shared source frame', async () => {
	const f = fixture({ mixed: true });
	const track = (f.context.createGain() as GainProbe).gain;
	const master = (f.context.createGain() as GainProbe).gain;
	const laneParam = (f.context.createGain() as GainProbe).gain;
	const registry = new ScheduledParameterRegistry();
	const address = { kind: 'strip' as const, strip: { kind: 'track' as const, id: 'track' }, parameterId: 'gain' as const };
	registry.registerAudioParam(stripParameterDescriptor(address, 441), laneParam);
	const envelope = [{ frame: 0, value: .2 }, { frame: 24_000, value: .8 }];
	const scheduled = await scheduleProjectClips({ ...scheduleOptions(f), parameterRegistry: registry,
		projectGainParams: { tracks: new Map([['track', { param: track, latencyFrames: 220 }]]), groups: new Map(), sends: new Map(), master: { param: master, latencyFrames: 0 } },
		project: { ...f.project, schemaFamily: 'soundscaper', schemaVersion: 1, mixer: {},
			tracks: f.project.tracks.map(value => ({ ...value, envelope })), master: { ...f.project.master, envelope },
			automationLanes: [{ id: 'gain', address, timebase: 'absolute-samples', points: [{ id: 'first', position: 0, value: .2 }, { id: 'last', position: 24_000, value: .8 }], segments: [{ kind: 'linear' }] }] },
	});
	const start = scheduled.contextStartTime;
	for (const [param, latency] of [[track, 220], [master, 0], [laneParam, 441]] as const) {
		const events = param.events.map(event => event[2] as number);
		assert.equal(events.length, 2);
		assert.ok(Math.abs(events[0] - (start + latency / f.context.sampleRate)) < 1e-12);
		assert.ok(Math.abs(events[1] - (start + latency / f.context.sampleRate + .5)) < 1e-12);
	}
	assert.equal(f.context.bufferSources[0]!.started[0], start);
	assert.deepEqual(f.streamStarts, [Math.round(start * f.context.sampleRate)]);
});

test('cancellation while the recorder confirms its boundary retires unstarted sources before playback', async () => {
	const f = fixture({ mixed: true });
	const abort = new AbortController();
	let entered!: () => void;
	const ready = new Promise<void>(resolve => { entered = resolve; });
	let release!: (time: number) => void;
	const confirmation = new Promise<number>(resolve => { release = resolve; });
	const operation = scheduleProjectClips({ ...scheduleOptions(f), signal: abort.signal,
		onBeforeStart: candidate => { entered(); assert.equal(candidate, .02); return confirmation; } });
	await ready;
	abort.abort();
	release(.02);
	await assert.rejects(operation, { name: 'AbortError' });
	assert.equal(f.context.bufferSources.some(source => source.started), false);
	assert.ok(f.context.bufferSources.every(source => source.disconnected));
	assert.deepEqual(f.streamStarts, []);
	assert.ok(f.cancelled() > 0);
});

for (const owner of ['source', 'message'] as const) test(`a preexisting ${owner} owner keeps the original start strict`, async () => {
	const f = fixture({ mixed: true });
	const registry = new ScheduledParameterRegistry();
	if (owner === 'message') registry.registerMessageTarget(stripParameterDescriptor({ kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'gain' }), () => undefined);
	const activeSources = new Set(owner === 'source' ? [{ stop() {} }] : []);
	await assert.rejects(scheduleProjectClips({ ...scheduleOptions(f), parameterRegistry: registry, activeSources }), /shared playback start/iu);
	assert.equal(f.context.bufferSources.some(source => source.started), false);
	assert.deepEqual(f.streamStarts, []);
});

test('persistent setup overruns fail before any resident or stream is committed', async t => {
	const f = fixture({ mixed: true, alwaysSlow: true });
	const engine = createAudioEditorEngine({ audioContextFactory: () => f.context as never, chunkStreamClient: f.client as never, chunkAudioNodeFactory: f.chunkAudioNodeFactory });
	t.after(() => engine.dispose());
	engine.loadProject(f.project, f.sources, { chunkSources: f.chunkSources });
	await assert.rejects(engine.play(), /shared playback start/iu);
	assert.equal(engine.getState().state, 'stopped');
	assert.equal(f.context.bufferSources.some(source => source.started), false);
	assert.deepEqual(f.streamStarts, []);
	assert.ok(f.cancelled() > 0);
});
