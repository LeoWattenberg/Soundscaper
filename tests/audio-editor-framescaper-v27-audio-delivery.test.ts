/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeRenderedAudio, type RenderedAudioEncodingPlan } from '../src/common/editor/controller/rendered-audio-encoding.ts';
import { createExportRenderProject } from '../src/common/editor/controller/export-render-project.ts';
import { ensureProjectWorklets, getParametricEqWasmModule } from '../src/common/editor/engine/effect-worklets.ts';
import { scheduleProjectAutomationLanesV21 } from '../src/common/editor/engine/project-automation-scheduler-v21.ts';
import { buildProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { LOUDNESS_NORMALIZATION_TARGETS } from '../src/common/editor/loudness-normalization.ts';
import {
	createFramescaperDialogueChainAddCommandV27,
	createFramescaperDialogueChainV27,
} from '../src/framescaper/editor-audio-dialogue-chain-v27.ts';
import { createFramescaperPlaybackProjectServiceV27 } from '../src/framescaper/editor-project-playback-v27.ts';
import { applyFramescaperProjectCommandV27 } from '../src/framescaper/editor-project-v27-commands.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

type ParamCall = readonly ['set' | 'linear' | 'cancel', number, number?];

class FakeParam {
	value: number;
	readonly calls: ParamCall[] = [];

	constructor(value = 0) { this.value = value; }

	setValueAtTime(value: number, time: number): AudioParam {
		this.value = value;
		this.calls.push(['set', value, time]);
		return this as unknown as AudioParam;
	}

	linearRampToValueAtTime(value: number, time: number): AudioParam {
		this.value = value;
		this.calls.push(['linear', value, time]);
		return this as unknown as AudioParam;
	}

	cancelScheduledValues(time: number): AudioParam {
		this.calls.push(['cancel', time]);
		return this as unknown as AudioParam;
	}
}

class FakeNode {
	readonly kind: string;
	readonly connections: FakeNode[] = [];

	constructor(kind: string) { this.kind = kind; }

	connect(target: FakeNode): FakeNode {
		this.connections.push(target);
		return target;
	}

	disconnect(): void { this.connections.length = 0; }
}

class FakePort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

	postMessage(): void {}

	start(): void {
		queueMicrotask(() => this.onmessage?.({
			data: { type: 'status', status: 'ready' },
		} as MessageEvent<unknown>));
	}
}

class FakeContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new FakeNode('destination');
	readonly created: Array<FakeNode & Record<string, unknown>> = [];
	readonly audioWorklet = { addModule: async (): Promise<void> => undefined };
	#counter = 0;

	register(node: FakeNode & Record<string, unknown>): void { this.created.push(node); }
	createGain() { return this.#make('gain', { gain: new FakeParam(1) }); }
	createStereoPanner() { return this.#make('panner', { pan: new FakeParam(0) }); }
	createDelay() { return this.#make('delay', { delayTime: new FakeParam(0) }); }
	createChannelSplitter(channels: number) { return this.#make('splitter', { channels }); }
	createChannelMerger(channels: number) { return this.#make('merger', { channels }); }
	createBiquadFilter() {
		return this.#make('biquad', {
			type: 'highpass', frequency: new FakeParam(), Q: new FakeParam(), gain: new FakeParam(),
		});
	}
	createDynamicsCompressor() {
		return this.#make('compressor', {
			threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(),
			attack: new FakeParam(), release: new FakeParam(),
		});
	}
	createAnalyser() {
		return this.#make('analyser', {
			fftSize: 256, frequencyBinCount: 128, smoothingTimeConstant: 0,
			minDecibels: -120, maxDecibels: 0,
			getFloatTimeDomainData(target: Float32Array) { target.fill(0); },
			getFloatFrequencyDomainData(target: Float32Array) { target.fill(-120); },
		});
	}

	#make(kind: string, fields: Record<string, unknown>): FakeNode & Record<string, unknown> {
		this.#counter += 1;
		const node = Object.assign(new FakeNode(`${kind}:${String(this.#counter)}`), fields);
		this.created.push(node);
		return node;
	}
}

class FakeWorkletNode extends FakeNode {
	readonly options: AudioWorkletNodeOptions;
	readonly port = new FakePort();
	onprocessorerror: (() => void) | null = null;

	constructor(context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions = {}) {
		super(`worklet:${name}`);
		this.options = options;
		(context as unknown as FakeContext).register(this as unknown as FakeNode & Record<string, unknown>);
	}
}

test('selected V27 preview and audio delivery execute one shared mixer, automation lane, and dialogue rack', async () => {
	const previous = globalThis.AudioWorkletNode;
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: FakeWorkletNode });
	try {
		const canonical = projectWithDialogue(false);
		const playback = createFramescaperPlaybackProjectServiceV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE);
		const preview = playback.projectForPlayback(canonical).project as unknown as EngineProject;
		const delivery = playback.projectForAudioRenderedFallbackDelivery(canonical).project as unknown as EngineProject;
		for (const [name, project] of [['preview', preview], ['audio delivery', delivery]] as const) {
			assert.equal(project.schemaVersion, 27);
			assert.deepEqual(audioTrack(project).effects?.map(({ type }) => type), [
				'highpass', 'gate', 'eq', 'compressor', 'limiter',
			], `${name} keeps the dialogue processor order`);
			const context = new FakeContext();
			await ensureProjectWorklets(context as unknown as BaseAudioContext, project);
			const graph = buildProjectGraph(
				context as unknown as BaseAudioContext,
				context.destination as unknown as AudioNode,
				project,
				{ metering: false, parametricEqWasmModule: getParametricEqWasmModule(
					context as unknown as BaseAudioContext,
				) },
			);
			assertDialoguePath(context);
			const scheduled = scheduleProjectAutomationLanesV21(project, graph.parameterRegistry, {
				fromFrame: 0, toFrame: 48_000, contextStartTime: 1,
				sampleRate: 48_000, contextSampleRate: 48_000,
			});
			assert.deepEqual(scheduled.map(({ laneId }) => laneId), ['dialogue-gain']);
			const gain = graph.trackGainParams.get('audio-track')?.param as unknown as FakeParam;
			assert.ok(gain.calls.some(([kind, value]) => kind === 'linear' && value === 1));
		}
	} finally {
		Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: previous });
	}
});

test('profiled noise reduction retains its exact executable placement in preview and delivery', () => {
	const canonical = projectWithDialogue(true);
	const playback = createFramescaperPlaybackProjectServiceV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE);
	for (const project of [
		playback.projectForPlayback(canonical).project,
		playback.projectForAudioRenderedFallbackDelivery(canonical).project,
	]) {
		const effects = audioTrack(project as unknown as EngineProject).effects ?? [];
		assert.deepEqual(effects.map(({ type }) => type), [
			'highpass', 'audacity-noise-reduction', 'gate', 'eq', 'compressor', 'limiter',
		]);
		const context = effects[1]?.context as Readonly<{
			readonly noiseProfile?: Readonly<{ readonly sampleRate?: unknown }>;
		}> | undefined;
		assert.equal(context?.noiseProfile?.sampleRate, 48_000);
	}
});

test('Framescaper delivery has no default target and applies every explicitly selected loudness target', async () => {
	const canonical = projectWithDialogue(false);
	const playback = createFramescaperPlaybackProjectServiceV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE);
	const delivered = createExportRenderProject(
		playback.projectForAudioRenderedFallbackDelivery(canonical).project,
	);
	const base = { format: 'wav', includeTail: false, date: '2026-08-23' } as const;
	assert.equal(createExportPlan(delivered, base).loudnessNormalization, null);
	for (const [id, target] of Object.entries(LOUDNESS_NORMALIZATION_TARGETS)) {
		const plan = createExportPlan(delivered, { ...base, loudnessNormalization: id });
		assert.deepEqual(plan.loudnessNormalization, target);
	}

	const plan = createExportPlan(delivered, { ...base, loudnessNormalization: 'ebu-r128' });
	const channel = tone(0.02, 4);
	const inputSample = channel[40_000]!;
	let encoded: readonly Float32Array[] = [];
	const result = await encodeRenderedAudio({
		applyMediaChannelMapping: (channels) => channels,
		audioBufferChannels: () => [channel],
		copy: { encoding: 'Encoding' },
		encodeAiff: () => Uint8Array.of(2),
		encodeWav: (channels) => {
			encoded = channels.map((value) => value.slice());
			return Uint8Array.of(1);
		},
		ffmpeg: { encode: async () => ({ bytes: Uint8Array.of(3), mimeType: 'audio/test' }) },
		resampleBuffer: () => { throw new Error('The V27 delivery rate must remain exact.'); },
		setStatus: () => undefined,
		throwIfAborted: (signal) => { if (signal.aborted) throw signal.reason; },
	}, {
		plan: plan as unknown as RenderedAudioEncodingPlan,
		rendered: { sampleRate: 48_000 }, settings: {}, signal: new AbortController().signal,
	});
	assert.deepEqual(result.loudnessNormalization?.target, LOUDNESS_NORMALIZATION_TARGETS['ebu-r128']);
	assert.ok((result.loudnessNormalization?.gainDb ?? 0) > 0);
	assert.notEqual(encoded[0]?.[40_000], inputSample);
});

function projectWithDialogue(profiledNoiseReduction: boolean) {
	const project = createFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, {
		...framescaperV20Options(),
		finishing: { automationLanes: [automationLane()] },
	});
	const chain = createFramescaperDialogueChainV27({
		id: 'dialogue:audio-track', sampleRate: 48_000,
		...(profiledNoiseReduction ? { noiseReduction: { profile: noiseProfile() } } : {}),
	});
	return applyFramescaperProjectCommandV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		project,
		createFramescaperDialogueChainAddCommandV27(
			{ scope: 'track', trackId: 'audio-track' }, chain,
		),
	);
}

function automationLane() {
	return {
		id: 'dialogue-gain',
		address: { kind: 'strip', strip: { kind: 'track', id: 'audio-track' }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [
			{ id: 'start', position: 0, value: 0.5 },
			{ id: 'end', position: 48_000, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	};
}

function audioTrack(project: EngineProject) {
	const track = project.tracks?.find(({ id }) => id === 'audio-track');
	assert.ok(track);
	return track;
}

function assertDialoguePath(context: FakeContext): void {
	const highpass = context.created.find((node) => node.kind.startsWith('biquad:'));
	const gate = context.created.find((node) => workletType(node) === 'gate');
	const equalizer = context.created.find((node) => (
		node.kind === 'worklet:kw-parametric-eq'
		&& (node.options as AudioWorkletNodeOptions | undefined)?.processorOptions?.effectId
			=== 'dialogue:audio-track:eq'
	));
	const compressor = context.created.find((node) => node.kind.startsWith('compressor:'));
	const limiter = context.created.find((node) => workletType(node) === 'limiter');
	assert.ok(highpass && gate && equalizer && compressor && limiter);
	assert.ok(highpass.connections.includes(gate));
	assert.ok(gate.connections.includes(equalizer));
	assert.ok(equalizer.connections.includes(compressor));
	assert.ok(compressor.connections.includes(limiter));
}

function workletType(node: FakeNode & Record<string, unknown>): unknown {
	return (node.options as AudioWorkletNodeOptions | undefined)?.processorOptions?.type;
}

function tone(amplitude: number, seconds: number): Float32Array {
	return Float32Array.from({ length: 48_000 * seconds }, (_unused, frame) => (
		amplitude * Math.sin(2 * Math.PI * 1_000 * frame / 48_000)
	));
}

function noiseProfile() {
	return {
		type: 'audacity-noise-profile', version: 1, sampleRate: 48_000,
		windowSize: 2_048, stepsPerWindow: 4, windowType: 'hann-hann',
		channelCount: 1, windowCount: 8,
		meanPowers: Array.from({ length: 1_025 }, (_unused, index) => (index + 1) / 1_000_000),
	};
}
