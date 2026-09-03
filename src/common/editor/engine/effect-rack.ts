/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audacityLiveEffectCapability,
	isAudacityLiveEffect,
} from '../audacity-effects/live-capabilities.js';
import {
	addNode,
	connect,
	setParam,
	type AudioNodeCollection,
} from './audio-node-utils.ts';
import {
	clamp,
	createGateCurve,
	createImpulseResponse,
	DEFAULT_SAMPLE_RATE,
	finite,
	MAX_EFFECT_TAIL_SECONDS,
	nonNegativeInteger,
	positiveInteger,
} from './buffer-math.ts';
import {
	attachDynamicsAnalysisTelemetry,
	releaseDynamicsAnalysisTelemetry,
} from './dynamics-analysis-telemetry.ts';
import {
	getAudacityPffftWasmModule,
	isAudacityWorkletLoaded,
	isDelayWorkletLoaded,
	isDynamicsWorkletLoaded,
	isParametricEqWorkletLoaded,
} from './effect-worklets.ts';
import {
	registerEffectAudioParam,
	registerEffectAudioParamGroup,
} from './effect-parameter-bindings.ts';
import { isParametricEqType } from './project-effects.ts';
import { BITCRUSHER_EFFECT_TYPE, createBitcrusherEffectNode } from './bitcrusher-node.ts';
import type { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import type { EngineEffect, UnknownRecord } from './types.ts';
import { effectSupportsExplicitSidechain } from '../effect-explicit-sidechain-capability.ts';
import {
	createNativePluginEffectNode,
	isNativePluginEffect,
	isNativePluginRealtimeWorkletLoaded,
	nativePluginRuntimeLatencyFrames,
} from '../native-plugin-realtime-node.js';

export const PARAMETRIC_EQ_SPECTRUM_FFT_SIZE = 4_096;
const MAX_DELAY_SECONDS = 5;
const DELAY_WORKLET_NAME = 'kw-audio-delay';
const PARAMETRIC_EQ_WORKLET_NAME = 'kw-parametric-eq';

export interface EffectSpectrumMetadata {
	readonly sampleRate: number;
	readonly fftSize: number;
	readonly frequencyBinCount: number;
	readonly minDecibels: number;
	readonly maxDecibels: number;
}

export interface SpectrumAnalyserNode extends AnalyserNode {
	getFloatFrequencyDomainData?(target: Float32Array): void;
}

export interface EffectAnalyserEntry {
	readonly input: SpectrumAnalyserNode;
	readonly output: SpectrumAnalyserNode;
	readonly metadata: EffectSpectrumMetadata;
}

export interface EffectRackOptions {
	readonly sidechainInputs?: ReadonlyMap<string, AudioNode>;
	readonly sidechainInputByEffectId?: ReadonlyMap<string, AudioNode>;
	readonly baseSidechainDelayFrames?: unknown;
	readonly sidechainDelayFrames?: unknown;
	readonly scope?: string;
	readonly targetId?: unknown;
	readonly effectAnalysis?: boolean;
	readonly effectNodes?: Map<string, AudioNode>;
	readonly effectAnalysers?: Map<string, EffectAnalyserEntry>;
	readonly effectChannelCount?: unknown;
	readonly parametricEqWasmModule?: WebAssembly.Module | null;
	readonly parametricEqChannelCount?: unknown;
	readonly onParametricEqError?: (error: Readonly<UnknownRecord>) => void;
	readonly parameterRegistry?: ScheduledParameterRegistry;
	readonly baseParameterLatencyFrames?: unknown;
	readonly parameterLatencyFrames?: unknown;
}

export interface EffectMessageGraph {
	readonly effectNodes?: ReadonlyMap<string, AudioNode>;
	readonly effectMessageSequences?: Map<string, number>;
}

interface ParametricEqPortRegistration {
	readonly handler: (event: MessageEvent<unknown>) => void;
	readonly processorErrorHandler: () => void;
}

interface ProcessorEventHooks {
	addEventListener?(type: string, listener: () => void): void;
	removeEventListener?(type: string, listener: () => void): void;
	onprocessorerror?: (() => void) | null;
}

const parametricEqPortMessageHandlers = new WeakMap<AudioWorkletNode, ParametricEqPortRegistration>();

export function effectRackLatencyFrames(
	effects: readonly EngineEffect[] | null | undefined,
	sampleRate = DEFAULT_SAMPLE_RATE,
): number {
	return (Array.isArray(effects) ? effects : []).reduce((total, effect) => (
		total + ((!effect || effect.enabled === false || effect.bypassed === true)
			? 0
			: effectLatencyFrames(effect, sampleRate))
	), 0);
}

export function effectLatencyFrames(effect: EngineEffect, sampleRate: number): number {
	if (isNativePluginEffect(effect)) {
		const fallback = nonNegativeInteger(effect.params?.latencyFrames, 0);
		return nativePluginRuntimeLatencyFrames(effect.params?.instanceId, fallback);
	}
	if (effect.type === 'limiter') {
		return Math.max(0, Math.ceil(finite(effect.params?.lookahead, 0) * sampleRate));
	}
	if (!isAudacityLiveEffect(effect.type)) return 0;
	const capability = audacityLiveEffectCapability(effect.type);
	const latency = typeof capability?.latencyFrames === 'function'
		? capability.latencyFrames(sampleRate, effect.params || {})
		: capability?.latencyFrames;
	return Math.max(0, nonNegativeInteger(latency, 0));
}

export function applyEffectRack(
	context: BaseAudioContext,
	input: AudioNode,
	effects: readonly EngineEffect[] | null | undefined,
	nodes: AudioNodeCollection = [],
	options: EffectRackOptions = {},
): AudioNode {
	let output = input;
	let upstreamLatencyFrames = 0;
	for (const effect of Array.isArray(effects) ? effects : []) {
		if (!effect || effect.enabled === false || effect.bypassed === true) continue;
		output = applyEffect(context, output, effect, nodes, {
			...options,
			sidechainDelayFrames: nonNegativeInteger(options.baseSidechainDelayFrames, 0) + upstreamLatencyFrames,
			parameterLatencyFrames: nonNegativeInteger(options.baseParameterLatencyFrames, 0) + upstreamLatencyFrames,
		});
		upstreamLatencyFrames += effectLatencyFrames(effect, context.sampleRate || DEFAULT_SAMPLE_RATE);
	}
	return output;
}

export function applyEffect(
	context: BaseAudioContext,
	input: AudioNode,
	effect: EngineEffect,
	nodes: AudioNodeCollection,
	options: EffectRackOptions = {},
): AudioNode {
	const type = String(effect.type || effect.kind || '').toLowerCase();
	const params = effect.params || effect as UnknownRecord;
	const explicitSidechainInput = typeof effect.id === 'string'
		? options.sidechainInputByEffectId?.get(effect.id) || null
		: null;
	const explicitSidechainCapable = effectSupportsExplicitSidechain(effect);
	const nativePlugin = isNativePluginEffect(effect);
	if (explicitSidechainInput && !explicitSidechainCapable) {
		if (nativePlugin) throw new Error('Native plug-ins do not admit a sidechain in host contract v1.');
		throw new Error(`Effect ${String(effect.id)} does not expose a sidechain input.`);
	}
	if (nativePlugin) {
		if (!isNativePluginRealtimeWorkletLoaded(context)) {
			throw new Error('The native plug-in real-time processor was not loaded.');
		}
		const processor = addNode(nodes, createNativePluginEffectNode(
			context, effect, clamp(positiveInteger(options.effectChannelCount, 2), 1, 32),
		));
		connect(input, processor);
		if (typeof effect.id === 'string') options.effectNodes?.set(effect.id, processor);
		return processor;
	}
	if (isAudacityLiveEffect(type)) {
		if (!isAudacityWorkletLoaded(context)) {
			throw new Error(`The Audacity real-time processor was not loaded for ${type}.`);
		}
		const WorkletNode = audioWorkletNodeConstructor();
		if (!WorkletNode) throw new Error('This browser cannot run Audacity real-time effects.');
		const pffftWasmModule = getAudacityPffftWasmModule(context);
		if (!(pffftWasmModule instanceof WebAssembly.Module)) {
			throw new Error('The PFFFT WASM module was not compiled for the Audacity processor.');
		}
		const sidechain = explicitSidechainCapable;
		const controlTrackId = sidechain ? effect.context?.controlTrackId : null;
		const controlInput = sidechain
			? explicitSidechainInput || options.sidechainInputs?.get(String(controlTrackId))
			: null;
		if (sidechain && (!controlInput || (!explicitSidechainInput && !controlTrackId))) {
			throw new Error('Auto Duck requires a valid control track.');
		}
		const processor = addNode(nodes, new WorkletNode(context, 'kw-audacity-live-effect', {
			numberOfInputs: sidechain ? 2 : 1,
			numberOfOutputs: 1,
			outputChannelCount: [clamp(positiveInteger(options.effectChannelCount, 2), 1, 32)],
			processorOptions: {
				effectType: type,
				params,
				noiseProfile: effect.context?.noiseProfile || null,
				pffftWasmModule,
			},
		}));
		connect(input, processor);
		if (sidechain && controlInput) {
			const delayFrames = explicitSidechainInput
				? 0
				: nonNegativeInteger(options.sidechainDelayFrames, 0);
			if (delayFrames > 0) {
				if (typeof context.createDelay !== 'function') {
					throw new Error('This browser cannot align the Auto Duck control track.');
				}
				const delaySeconds = delayFrames / (context.sampleRate || DEFAULT_SAMPLE_RATE);
				const delay = addNode(nodes, context.createDelay(Math.max(1, delaySeconds)));
				setParam(delay.delayTime, delaySeconds, context.currentTime);
				connect(controlInput, delay);
				connect(delay, processor, 0, 1);
			} else connect(controlInput, processor, 0, 1);
		}
		registerEffectNode(effect, processor, options);
		attachDynamicsAnalysisTelemetry(processor);
		return processor;
	}
	if (type === BITCRUSHER_EFFECT_TYPE) {
		const width = clamp(positiveInteger(options.effectChannelCount, 2), 1, 32);
		const processor = addNode(nodes, createBitcrusherEffectNode(context, audioWorkletNodeConstructor(), params, width));
		connect(input, processor);
		registerEffectNode(effect, processor, options);
		return processor;
	}
	if ((type === 'limiter' || type === 'gate') && explicitSidechainCapable
		&& isDynamicsWorkletLoaded(context)) {
		const WorkletNode = audioWorkletNodeConstructor();
		if (WorkletNode) {
			const dynamics = addNode(nodes, new WorkletNode(context, 'kw-audio-dynamics', {
				numberOfInputs: explicitSidechainInput ? 2 : 1,
				numberOfOutputs: 1,
				outputChannelCount: [clamp(positiveInteger(options.effectChannelCount, 2), 1, 32)],
				processorOptions: { type, params },
			}));
			connect(input, dynamics);
			if (explicitSidechainInput) connect(explicitSidechainInput, dynamics, 0, 1);
			return dynamics;
		}
	}
	if (explicitSidechainInput) {
		throw new Error(`Effect ${String(effect.id)} cannot consume its authored sidechain in this runtime.`);
	}
	if (isParametricEqType(type)) {
		if (!isParametricEqWorkletLoaded(context)) throw new Error('The parametric EQ processor was not loaded.');
		const WorkletNode = audioWorkletNodeConstructor();
		if (!WorkletNode) throw new Error('This browser cannot run the parametric EQ.');
		if (!(options.parametricEqWasmModule instanceof WebAssembly.Module)) {
			throw new Error('The parametric EQ WASM module was not compiled.');
		}
		const inputAnalyser = options.effectAnalysis ? createSpectrumAnalyser(context, nodes) : null;
		const processorInput = inputAnalyser || input;
		if (inputAnalyser) connect(input, inputAnalyser);
		const processor = addNode(nodes, new WorkletNode(context, PARAMETRIC_EQ_WORKLET_NAME, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			channelCountMode: 'max',
			channelInterpretation: 'speakers',
			processorOptions: {
				sampleRate: context.sampleRate || DEFAULT_SAMPLE_RATE,
				effectId: effect.id,
				params,
				wasmModule: options.parametricEqWasmModule,
				channelCount: clamp(positiveInteger(options.parametricEqChannelCount, 2), 1, 32),
			},
		}));
		connect(processorInput, processor);
		const outputAnalyser = options.effectAnalysis ? createSpectrumAnalyser(context, nodes) : null;
		if (outputAnalyser) connect(processor, outputAnalyser);
		registerEffectGraphNodes(context, effect, processor, inputAnalyser, outputAnalyser, options);
		return outputAnalyser || processor;
	}
	if (['highpass', 'lowpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf'].includes(type)) {
		return connectBiquad(context, input, effect, { ...params, type }, nodes, options);
	}
	if (type === 'compressor' || type === 'limiter') {
		if (typeof context.createDynamicsCompressor !== 'function') return input;
		const compressor = addNode(nodes, context.createDynamicsCompressor());
		setParam(compressor.threshold, finite(params.threshold ?? params.ceiling, type === 'limiter' ? -1 : -24), context.currentTime);
		setParam(compressor.knee, finite(params.knee, type === 'limiter' ? 0 : 30), context.currentTime);
		setParam(compressor.ratio, finite(params.ratio, type === 'limiter' ? 20 : 4), context.currentTime);
		setParam(compressor.attack, finite(params.attack, type === 'limiter' ? 0.003 : 0.01), context.currentTime);
		setParam(compressor.release, finite(params.release, type === 'limiter' ? 0.1 : 0.25), context.currentTime);
		registerEffectAudioParam(
			effect, type === 'limiter' ? 'ceiling' : 'threshold', compressor.threshold, options,
		);
		registerEffectAudioParam(effect, 'knee', compressor.knee, options);
		registerEffectAudioParam(effect, 'ratio', compressor.ratio, options);
		registerEffectAudioParam(effect, 'attack', compressor.attack, options);
		registerEffectAudioParam(effect, 'release', compressor.release, options);
		connect(input, compressor);
		if (type === 'compressor' && finite(params.makeupGain, 0) !== 0) {
			const makeup = addNode(nodes, context.createGain());
			setParam(makeup.gain, 10 ** (finite(params.makeupGain, 0) / 20), context.currentTime);
			connect(compressor, makeup);
			return makeup;
		}
		return compressor;
	}
	if (type === 'gate') {
		if (typeof context.createWaveShaper !== 'function') return input;
		const shaper = addNode(nodes, context.createWaveShaper());
		shaper.curve = createGateCurve(finite(params.threshold, -48));
		shaper.oversample = 'none';
		connect(input, shaper);
		return shaper;
	}
	if (type === 'delay') return connectDelay(context, input, effect, params, nodes, options);
	if (type === 'reverb' || type === 'convolver') return connectReverb(context, input, params, nodes);
	return input;
}

function registerEffectGraphNodes(
	context: BaseAudioContext,
	effect: EngineEffect,
	processor: AudioWorkletNode,
	inputAnalyser: SpectrumAnalyserNode | null,
	outputAnalyser: SpectrumAnalyserNode | null,
	options: EffectRackOptions,
): void {
	if (typeof options.onParametricEqError === 'function' && processor.port) {
		const scope = typeof options.scope === 'string' ? options.scope : null;
		const targetId = scope === 'master' || options.targetId == null ? null : String(options.targetId);
		const effectId = typeof effect?.id === 'string' && effect.id ? effect.id : null;
		const handler = ({ data }: MessageEvent<unknown>): void => {
			if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'error') return;
			const details = data as UnknownRecord;
			const message = typeof details.message === 'string' && details.message
				? details.message
				: 'The parametric EQ processor failed.';
			options.onParametricEqError?.(Object.freeze({
				...details,
				type: 'error',
				message,
				scope,
				targetId,
				effectId,
			}));
		};
		const processorErrorHandler = (): void => handler(new MessageEvent('message', {
			data: { type: 'error', message: 'The parametric EQ AudioWorklet processor failed.' },
		}));
		processor.port.onmessage = handler;
		processor.port.start?.();
		const hooks = processor as unknown as ProcessorEventHooks;
		if (typeof hooks.addEventListener === 'function') {
			hooks.addEventListener('processorerror', processorErrorHandler);
		} else hooks.onprocessorerror = processorErrorHandler;
		parametricEqPortMessageHandlers.set(processor, { handler, processorErrorHandler });
	}
	const key = registerEffectNode(effect, processor, options);
	if (!key || !options.effectAnalysers || !inputAnalyser || !outputAnalyser) return;
	options.effectAnalysers.set(key, {
		input: inputAnalyser,
		output: outputAnalyser,
		metadata: Object.freeze({
			sampleRate: positiveInteger(context.sampleRate, DEFAULT_SAMPLE_RATE),
			fftSize: inputAnalyser.fftSize,
			frequencyBinCount: inputAnalyser.frequencyBinCount || inputAnalyser.fftSize / 2,
			minDecibels: inputAnalyser.minDecibels,
			maxDecibels: inputAnalyser.maxDecibels,
		}),
	});
}

function connectBiquad(
	context: BaseAudioContext,
	input: AudioNode,
	effect: EngineEffect,
	params: UnknownRecord,
	nodes: AudioNodeCollection,
	options: EffectRackOptions,
): AudioNode {
	if (typeof context.createBiquadFilter !== 'function') return input;
	const filter = addNode(nodes, context.createBiquadFilter());
	filter.type = (typeof params.type === 'string' ? params.type : 'peaking') as BiquadFilterType;
	setParam(filter.frequency, clamp(finite(params.frequency, 1_000), 10, 24_000), context.currentTime);
	setParam(filter.Q, Math.max(0.0001, finite(params.q ?? params.Q, 0.707)), context.currentTime);
	setParam(filter.gain, finite(params.gain, 0), context.currentTime);
	registerEffectAudioParam(effect, 'frequency', filter.frequency, options);
	registerEffectAudioParam(effect, 'q', filter.Q, options);
	registerEffectAudioParam(effect, 'gain', filter.gain, options);
	connect(input, filter);
	return filter;
}

function connectDelay(
	context: BaseAudioContext,
	input: AudioNode,
	effect: EngineEffect,
	params: UnknownRecord,
	nodes: AudioNodeCollection,
	options: EffectRackOptions = {},
): AudioNode {
	const mix = clamp(finite(params.mix, 0.25), 0, 1);
	if (mix <= 0) return input;
	const WorkletNode = audioWorkletNodeConstructor();
	if (isDelayWorkletLoaded(context) && WorkletNode) {
		const delay = addNode(nodes, new WorkletNode(context, DELAY_WORKLET_NAME, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [clamp(positiveInteger(options.effectChannelCount, 2), 1, 32)],
			channelCountMode: 'max',
			channelInterpretation: 'speakers',
			processorOptions: {
				sampleRate: context.sampleRate || DEFAULT_SAMPLE_RATE,
				maximumSeconds: MAX_DELAY_SECONDS,
				params,
			},
		}));
		connect(input, delay);
		registerEffectNode(effect, delay, options);
		return delay;
	}
	if (typeof context.createDelay !== 'function') return input;
	const output = addNode(nodes, context.createGain());
	const dry = addNode(nodes, context.createGain());
	const wet = addNode(nodes, context.createGain());
	const delay = addNode(nodes, context.createDelay(MAX_DELAY_SECONDS));
	const feedback = addNode(nodes, context.createGain());
	setParam(dry.gain, 1 - mix, context.currentTime);
	setParam(wet.gain, mix, context.currentTime);
	setParam(delay.delayTime, clamp(finite(params.time ?? params.delayTime, 0.25), 0, MAX_DELAY_SECONDS), context.currentTime);
	setParam(feedback.gain, clamp(finite(params.feedback, 0.25), 0, 0.95), context.currentTime);
	registerEffectAudioParam(effect, 'time', delay.delayTime, options);
	registerEffectAudioParam(effect, 'feedback', feedback.gain, options);
	registerEffectAudioParamGroup(effect, 'mix', [
		{ param: dry.gain, transformValue: (value) => 1 - value },
		{ param: wet.gain },
	], options);
	connect(input, dry); connect(dry, output);
	connect(input, delay); connect(delay, wet); connect(wet, output);
	connect(delay, feedback); connect(feedback, delay);
	return output;
}

function registerEffectNode(
	effect: EngineEffect,
	processor: AudioNode,
	options: EffectRackOptions,
): string | null {
	if (!options.effectNodes || typeof effect?.id !== 'string' || !effect.id) return null;
	const key = effectGraphKey(options.scope, options.targetId, effect.id);
	options.effectNodes.set(key, processor);
	return key;
}

function connectReverb(
	context: BaseAudioContext,
	input: AudioNode,
	params: UnknownRecord,
	nodes: AudioNodeCollection,
): AudioNode {
	const mix = clamp(finite(params.mix, 0.25), 0, 1);
	if (mix <= 0 || typeof context.createConvolver !== 'function') return input;
	const output = addNode(nodes, context.createGain());
	const dry = addNode(nodes, context.createGain());
	const wet = addNode(nodes, context.createGain());
	const convolver = addNode(nodes, context.createConvolver());
	setParam(dry.gain, 1 - mix, context.currentTime);
	setParam(wet.gain, mix, context.currentTime);
	const duration = clamp(finite(params.duration ?? params.decay, 1.5), 0.05, MAX_EFFECT_TAIL_SECONDS);
	const preDelaySeconds = clamp(finite(params.preDelay, 0), 0, 1);
	convolver.buffer = createImpulseResponse(context, duration, 2);
	connect(input, dry); connect(dry, output);
	if (preDelaySeconds > 0 && typeof context.createDelay === 'function') {
		const preDelay = addNode(nodes, context.createDelay(1));
		setParam(preDelay.delayTime, preDelaySeconds, context.currentTime);
		connect(input, preDelay); connect(preDelay, convolver);
	} else connect(input, convolver);
	connect(convolver, wet); connect(wet, output);
	return output;
}

export function createAnalyser(
	context: BaseAudioContext,
	nodes: AudioNodeCollection,
): AnalyserNode | null {
	if (typeof context.createAnalyser !== 'function') return null;
	const analyser = addNode(nodes, context.createAnalyser());
	analyser.fftSize = 256;
	analyser.smoothingTimeConstant = 0.4;
	return analyser;
}

function createSpectrumAnalyser(
	context: BaseAudioContext,
	nodes: AudioNodeCollection,
): SpectrumAnalyserNode | null {
	if (typeof context.createAnalyser !== 'function') return null;
	const analyser = addNode(nodes, context.createAnalyser());
	analyser.fftSize = PARAMETRIC_EQ_SPECTRUM_FFT_SIZE;
	analyser.smoothingTimeConstant = 0.75;
	analyser.minDecibels = -120;
	analyser.maxDecibels = 0;
	return analyser as SpectrumAnalyserNode;
}

export function readParametricEqSpectrumEntry(
	entry: EffectAnalyserEntry | null | undefined,
	which: unknown,
	target: Float32Array,
): EffectSpectrumMetadata | null {
	if (!(target instanceof Float32Array)) throw new TypeError('A Float32Array spectrum target is required.');
	if (which !== 'input' && which !== 'output') {
		throw new RangeError('Parametric EQ spectrum source must be input or output.');
	}
	const analyser = entry?.[which];
	if (!entry || !analyser?.getFloatFrequencyDomainData) {
		target.fill(Number.NEGATIVE_INFINITY);
		return null;
	}
	if (target.length !== entry.metadata.frequencyBinCount) {
		throw new RangeError(`Parametric EQ spectrum buffers must contain ${entry.metadata.frequencyBinCount} bins.`);
	}
	analyser.getFloatFrequencyDomainData(target);
	return entry.metadata;
}

export function postEffectMessage(
	graph: EffectMessageGraph | null | undefined,
	scope: unknown,
	targetId: unknown,
	effectId: unknown,
	message: UnknownRecord,
	requestedSequence?: unknown,
): number | false {
	const key = effectGraphKey(scope, targetId, effectId);
	const node = graph?.effectNodes?.get(key) as AudioWorkletNode | undefined;
	if (!node?.port?.postMessage) return false;
	const currentSequence = graph?.effectMessageSequences?.get(key) || 0;
	const sequence = requestedSequence == null
		? currentSequence + 1
		: safeMessageSequence(requestedSequence, 'revision');
	if (sequence <= currentSequence) return false;
	node.port.postMessage({ ...message, revision: sequence, sequence });
	graph?.effectMessageSequences?.set(key, sequence);
	return sequence;
}

export function effectGraphKey(scope: unknown, targetId: unknown, effectId: unknown): string {
	const normalizedScope = String(scope || '');
	if (!['track', 'master', 'group', 'send'].includes(normalizedScope)) {
		throw new RangeError(`Unsupported effect scope: ${normalizedScope || '(empty)'}.`);
	}
	if (typeof effectId !== 'string' || !effectId) throw new TypeError('A stable effect ID is required.');
	let normalizedTargetId = 'master';
	if (normalizedScope !== 'master') {
		if (targetId == null || String(targetId) === '') {
			throw new TypeError(`A ${normalizedScope} effect target ID is required.`);
		}
		normalizedTargetId = String(targetId);
	}
	return JSON.stringify([normalizedScope, normalizedTargetId, effectId]);
}

export function safeMessageSequence(value: unknown, name: string): number {
	const sequence = Number(value);
	if (!Number.isSafeInteger(sequence) || sequence < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return sequence;
}

export function disposeEffectNodeBindings(node: AudioNode): void {
	const worklet = node as AudioWorkletNode;
	releaseDynamicsAnalysisTelemetry(worklet);
	const registration = parametricEqPortMessageHandlers.get(worklet);
	if (registration?.handler && worklet.port?.onmessage === registration.handler) worklet.port.onmessage = null;
	if (registration?.processorErrorHandler) {
		const hooks = worklet as unknown as ProcessorEventHooks;
		if (typeof hooks.removeEventListener === 'function') {
			hooks.removeEventListener('processorerror', registration.processorErrorHandler);
		} else if (hooks.onprocessorerror === registration.processorErrorHandler) hooks.onprocessorerror = null;
	}
	if (registration) parametricEqPortMessageHandlers.delete(worklet);
}

function audioWorkletNodeConstructor(): typeof AudioWorkletNode | null {
	return typeof globalThis.AudioWorkletNode === 'function' ? globalThis.AudioWorkletNode : null;
}
