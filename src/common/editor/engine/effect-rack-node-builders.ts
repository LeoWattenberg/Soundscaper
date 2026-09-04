/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addNode,
	connect,
	setParam,
	type AudioNodeCollection,
} from './audio-node-utils.ts';
import {
	clamp,
	createImpulseResponse,
	DEFAULT_SAMPLE_RATE,
	finite,
	MAX_EFFECT_TAIL_SECONDS,
	positiveInteger,
} from './buffer-math.ts';
import {
	isDelayWorkletLoaded,
} from './effect-worklets.ts';
import {
	registerEffectAudioParam,
	registerEffectAudioParamGroup,
} from './effect-parameter-bindings.ts';
import type { EngineEffect, UnknownRecord } from './types.ts';
import type { EffectRackOptions } from './effect-rack.ts';
import { audioWorkletNodeConstructor, registerEffectNode } from './effect-rack-node-registry.ts';

const MAX_DELAY_SECONDS = 5;
const DELAY_WORKLET_NAME = 'kw-audio-delay';

/**
 * The Web Audio graphs behind the effects the platform provides natively.
 *
 * Filtering, delay and reverb are the three the browser already implements, so each is
 * built from stock nodes rather than a worklet — and each clamps its parameters at
 * construction, because a Web Audio node given an out-of-range value does not refuse it,
 * it produces silence or a NaN that poisons everything downstream of it.
 */

export function connectBiquad(
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

export function connectDelay(
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

export function connectReverb(
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
