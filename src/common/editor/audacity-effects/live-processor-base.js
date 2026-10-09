/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * What every live Audacity effect processor has in common: the parameter and
 * block contract a realtime insert is held to, the delay line the lookahead
 * processors read through, and the shelving biquad the tone controls share.
 * Split out of live.js; no behaviour changes here.
 */

import { normalizeAudacityEffectParams } from './manifest.js';
import { canRetainAdditionalAudacityState } from './live-update-geometry.ts';
export {
	audacityShelfCoefficients as shelfCoefficients,
	processAudacityShelfSample as processShelf,
} from './audacity-bass-treble-kernel.ts';
import {
	audacityLiveEffectCapability,
	audacityLiveEffectLatencyFrames as liveLatencyFrames,
	audacityLiveEffectTailFrames as liveTailFrames,
	validateLiveParamRanges,
} from './live-capabilities.js';

export class LiveProcessor {
	constructor(type, sampleRate, params) {
		this.type = type;
		this.sampleRate = sampleRate;
		this.params = params;
		this.latencyFrames = liveLatencyFrames(type, sampleRate, params);
		this.tailFrames = liveTailFrames(type, sampleRate, params);
	}

	updateParams(params = {}) {
		const normalized = normalizeAudacityEffectParams(this.type, {
			...this.params,
			...params,
		});
		validateLiveParamRanges(audacityLiveEffectCapability(this.type), normalized);
		const previous = this.params;
		const latencyFrames = this.latencyFrames;
		this.params = normalized;
		this.latencyFrames = liveLatencyFrames(this.type, this.sampleRate, this.params);
		this.tailFrames = liveTailFrames(this.type, this.sampleRate, this.params);
		this.configure();
		if (this.latencyFrames !== latencyFrames || !canRetainAdditionalAudacityState(this.type, previous, normalized)) this.reset();
	}

	setNoiseProfile() {
		throw new RangeError(`${this.type} does not use a noise profile.`);
	}

	configure() {}
	reset() {}

	/** Live telemetry for effects that can report what they are doing; null otherwise. */
	readAnalysis() { return null; }
}

export class SampleQueue {
	constructor() { this.chunks = []; this.head = 0; this.offset = 0; this.remaining = 0; }
	push(values) {
		// Each producer reuses its DSP scratch. Copy now, retain unboxed PCM,
		// and release each consumed chunk rather than compacting audio samples.
		const owned = values instanceof Float32Array || values instanceof Float64Array ? values.slice() : Array.from(values);
		if (owned.length === 0) return;
		this.chunks.push(owned);
		this.remaining += owned.length;
	}
	shift(fallback = 0) {
		if (this.remaining === 0) return fallback;
		const chunk = this.chunks[this.head];
		const value = chunk[this.offset++];
		this.remaining--;
		if (this.offset === chunk.length) {
			this.chunks[this.head++] = null;
			this.offset = 0;
			if (this.remaining === 0) { this.chunks = []; this.head = 0; }
			else if (this.head >= 32 && this.head * 2 >= this.chunks.length) {
				this.chunks = this.chunks.slice(this.head);
				this.head = 0;
			}
		}
		return value;
	}
	get length() { return this.remaining; }
}

export function copyBlock(input, output, frames) {
	for (let channel = 0; channel < output.length; channel += 1) {
		const source = channelAt(input, channel);
		if (source) output[channel].set(source);
		else output[channel].fill(0, 0, frames);
	}
}

export function channelAt(channels, index) {
	return channels.length ? channels[Math.min(index, channels.length - 1)] : null;
}


export function validateBlock(input, output) {
	if (!Array.isArray(input) || !Array.isArray(output) || output.length === 0) throw new TypeError('Input and output channel arrays are required.');
	const frames = output[0]?.length;
	if (!Number.isInteger(frames) || frames < 0) throw new TypeError('Output channels must be typed arrays.');
	for (const channel of output) if (!(channel instanceof Float32Array) || channel.length !== frames) throw new RangeError('Output channels must be equal-length Float32Array values.');
	for (const channel of input) if (!(channel instanceof Float32Array) || channel.length !== frames) throw new RangeError('Input channels must match the output block length.');
	return frames;
}

export function ensureArrayLength(array, length, factory) {
	while (array.length < length) array.push(factory(array.length));
	if (array.length > length) array.length = length;
}

export function dbToLinear(db) { return Math.exp(Math.log(10) * db / 20); }
export function basicDbToLinear(db) { return 10 ** (db / 20); }
