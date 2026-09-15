/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { applyEffect, effectGraphKey } from '../src/common/editor/engine/effect-rack.ts';
import { ensureProjectWorklets } from '../src/common/editor/engine/effect-worklets.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import {
	createStandardEffectNode,
	ensureStandardEffectWorklet,
	isStandardEffectWorkletLoaded,
} from '../src/common/editor/engine/standard-effect-node.ts';
import type { EngineEffect, EngineProject } from '../src/common/editor/engine/types.ts';
import { audioSelectionEffectDefaults, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import type { StandardEffectType } from '../src/common/editor/first-party-effects/standard/definition.ts';
import { STANDARD_DELAY_MEMORY_LIMIT_BYTES, standardDelayLatencyFrames, standardDelayTailSeconds } from '../src/common/editor/first-party-effects/standard/delay-definition.ts';
import { applyStandardEffect, createStandardEffectProcessor } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import {
	applyAudioSelectionEffectAsync,
	estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes,
} from '../src/common/editor/selection-effects.js';
import { MockAudioBuffer, MockAudioContext, MockNode } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode, MockOfflineAudioContext, createRackProject, incomingConnections } from './helpers/audio-editor-runtime-harness.js';

type Message = Readonly<Record<string, unknown>>;
class ProcessorHost {
	readonly messages: Message[] = [];
	readonly port = {
		onmessage: null as ((event: { data: Message }) => void) | null,
		postMessage: (message: Message): void => { this.messages.push(message); },
	};
}
interface HostedProcessor extends ProcessorHost {
	process(inputs: readonly (readonly Float32Array[])[], outputs: readonly (readonly Float32Array[])[]): boolean;
}
type HostedConstructor = new (options: { processorOptions: {
	type: StandardEffectType; channelCount: number; params?: Readonly<Record<string, unknown>>;
	staffPadWasmModule?: WebAssembly.Module;
} }) => HostedProcessor;

function installGlobal(name: string, value: unknown): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	return () => {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	};
}

const restoreHost = installGlobal('AudioWorkletProcessor', ProcessorHost);
const workletModule = await import('../src/common/editor/first-party-effects/standard/worklet.js');
restoreHost();
const StandardEffectProcessor = workletModule.StandardEffectProcessor as unknown as HostedConstructor;
const SAMPLE_RATE = 48_000;
const EFFECTS: readonly StandardEffectType[] = ['multi-tap-delay', 'highpass-filter', 'lowpass-filter',
	'noise-gate', 'notch-filter', 'shelf-filter', 'tremolo', 'vocoder'];
const CUSTOM_PARAMS: Readonly<Record<StandardEffectType, Readonly<Record<string, unknown>>>> = {
	'multi-tap-delay': { time: .001, echoes: 3, echoGain: -9, mix: .8 },
	'highpass-filter': { frequency: 300, rolloff: 48 },
	'lowpass-filter': { frequency: 1400, rolloff: 36 },
	'noise-gate': { threshold: -18, attack: .001, release: .01, hold: .002, stereoLink: 'independent', gateFrequency: 800 },
	'notch-filter': { frequency: 731, q: 4 },
	'shelf-filter': { frequency: 900, gain: 12, filterType: 'high' },
	tremolo: { frequency: 13, phase: -37, depth: 73, waveform: 'triangle' },
	vocoder: { bands: 16, distance: 32, noiseLevel: 8, radarLevel: 6, radarFrequency: 23, outputGain: -3 },
};

function signal(frames: number): Float32Array[] {
	return [
		Float32Array.from({ length: frames }, (_, frame) => .7 * Math.sin(2 * Math.PI * 731 * frame / SAMPLE_RATE)),
		Float32Array.from({ length: frames }, (_, frame) => .4 * Math.sin(2 * Math.PI * 2371 * frame / SAMPLE_RATE)),
	];
}

async function installStaffPadFetch(): Promise<() => void> {
	const bytes = new Uint8Array(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	return installGlobal('fetch', async (source: RequestInfo | URL): Promise<Response> => {
		assert.match(String(source), /staffpad\/staffpad\.wasm$/);
		return new Response(bytes);
	});
}

function rawRender(type: StandardEffectType, input: readonly Float32Array[], params: Readonly<Record<string, unknown>>): Float32Array[] {
	const processor = createStandardEffectProcessor({ type, sampleRate: SAMPLE_RATE, channelCount: input.length, params });
	const output = input.map((channel) => new Float32Array(channel.length));
	try { processor.processBlock(input, output, input[0].length); }
	finally { processor.dispose?.(); }
	return output;
}

function hostedRender(type: StandardEffectType, input: readonly Float32Array[], params: Readonly<Record<string, unknown>>,
	staffPadWasmModule?: WebAssembly.Module): Float32Array[] {
	const processor = new StandardEffectProcessor({ processorOptions: { type, channelCount: input.length, params, staffPadWasmModule } });
	const output = input.map((channel) => new Float32Array(channel.length));
	for (let offset = 0; offset < input[0].length; offset += 128) {
		const end = Math.min(input[0].length, offset + 128);
		assert.equal(processor.process([input.map((channel) => channel.subarray(offset, end))],
			[output.map((channel) => channel.subarray(offset, end))]), true);
	}
	processor.port.onmessage?.({ data: { type: 'dispose' } });
	assert.deepEqual(processor.messages, []);
	return output;
}

test('all eight actual worklet processors match shared DSP and asynchronous selection processing', async () => {
	const restoreSampleRate = installGlobal('sampleRate', SAMPLE_RATE);
	try {
		const input = signal(3072);
		const untouched = input.map((channel) => channel.slice());
		for (const type of EFFECTS) {
			for (const params of [{}, CUSTOM_PARAMS[type]]) {
				const normalized = normalizeAudioSelectionEffectParams(type, params) as Record<string, unknown>;
				if (Object.keys(params).length === 0) assert.deepEqual(normalized, audioSelectionEffectDefaults(type));
				const expected = applyStandardEffect(type, input, SAMPLE_RATE, normalized);
				assert.deepEqual(hostedRender(type, input, normalized), rawRender(type, input, normalized), `${type}: worklet`);
				assert.deepEqual(await applyAudioSelectionEffectAsync(type, input, SAMPLE_RATE, params), expected, `${type}: selection`);
			}
		}
		assert.deepEqual(input, untouched, 'selection processing never mutates the source PCM');
	} finally { restoreSampleRate(); }
});

test('actual pitched delay worklet receives cloned StaffPad WASM and matches selection after latency compensation', async () => {
	const restoreSampleRate = installGlobal('sampleRate', SAMPLE_RATE);
	const restoreFetch = await installStaffPadFetch();
	try {
		const module = await WebAssembly.compile(new Uint8Array(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url))));
		const input = signal(16384);
		for (const pitchShift of [-1, 1]) {
			const params = { ...CUSTOM_PARAMS['multi-tap-delay'], pitchShift, echoes: 2 };
			const latency = standardDelayLatencyFrames(params, SAMPLE_RATE);
			assert.ok(latency > 0);
			const padded = input.map(channel => {
				const result = new Float32Array(channel.length + latency);
				result.set(channel);
				return result;
			});
			const raw = hostedRender('multi-tap-delay', padded, params, structuredClone(module));
			const compensated = raw.map(channel => channel.slice(latency, latency + input[0].length));
			assert.ok(compensated[0].some(sample => Math.abs(sample) > .01));
			assert.deepEqual(await applyAudioSelectionEffectAsync('multi-tap-delay', input, SAMPLE_RATE, params), compensated);
		}
	} finally { restoreFetch(); restoreSampleRate(); }
});

test('standard selection estimates preserve frame count and account for transfers, output and delay history', () => {
	const frames = 3072;
	for (const type of EFFECTS) {
		const params = CUSTOM_PARAMS[type];
		assert.equal(estimateAudioSelectionEffectOutputFrames(type, frames), frames, `${type}: defaults`);
		assert.equal(estimateAudioSelectionEffectOutputFrames(type, frames, params), frames, `${type}: configured`);
		for (const channelCount of [1, 2, 6, 32]) {
			const inputBytes = frames * channelCount * Float32Array.BYTES_PER_ELEMENT;
			const ringBytes = type === 'multi-tap-delay'
				? (Math.ceil(standardDelayTailSeconds({ ...params, mix: 1 }) * SAMPLE_RATE) + 2) * channelCount * Float32Array.BYTES_PER_ELEMENT : 0;
			const bytes = estimateAudioSelectionEffectPeakBytes(type, frames, params, { sampleRate: SAMPLE_RATE, channelCount });
			assert.ok(bytes >= inputBytes * 3 + ringBytes, `${type}: ${String(channelCount)} channels`);
		}
	}
	const mutedDelay = { ...CUSTOM_PARAMS['multi-tap-delay'], mix: 0 };
	assert.equal(estimateAudioSelectionEffectPeakBytes('multi-tap-delay', frames, mutedDelay),
		estimateAudioSelectionEffectPeakBytes('multi-tap-delay', frames, { ...mutedDelay, mix: 1 }), 'the allocated delay ring is counted at every mix');
});

test('delay estimates reject configurations above the 64 MiB processor limit before PCM allocation', () => {
	assert.equal(STANDARD_DELAY_MEMORY_LIMIT_BYTES, 64 * 1024 ** 2);
	const params = { time: 5, echoes: 30, pitchShift: 0 };
	const frames = 128;
	const fitting = estimateAudioSelectionEffectPeakBytes('multi-tap-delay', frames, params, { sampleRate: SAMPLE_RATE, channelCount: 2 });
	assert.equal(fitting, STANDARD_DELAY_MEMORY_LIMIT_BYTES + frames * 2 * Float32Array.BYTES_PER_ELEMENT * 4 + 2 * 1024 ** 2);
	for (const options of [{ sampleRate: SAMPLE_RATE, channelCount: 3 }, { sampleRate: 384_000, channelCount: 2 }]) {
		assert.throws(() => estimateAudioSelectionEffectPeakBytes('multi-tap-delay', frames, params, options), /processor memory limit/);
	}
});

test('selection peak estimates reject filter cutoffs at the selected audio sample rate Nyquist limit', () => {
	for (const type of ['highpass-filter', 'lowpass-filter', 'notch-filter', 'shelf-filter', 'noise-gate'] as const) {
		const key = type === 'noise-gate' ? 'gateFrequency' : 'frequency';
		for (const cutoff of [4000, 5000]) {
			assert.throws(() => estimateAudioSelectionEffectPeakBytes(type, 128, { [key]: cutoff },
				{ sampleRate: 8000, channelCount: 2 }), /below Nyquist/, type);
		}
		assert.ok(estimateAudioSelectionEffectPeakBytes(type, 128, { [key]: 3999 }, { sampleRate: 8000, channelCount: 2 }) > 0);
	}
});

test('spectral selection estimates include replacement PCM, overlap accumulators and transform scratch', () => {
	const frames = 4096;
	const channelCount = 2;
	const spectralWindowSize = 2048;
	const scratch = frames * channelCount * Float32Array.BYTES_PER_ELEMENT
		+ frames * Float64Array.BYTES_PER_ELEMENT * 2 + spectralWindowSize * Float64Array.BYTES_PER_ELEMENT * 5;
	for (const type of EFFECTS) {
		const params = CUSTOM_PARAMS[type];
		const plain = estimateAudioSelectionEffectPeakBytes(type, frames, params, { sampleRate: SAMPLE_RATE, channelCount });
		const spectral = estimateAudioSelectionEffectPeakBytes(type, frames, params, { sampleRate: SAMPLE_RATE, channelCount, spectralWindowSize });
		assert.ok(spectral >= plain + scratch, type);
		for (const invalid of [16, 1000, 32768]) {
			assert.throws(() => estimateAudioSelectionEffectPeakBytes(type, frames, params, { spectralWindowSize: invalid }), /power of two/);
		}
	}
});

test('worklets continue every effect from an empty input bus using the same state as explicit silence', () => {
	const restoreSampleRate = installGlobal('sampleRate', SAMPLE_RATE);
	try {
		for (const type of EFFECTS) {
			const params = CUSTOM_PARAMS[type];
			const worklet = new StandardEffectProcessor({ processorOptions: { type, channelCount: 2, params } });
			const reference = createStandardEffectProcessor({ type, sampleRate: SAMPLE_RATE, channelCount: 2, params });
			const impulse = [new Float32Array(128), new Float32Array(128)];
			impulse[0][127] = 1;
			impulse[1][127] = .5;
			const output = [new Float32Array(128), new Float32Array(128)];
			worklet.process([impulse], [output]);
			reference.processBlock(impulse, output, 128);
			const tail = [new Float32Array(256), new Float32Array(256)];
			const expected = tail.map(() => new Float32Array(256));
			assert.equal(worklet.process([], [tail]), true);
			reference.processBlock(tail.map(() => new Float32Array(256)), expected, 256);
			assert.deepEqual(tail, expected, type);
			assert.ok(tail.every((channel) => channel.every(Number.isFinite)), type);
			if (type === 'multi-tap-delay') assert.ok(tail[0].some((value) => value !== 0), 'delayed taps survive source disconnection');
			assert.equal(worklet.process([], []), true);
		}
	} finally { restoreSampleRate(); }
});

test('actual worklet configure and reset messages update processing and reject invalid changes atomically', () => {
	const restoreSampleRate = installGlobal('sampleRate', SAMPLE_RATE);
	try {
		for (const type of EFFECTS) {
			const worklet = new StandardEffectProcessor({ processorOptions: { type, channelCount: 2 } });
			const input = signal(512);
			const output = input.map(() => new Float32Array(512));
			worklet.process([input], [output]);
			assert.ok(worklet.port.onmessage);
			const params = normalizeAudioSelectionEffectParams(type, CUSTOM_PARAMS[type]) as Record<string, unknown>;
			worklet.port.onmessage({ data: { type: 'configure', params } });
			worklet.port.onmessage({ data: { type: 'reset' } });
			worklet.process([input], [output]);
			assert.deepEqual(output, rawRender(type, input, params), type);
			const invalid = type === 'multi-tap-delay' ? { echoes: 0 } : type === 'noise-gate' ? { threshold: 1 }
				: type === 'vocoder' ? { bands: 1 } : { frequency: -1 };
			worklet.port.onmessage({ data: { type: 'configure', params: invalid } });
			assert.equal(worklet.messages.length, 1, type);
			assert.equal(worklet.messages[0].type, 'error', type);
			assert.equal(typeof worklet.messages[0].message, 'string');
			worklet.port.onmessage({ data: { type: 'reset' } });
			worklet.process([input], [output]);
			assert.deepEqual(output, rawRender(type, input, params), type);
		}
	} finally { restoreSampleRate(); }
});

test('standard worklet loading shares concurrent work, caches success per context and retries failures', async () => {
	let loads = 0;
	let release!: () => void;
	const loading = new Promise<void>((resolve) => { release = resolve; });
	const context = { audioWorklet: { addModule: async (url: string): Promise<void> => {
		assert.match(url, /first-party-effects\/standard\/worklet\.js$/);
		loads += 1;
		await loading;
	} } } as unknown as BaseAudioContext;
	assert.throws(() => createStandardEffectNode(context, null, 'tremolo', {}, 2), /not loaded/);
	const operations = [ensureStandardEffectWorklet(context), ensureStandardEffectWorklet(context), ensureStandardEffectWorklet(context)];
	assert.equal(loads, 1);
	assert.equal(isStandardEffectWorkletLoaded(context), false);
	release();
	await Promise.all(operations);
	assert.equal(isStandardEffectWorkletLoaded(context), true);
	await ensureStandardEffectWorklet(context);
	assert.equal(loads, 1);
	assert.throws(() => createStandardEffectNode(context, null, 'tremolo', {}, 2), /not loaded/);
	let retries = 0;
	const retryContext = { audioWorklet: { addModule: async (): Promise<void> => {
		retries += 1;
		if (retries === 1) throw new Error('standard module unavailable');
	} } } as unknown as BaseAudioContext;
	await assert.rejects(Promise.all([ensureStandardEffectWorklet(retryContext), ensureStandardEffectWorklet(retryContext)]), /standard module unavailable/);
	assert.equal(retries, 1);
	assert.equal(isStandardEffectWorkletLoaded(retryContext), false);
	await Promise.all([ensureStandardEffectWorklet(retryContext), ensureStandardEffectWorklet(retryContext)]);
	assert.equal(retries, 2);
	assert.equal(isStandardEffectWorkletLoaded(retryContext), true);
});

function scopedProject(scope: 'track' | 'master' | 'group' | 'send', effect: EngineEffect, active = true): EngineProject {
	const owner = { id: `${scope}-1`, effectsActive: active, effects: [effect] };
	if (scope === 'track') return { tracks: [owner] };
	if (scope === 'master') return { master: owner };
	return { mixer: { [scope === 'group' ? 'groups' : 'sends']: [owner] } };
}

test('project preparation detects active standard effects in tracks, master, groups and sends', async () => {
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	try {
		for (const scope of ['track', 'master', 'group', 'send'] as const) {
			const context = new MockAudioContext();
			const audioContext = context as unknown as BaseAudioContext;
			await ensureProjectWorklets(audioContext, scopedProject(scope, { type: 'tremolo', enabled: false }));
			await ensureProjectWorklets(audioContext, scopedProject(scope, { type: 'tremolo', bypassed: true }));
			await ensureProjectWorklets(audioContext, scopedProject(scope, { type: 'tremolo' }, false));
			assert.equal(context.audioWorkletModules.length, 0, `${scope}: inactive racks need no worklet`);
			await ensureProjectWorklets(audioContext, scopedProject(scope, { type: 'tremolo' }));
			await ensureProjectWorklets(audioContext, scopedProject(scope, { type: 'noise-gate' }));
			assert.equal(context.audioWorkletModules.length, 1, scope);
			assert.match(context.audioWorkletModules[0], /first-party-effects\/standard\/worklet\.js$/);
		}
	} finally { restoreNode(); }
});

test('worklet preparation and direct insertion fail closed when support or module loading is unavailable', async () => {
	const context = new MockAudioContext();
	const audioContext = context as unknown as BaseAudioContext;
	const input = new MockNode('input') as unknown as AudioNode;
	assert.throws(() => applyEffect(audioContext, input, { type: 'tremolo', params: {} }, []), /not loaded/);
	const restoreMissing = installGlobal('AudioWorkletNode', undefined);
	try {
		await assert.rejects(ensureProjectWorklets(audioContext, scopedProject('track', { type: 'tremolo' })), /cannot run.*without bypassing/);
	} finally { restoreMissing(); }
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	try {
		context.audioWorklet.addModule = async (): Promise<void> => { throw new Error('standard module rejected'); };
		await assert.rejects(ensureProjectWorklets(audioContext, scopedProject('send', { type: 'vocoder' })), /standard module rejected/);
		assert.equal(isStandardEffectWorkletLoaded(audioContext), false);
		assert.equal(context.workletNodes.length, 0);
		assert.throws(() => applyEffect(audioContext, input, { type: 'vocoder', params: {} }, []), /not loaded/);
	} finally { restoreNode(); }
});

test('prepared effects install the correct connected node with explicit channel geometry and scoped registration', async () => {
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	try {
		const context = new MockAudioContext();
		const audioContext = context as unknown as BaseAudioContext;
		await ensureStandardEffectWorklet(audioContext);
		for (const type of EFFECTS) {
			const input = new MockNode('input');
			const nodes: AudioNode[] = [];
			const effectNodes = new Map<string, AudioNode>();
			const params = normalizeAudioSelectionEffectParams(type, CUSTOM_PARAMS[type]) as Record<string, unknown>;
			const output = applyEffect(audioContext, input as unknown as AudioNode, { id: type, type, params }, nodes,
				{ scope: 'group', targetId: 'group-1', effectChannelCount: 2, effectNodes });
			const node = context.workletNodes.at(-1);
			assert.ok(node);
			assert.equal(output, node);
			assert.equal(node.name, 'kw-standard-effect');
			assert.deepEqual(node.options.outputChannelCount, [2]);
			assert.equal(node.options.channelCountMode, 'explicit');
			assert.equal(node.options.channelInterpretation, 'discrete');
			assert.deepEqual(node.options.processorOptions, { type, params, channelCount: 2 });
			assert.equal(input.connections[0], node);
			assert.deepEqual(nodes, [node]);
			assert.equal(effectNodes.get(effectGraphKey('group', 'group-1', type)), node);
		}
	} finally { restoreNode(); }
});

test('prepared nodes reject invalid cutoffs and excessive delay memory before constructing a worklet', async () => {
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	try {
		const context = new MockAudioContext({ sampleRate: 8000 });
		const audioContext = context as unknown as BaseAudioContext;
		await ensureStandardEffectWorklet(audioContext);
		for (const type of ['highpass-filter', 'lowpass-filter', 'notch-filter', 'shelf-filter', 'noise-gate'] as const) {
			const key = type === 'noise-gate' ? 'gateFrequency' : 'frequency';
			assert.throws(() => createStandardEffectNode(audioContext, MockAudioWorkletNode as unknown as typeof AudioWorkletNode,
				type, { [key]: 4000 }, 2), /below Nyquist/, type);
		}
		assert.equal(context.workletNodes.length, 0);
		const delayContext = new MockAudioContext({ sampleRate: 96_000 });
		const preparedDelay = delayContext as unknown as BaseAudioContext;
		await ensureStandardEffectWorklet(preparedDelay);
		assert.throws(() => createStandardEffectNode(preparedDelay, MockAudioWorkletNode as unknown as typeof AudioWorkletNode,
			'multi-tap-delay', { time: 5, echoes: 30, mix: 0 }, 2), /processor memory limit/);
		assert.equal(delayContext.workletNodes.length, 0);
	} finally { restoreNode(); }
});

test('invalid live cutoffs and excessive delay memory leave messages, revisions and authored parameters unchanged', async () => {
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	const restoreFetch = await installStaffPadFetch();
	try {
		for (const type of ['highpass-filter', 'lowpass-filter', 'notch-filter', 'shelf-filter', 'noise-gate', 'multi-tap-delay'] as const) {
			const context = new MockAudioContext({ sampleRate: type === 'multi-tap-delay' ? 96_000 : 8000 });
			const project = createRackProject({ tracks: [{ id: 'track-1', effects: [{ id: type, type, params: {} }] }] });
			const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as AudioContext, meterInterval: 1000 });
			const runtime = engine as unknown as Pick<EngineRuntimeHost, 'graph' | 'project'>;
			try {
				engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(2, 4800, SAMPLE_RATE) as unknown as AudioBuffer]]));
				await engine.play();
				const valid = type === 'multi-tap-delay' ? { time: .001, echoes: 2 }
					: type === 'noise-gate' ? { gateFrequency: 1200 } : { frequency: 1200 };
				assert.equal(engine.configureRackEffect('track', 'track-1', type, valid), 1);
				const priorProject = runtime.project;
				const node = context.workletNodes[0];
				const priorMessages: unknown = structuredClone(node.messages);
				const invalid = type === 'multi-tap-delay' ? { time: 5, echoes: 30 }
					: type === 'noise-gate' ? { gateFrequency: 4000 } : { frequency: 4000 };
				assert.throws(() => engine.configureRackEffect('track', 'track-1', type, invalid, { revision: 99 }),
					type === 'multi-tap-delay' ? /processor memory limit/ : /below Nyquist/, type);
				assert.deepEqual(node.messages, priorMessages, type);
				assert.equal(runtime.project, priorProject, type);
				assert.equal(runtime.graph?.effectMessageSequences.get(effectGraphKey('track', 'track-1', type)), 1, type);
				assert.equal(engine.configureRackEffect('track', 'track-1', type, valid), 2, 'failed validation consumes no revision');
			} finally { await engine.dispose(); }
		}
	} finally { restoreFetch(); restoreNode(); }
});

test('playback and offline racks install standard effects and live changes deliver complete configure messages', async () => {
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	const restoreFetch = await installStaffPadFetch();
	const context = new MockAudioContext();
	const offlineContexts: MockOfflineAudioContext[] = [];
	const effects = EFFECTS.map((type) => ({ id: type, type, enabled: true, params: audioSelectionEffectDefaults(type) as Record<string, unknown> }));
	const project = createRackProject({ tracks: [{ id: 'track-1', effects }] });
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as unknown as AudioContext,
		offlineAudioContextFactory: (options) => {
			const offline = new MockOfflineAudioContext(options);
			offlineContexts.push(offline);
			return offline as unknown as OfflineAudioContext;
		},
		meterInterval: 1000,
	});
	const runtime = engine as unknown as Pick<EngineRuntimeHost, 'graph' | 'project'>;
	try {
		engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(2, 4800, SAMPLE_RATE) as unknown as AudioBuffer]]));
		await engine.play();
		assert.equal(context.audioWorkletModules.length, 1);
		assert.equal(context.workletNodes.length, EFFECTS.length);
		assert.ok(runtime.graph);
		assert.equal(runtime.graph.effectNodes.size, EFFECTS.length);
		for (const [index, type] of EFFECTS.entries()) {
			const node = context.workletNodes[index];
			assert.equal(node.options.processorOptions.type, type);
			assert.ok(incomingConnections(runtime.graph.nodes, node, 0).length > 0, type);
			assert.ok(node.connectionDetails.length > 0, type);
			assert.equal(engine.configureRackEffect('track', 'track-1', type, CUSTOM_PARAMS[type]), 1);
			const params = normalizeAudioSelectionEffectParams(type, { ...effects[index].params, ...CUSTOM_PARAMS[type] });
			assert.deepEqual(node.messages, [{ type: 'configure', params, revision: 1, sequence: 1 }], type);
			assert.deepEqual(runtime.project?.tracks?.[0].effects?.[index].params, params);
			assert.equal(engine.configureRackEffect('track', 'track-1', type, {}, { revision: 1 }), false, 'stale revisions are ignored');
			assert.equal(node.messages.length, 1);
		}
		assert.equal(engine.configureRackEffect('track', 'track-1', 'missing-effect', {}), false);
		engine.stop();
		await engine.renderMix({ startFrame: 0, endFrame: 1024 });
		assert.equal(offlineContexts.length, 1);
		assert.equal(offlineContexts[0].audioWorkletModules.length, 1);
		assert.deepEqual(offlineContexts[0].workletNodes.map((node) => node.options.processorOptions.type), EFFECTS);
	} finally {
		await engine.dispose();
		restoreFetch();
		restoreNode();
	}
});

test('engine playback rejects a failed standard module before constructing any audible graph', async () => {
	const restoreNode = installGlobal('AudioWorkletNode', MockAudioWorkletNode);
	const context = new MockAudioContext();
	context.audioWorklet.addModule = async (): Promise<void> => { throw new Error('standard module unavailable for playback'); };
	const project = createRackProject({ tracks: [{ id: 'track-1', effects: [{ id: 'tremolo-1', type: 'tremolo', params: {} }] }] });
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as AudioContext, meterInterval: 1000 });
	const runtime = engine as unknown as Pick<EngineRuntimeHost, 'graph'>;
	try {
		engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(2, 4800, SAMPLE_RATE) as unknown as AudioBuffer]]));
		await assert.rejects(engine.play(), /standard module unavailable for playback/);
		assert.equal(runtime.graph, null);
		assert.equal(context.workletNodes.length, 0);
		assert.equal(context.bufferSources.length, 0);
		assert.equal(engine.getState().state, 'stopped');
	} finally {
		await engine.dispose();
		restoreNode();
	}
});
