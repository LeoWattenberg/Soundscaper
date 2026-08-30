/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_WARP_PCM_AMPLITUDE_ERROR_BUDGET,
	renderExactAudioWarpPcm,
	renderRealtimeAudioWarpPcmProjection,
} from '../src/common/editor/audio-warp-render-parity.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import {
	AUDIO_WARP_EXACT_MAX_CHUNK_FRAMES,
	AUDIO_WARP_EXACT_MIN_CHUNK_FRAMES,
	planExactAudioWarpWindow,
} from '../src/common/editor/engine/audio-warp-fallback.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { ENGINE_SCHEDULE_PLAYBACK } from '../src/common/editor/engine/runtime-symbols.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createSoundscaperNativeAudioRenderer } from '../src/common/editor/soundscaper-native-audio-renderer.ts';

test('engine reports the actual realtime and exact-offline warp facilities it owns', async () => {
	const realtime = createAudioEditorEngine({
		audioContextFactory: (() => undefined) as never,
		offlineAudioContextFactory: (() => undefined) as never,
		audioWarpRealtimeAcceleration: true,
	});
	assert.deepEqual(realtime.getAudioWarpRenderStatus(), {
		path: 'realtime', realtimeAcceleration: true, exactOfflineAvailable: true, fallback: false,
	});
	await realtime.dispose();

	const fallback = createAudioEditorEngine({
		audioContextFactory: (() => undefined) as never,
		offlineAudioContextFactory: (() => undefined) as never,
		audioWarpRealtimeAcceleration: false,
	});
	assert.deepEqual(fallback.getAudioWarpRenderStatus(), {
		path: 'exact-offline', realtimeAcceleration: false, exactOfflineAvailable: true, fallback: true,
	});
	await fallback.dispose();
});

test('engine fails closed when neither exact warp runtime exists', async () => {
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
	});
	assert.throws(() => engine.getAudioWarpRenderStatus(), /exact offline/iu);
	await engine.dispose();
});

test('missing realtime acceleration plays bounded exact PCM matching the shared warp projection', async () => {
	const events: string[] = [];
	const played: number[][] = [];
	const context = audioContext(events, played);
	const sourcePcm = Float32Array.of(0.25, -0.5, 0.75, 0);
	let offlineRenders = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
		softwareRenderer: ({ project, startFrame, endFrame }) => {
			offlineRenders += 1;
			const exactProject = project as ReturnType<typeof warpProject>;
			return { channels: renderExactAudioWarpPcm(
				exactProject,
				exactProject.clips[0]! as unknown as Parameters<typeof renderExactAudioWarpPcm>[1],
				{ startFrame: Number(startFrame), endFrame: Number(endFrame), sourceSampleRate: 48_000 },
				[sourcePcm],
			), sampleRate: 48_000 };
		},
	});
	engine.loadProject(warpProject());

	await engine.play();
	assert.equal(offlineRenders, 1);
	assert.deepEqual(events, ['resume', 'start:0:0']);
	const expectedLive = renderRealtimeAudioWarpPcmProjection(
		warpProject(), warpProject().clips[0]! as unknown as Parameters<typeof renderRealtimeAudioWarpPcmProjection>[1],
		{ startFrame: 0, endFrame: 4, sourceSampleRate: 48_000 }, [sourcePcm],
	)[0]!;
	assertSignalWithinBudget(played[0]!, expectedLive);
	assert.equal(engine.getState().state, 'playing');
	engine.stop();
	events.length = 0;

	await engine.play();
	assert.equal(offlineRenders, 1, 'same project/map reuses the exact PCM cache');
	assert.deepEqual(events, ['resume', 'start:0:0']);
	engine.stop();

	engine.loadProject(warpProject(3));
	await engine.play();
	assert.equal(offlineRenders, 2, 'loading a new map authority invalidates exact PCM');
	await engine.dispose();
});

test('exact sink windows preserve late-range dry gain/pan continuity and stable whole-mix/mono-stem geometry', async () => {
	const renderCalls: Array<Readonly<Record<string, unknown>>> = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
		softwareRenderer: (options) => {
			renderCalls.push(options);
			const captureStart = Number(options.captureStartFrame);
			const endFrame = Number(options.endFrame);
			const channelCount = options.trackId ? 1 : 2;
			const channels = Array.from({ length: channelCount }, (_, channel) => {
				const values = new Float32Array(endFrame - captureStart);
				for (let frame = 0; frame < values.length; frame += 1) {
					const timeline = captureStart + frame;
					values[frame] = filteredFixtureSample(timeline, channel);
				}
				return values;
			});
			return { channels, sampleRate: 8_000 };
		},
	});
	engine.loadProject(warpProject(50_000, 100_000, 8_000, 2));

	const whole = await collectExactSink(engine, null, { startFrame: 50_000, endFrame: 100_000, preRollFrames: 80_000 });
	assert.equal(whole.length, 2);
	assert.equal(whole[0]?.length, 50_000);
	assertSignalWithinBudget(whole[0]!, fixtureSignal(50_000, 0, 50_000));
	assertSignalWithinBudget(whole[1]!, fixtureSignal(50_000, 1, 50_000));
	assert.deepEqual(renderCalls.slice(0, 2).map((call) => ({
		startFrame: call.startFrame,
		captureStartFrame: call.captureStartFrame,
		endFrame: call.endFrame,
	})), [
		{ startFrame: 50_000, captureStartFrame: 50_000, endFrame: 90_000 },
		{ startFrame: 90_000, captureStartFrame: 90_000, endFrame: 100_000 },
	]);

	renderCalls.length = 0;
	const stem = await collectExactSink(engine, 'track', { startFrame: 50_000, endFrame: 100_000, preRollFrames: 80_000 });
	assert.equal(stem.length, 1);
	assertSignalWithinBudget(stem[0]!, fixtureSignal(50_000, 0, 50_000));
	assert.ok(renderCalls.every((call) => call.trackId === 'track'));
	await engine.dispose();
});

test('stateful or opaque effect graphs refuse exact windows before offline render work', async () => {
	for (const type of ['highpass', 'compressor', 'delay', 'reverb', 'audacity-invert', 'unknown']) {
		let renders = 0;
		const engine = createAudioEditorEngine({
			audioContextFactory: null,
			offlineAudioContextFactory: null,
			audioWarpRealtimeAcceleration: false,
			softwareRenderer: () => { renders += 1; return { channels: [new Float32Array(4)], sampleRate: 48_000 }; },
		});
		const project = structuredClone(warpProject());
		(project.master as { effects: unknown[] }).effects = [{ id: `effect-${type}`, type, enabled: true, params: {} }];
		engine.loadProject(project);
		await assert.rejects(engine.renderMixRealtime({ onChunk() {} }), /cannot reset.*processor/iu);
		assert.equal(renders, 0, `${type} refuses before offline graph work`);
		await engine.dispose();
	}
});

test('delayed next playback window fails at the exact boundary instead of shifting time', async () => {
	const events: string[] = [];
	const errors: unknown[] = [];
	const context = audioContext(events, []);
	context.currentTime = 0;
	let renders = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
		softwareRenderer: async ({ captureStartFrame, endFrame }) => {
			renders += 1;
			if (renders === 2) context.currentTime = 6;
			return { channels: [new Float32Array(Number(endFrame) - Number(captureStartFrame))], sampleRate: 8_000 };
		},
	});
	const long = warpProject(40_000, 80_000, 8_000, 1);
	engine.loadProject(long);
	const previousError = console.error;
	console.error = (error: unknown) => { errors.push(error); };
	try {
		await engine.play();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(renders, 2, 'next bounded window is prefetched immediately');
		assert.equal(engine.getState().state, 'stopped');
		assert.match(String((errors[0] as Error)?.message), /before the audio deadline/iu);
		assert.deepEqual(events.filter((event) => event.startsWith('start:')), ['start:0:0']);
	} finally {
		console.error = previousError;
		await engine.dispose();
	}
});

test('exact playback retains only the current and one prefetched window', async () => {
	const events: string[] = [];
	const scheduledSources: MockScheduledSource[] = [];
	const context = audioContext(events, [], scheduledSources);
	let renders = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
		softwareRenderer: ({ captureStartFrame, endFrame }) => {
			renders += 1;
			return {
				channels: [new Float32Array(Number(endFrame) - Number(captureStartFrame))],
				sampleRate: 8_000,
			};
		},
	});
	engine.loadProject(warpProject(80_000, 160_000, 8_000, 1));

	await engine.play();
	await settleMicrotasks();
	assert.equal(renders, 2, 'only current A and following B render before A ends');
	assert.equal(scheduledSources.length, 2);
	assert.equal(scheduledSources.filter(({ active }) => active).length, 2);
	await settleMacrotask();
	assert.equal(renders, 2, 'a suspended or frozen audio clock cannot recursively admit C');
	assert.equal(scheduledSources.length, 2);

	context.currentTime = 5;
	scheduledSources[0]!.onended?.();
	await settleMicrotasks();
	assert.equal(renders, 3, 'A cleanup admits exactly the next C window');
	assert.equal(scheduledSources.length, 3);
	assert.equal(scheduledSources.filter(({ active }) => active).length, 2);

	context.currentTime = 10;
	scheduledSources[1]!.onended?.();
	await settleMicrotasks();
	assert.equal(renders, 4, 'B cleanup admits the final D window');
	assert.equal(scheduledSources.filter(({ active }) => active).length, 2);
	await engine.dispose();
});

test('two-hour timelines use the same bounded exact window geometry', () => {
	const plan = planExactAudioWarpWindow({
		startFrame: 0,
		endFrame: 2 * 60 * 60 * 48_000,
		sampleRate: 48_000,
		channelCount: 2,
		playbackCopy: true,
	});
	assert.equal(plan.endFrame, 240_000);
	assert.equal(plan.frameCount, 240_000);
	assert.ok(plan.endFrame < 2 * 60 * 60 * 48_000);
	const latency = planExactAudioWarpWindow({
		startFrame: 0,
		endFrame: 1_000_000,
		sampleRate: 48_000,
		channelCount: 32,
		preRollFrames: 1_000,
		graphLatencyFrames: 1_000,
		playbackCopy: true,
	});
	assert.equal(latency.frameCount, 86_714);
	assert.throws(() => planExactAudioWarpWindow({
		startFrame: 0,
		endFrame: 1,
		sampleRate: 48_000,
		channelCount: 32,
		preRollFrames: 200_000,
		graphLatencyFrames: 62_144,
		playbackCopy: true,
	}), /exceed.*window budget/iu);
});

test('exact public render route enforces packet bounds without recursion', async () => {
	let offlineCalls = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
		softwareRenderer: ({ captureStartFrame, endFrame }) => {
			offlineCalls += 1;
			return { channels: [new Float32Array(Number(endFrame) - Number(captureStartFrame))], sampleRate: 48_000 };
		},
	});
	engine.loadProject(warpProject());
	for (const chunkFrames of [AUDIO_WARP_EXACT_MIN_CHUNK_FRAMES, AUDIO_WARP_EXACT_MAX_CHUNK_FRAMES]) {
		let written = 0;
		const result = await engine.renderMixRealtime({
			startFrame: 0, endFrame: 4, chunkFrames,
			onChunk: (channels) => { written += channels[0]?.length ?? 0; },
		});
		assert.equal(result.frameCount, 4);
		assert.equal(written, 4);
	}
	assert.equal(offlineCalls, 2, 'each public exact route calls the non-realtime renderer once');
	await assert.rejects(engine.renderMixRealtime({
		startFrame: 0, endFrame: 4, chunkFrames: AUDIO_WARP_EXACT_MIN_CHUNK_FRAMES - 1,
		onChunk() {},
	}), /between 128 and 16384/iu);
	await assert.rejects(engine.renderMixRealtime({
		startFrame: 0, endFrame: 4, chunkFrames: AUDIO_WARP_EXACT_MAX_CHUNK_FRAMES + 1,
		onChunk() {},
	}), /between 128 and 16384/iu);
	assert.equal(offlineCalls, 2, 'invalid packets are rejected before offline graph work');
	await engine.dispose();
});

test('seeking outside the prepared window re-prepares exact PCM at the requested frame', async () => {
	const context = audioContext([], []);
	let renders = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
		softwareRenderer: ({ captureStartFrame, endFrame }) => {
			renders += 1;
			return { channels: [new Float32Array(Number(endFrame) - Number(captureStartFrame))], sampleRate: 8_000 };
		},
	});
	engine.loadProject(warpProject(40_000, 80_000, 8_000, 1));
	engine.seek(40_000);
	await engine.play();
	assert.equal(renders, 1);

	engine.seek(0);
	await settleMacrotask();
	assert.equal(engine.getState().positionFrame, 0, 'a seek must not clamp into the stale prepared window');
	assert.ok(renders > 1, 'the requested position needs its own bounded window');

	const rendered = renders;
	engine.seek(120_000);
	await settleMacrotask();
	assert.equal(engine.getState().state, 'stopped', 'the silent editor tail holds no exact warp content');
	assert.equal(engine.getState().positionFrame, 120_000);
	assert.equal(renders, rendered);
	await engine.dispose();
});

test('scheduled exact warp starts snap into the active loop instead of rejecting', async () => {
	const events: string[] = [];
	const context = audioContext(events, []);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
		softwareRenderer: ({ captureStartFrame, endFrame }) => ({
			channels: [new Float32Array(Number(endFrame) - Number(captureStartFrame))], sampleRate: 48_000,
		}),
	});
	engine.loadProject(warpProject());
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 2 });

	await engine.playAt(0, 3);
	assert.equal(engine.getState().positionFrame, 0);
	assert.deepEqual(events.filter((event) => event.startsWith('start:')), ['start:0:0']);
	await engine.dispose();
});

test('exact warp playback follows an attached native output route', async () => {
	const connections: unknown[] = [];
	const context = audioContext([], [], [], connections);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false,
		softwareRenderer: ({ captureStartFrame, endFrame }) => ({
			channels: [new Float32Array(Number(endFrame) - Number(captureStartFrame))], sampleRate: 48_000,
		}),
	});
	const nativeWindow = {} as Window;
	let receive: ((event: Event) => void) | null = null;
	const device = { connect() {}, disconnect() {} } as AudioNode;
	const renderer = createSoundscaperNativeAudioRenderer({
		engine,
		windowValue: {
			window: nativeWindow,
			addEventListener: (_type, listener) => { receive = listener as (event: Event) => void; },
			removeEventListener() {},
		} as never,
		createNode: async () => ({
			node: device, attach: (_port, value) => value.generation,
			revoke: () => 1, notifyPeerLoss: () => 1, calibrate: async () => 0, dispose() {},
		}),
	});
	await renderer.prepare('native-output', {
		candidates: [{ backend: 'alsa', deviceHandle: 'device' }], direction: 'output', mode: 'shared',
		sampleRate: 48_000, periodFrames: 128, channelCount: 1,
	});
	receive?.({
		source: nativeWindow,
		data: { type: 'soundscaper-native-realtime-port-v1', offer: {
			protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: 48_000,
			channelCount: 1, frameCount: 128, queueCapacity: 8, startFrame: 0,
		} }, ports: [{ close() {} }],
	} as unknown as Event);
	engine.loadProject(warpProject());
	await engine.play();
	assert.strictEqual(connections.at(-1), device);
	await renderer.dispose();
	await engine.dispose();
});

test('play() keeps a cursor parked in the silent editor timeline tail', async () => {
	const context = audioContext([], []);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		offlineAudioContextFactory: null,
	});
	engine.loadProject(warpProject(2, 4, 8_000, 1, false));
	const scheduled: number[] = [];
	(engine as unknown as Record<symbol, unknown>)[ENGINE_SCHEDULE_PLAYBACK] = (frame: number) => {
		scheduled.push(frame);
		return Promise.resolve(0);
	};
	assert.equal(engine.seek(6_000), 6_000);

	await engine.play();
	assert.deepEqual(scheduled, [6_000], 'the extended editor timeline tail is a legal play position');
	await engine.dispose();
});

function warpProject(middleSource = 2, durationFrames = 4, sampleRate = 48_000, masterChannels = 1, warped = true) {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', frameCount: durationFrames,
		channelCount: masterChannels, sampleRate,
	});
	const clip = createAudioClip({
			id: 'clip', kind: 'audio', sourceId: 'source', anchor: 'sample',
		timelineStartFrame: 0, durationFrames, sourceStartFrame: 0, sourceDurationFrames: durationFrames,
		warpMap: warped ? { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: Math.floor(durationFrames / 2), source: middleSource, mode: 'forward' },
			{ outer: durationFrames, source: durationFrames, mode: 'forward' },
		] } : undefined,
		});
	return createAudioEditorProjectV17({
		id: 'warp-project', title: 'Warp project', now: '2026-08-12T12:00:00.000Z',
		sampleRate, masterChannels, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Warp', clipIds: ['clip'] }, sampleRate)],
	});
}

async function collectExactSink(
	engine: ReturnType<typeof createAudioEditorEngine>,
	trackId: string | null,
	range: Readonly<{ startFrame: number; endFrame: number; preRollFrames: number }> = {
		startFrame: 0, endFrame: 100_000, preRollFrames: 2,
	},
): Promise<Float32Array[]> {
	const chunks: Array<readonly Float32Array[]> = [];
	const sink = (channels: readonly Float32Array[]): void => { chunks.push([...channels]); };
	const result = trackId
		? await engine.renderTrackToSink(trackId, { ...range, sink })
		: await engine.renderMixToSink({ ...range, sink });
	const output = Array.from({ length: result.channelCount }, () => new Float32Array(result.frameCount));
	let offset = 0;
	for (const chunk of chunks) {
		for (let channel = 0; channel < output.length; channel += 1) output[channel]!.set(chunk[channel]!, offset);
		offset += chunk[0]?.length ?? 0;
	}
	return output;
}

function fixtureSignal(frameCount: number, channel: number, startFrame = 0): Float32Array {
	return Float32Array.from({ length: frameCount }, (_, frame) => filteredFixtureSample(startFrame + frame, channel));
}

function filteredFixtureSample(frame: number, channel: number): number {
	const source = (at: number) => at < 0 ? 0 : Math.sin((at + 1) * (channel + 1) * 0.17);
	return source(frame) * 0.75 + source(frame - 1) * 0.2 + source(frame - 2) * 0.05;
}

function assertSignalWithinBudget(actual: ArrayLike<number>, expected: Float32Array): void {
	assert.equal(actual.length, expected.length);
	for (let frame = 0; frame < expected.length; frame += 1) {
		assert.ok(Math.abs(actual[frame]! - expected[frame]!) <= AUDIO_WARP_PCM_AMPLITUDE_ERROR_BUDGET,
			`signal error at frame ${String(frame)}`);
	}
}

interface MockScheduledSource {
	active: boolean;
	buffer: { getChannelData(channel: number): Float32Array } | null;
	onended: (() => void) | null;
}

function audioContext(
	events: string[],
	played: number[][],
	scheduledSources: MockScheduledSource[] = [],
	connections: unknown[] = [],
) {
	return {
		currentTime: 0,
		sampleRate: 48_000,
		destination: { connect() {}, disconnect() {} },
		createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
		resume: () => { events.push('resume'); return Promise.resolve(); },
		close: () => Promise.resolve(),
		createBuffer: (channels: number, frames: number, sampleRate: number) => {
			const data = Array.from({ length: channels }, () => new Float32Array(frames));
			return {
				numberOfChannels: channels, length: frames, sampleRate,
				getChannelData: (channel: number) => data[channel]!,
				copyToChannel: (values: Float32Array, channel: number) => { data[channel]!.set(values); },
			};
		},
		createBufferSource: () => {
			const source: MockScheduledSource & Record<string, unknown> = {
			active: false,
			buffer: null,
			onended: null,
			loop: false,
			loopStart: 0,
			loopEnd: 0,
			connect(destination: unknown) { connections.push(destination); },
			disconnect() { source.active = false; },
			start(this: { buffer: { getChannelData(channel: number): Float32Array } | null }, when: number, offset: number) {
				source.active = true;
				events.push(`start:${String(when)}:${String(offset)}`);
				if (this.buffer) played.push([...this.buffer.getChannelData(0)]);
			},
			stop() { source.active = false; },
			};
			scheduledSources.push(source);
			return source;
		},
	};
}

async function settleMicrotasks(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

async function settleMacrotask(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await settleMicrotasks();
}
