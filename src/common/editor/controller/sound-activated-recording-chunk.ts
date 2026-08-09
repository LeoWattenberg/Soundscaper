/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SoundActivatedRecordingGate,
	SoundActivationGateState,
	SoundActivationTransition,
} from './sound-activated-recording-gate.ts';

export interface SoundActivationRecorderChunk {
	readonly frameStart: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

export interface SoundActivationAudioSegment {
	readonly frameStart: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

export interface AbsoluteSoundActivationTransition {
	readonly type: SoundActivationTransition['type'];
	readonly frame: number;
}

export interface FilteredSoundActivationChunk {
	readonly state: SoundActivationGateState;
	readonly segments: readonly SoundActivationAudioSegment[];
	readonly transitions: readonly AbsoluteSoundActivationTransition[];
}

const CHUNK_KEYS = new Set(['frameStart', 'frames', 'channels']);

/**
 * Apply one gate decision to a recorder chunk without changing the recorder's
 * absolute AudioContext coordinates. Returned PCM owns fresh typed arrays.
 */
export function filterSoundActivatedRecordingChunk(
	gate: SoundActivatedRecordingGate,
	value: SoundActivationRecorderChunk,
): FilteredSoundActivationChunk {
	if (!gate || typeof gate !== 'object' || typeof gate.process !== 'function') {
		throw new TypeError('A sound activation gate is required.');
	}
	const chunk = validateSoundActivationRecorderChunk(value);
	const decision = gate.process(chunk.channels);
	const segments = decision.ranges.map(({ startFrame, endFrame }) => Object.freeze({
		frameStart: chunk.frameStart + startFrame,
		frames: endFrame - startFrame,
		channels: Object.freeze(chunk.channels.map((channel) => channel.slice(startFrame, endFrame))),
	}));
	const transitions = decision.transitions.map(({ type, frameOffset }) => Object.freeze({
		type,
		frame: chunk.frameStart + frameOffset,
	}));
	return Object.freeze({
		state: decision.state,
		segments: Object.freeze(segments),
		transitions: Object.freeze(transitions),
	});
}

/** Validate a recorder chunk without changing gate or sequence state. */
export function validateSoundActivationRecorderChunk(
	value: SoundActivationRecorderChunk,
): SoundActivationRecorderChunk {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The sound activation recorder chunk is invalid.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('The sound activation recorder chunk must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== CHUNK_KEYS.size
		|| keys.some((key) => typeof key !== 'string' || !CHUNK_KEYS.has(key))) {
		throw new TypeError('The sound activation recorder chunk contains an unknown field.');
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !('value' in descriptor)) {
			throw new TypeError('Sound activation recorder chunk fields must be enumerable data fields.');
		}
	}
	if (!Number.isSafeInteger(value.frameStart)
		|| value.frameStart < 0
		|| Object.is(value.frameStart, -0)) {
		throw new RangeError('The sound activation chunk start frame is invalid.');
	}
	if (!Number.isSafeInteger(value.frames) || value.frames < 1) {
		throw new RangeError('The sound activation chunk frame count is invalid.');
	}
	if (value.frameStart > Number.MAX_SAFE_INTEGER - value.frames) {
		throw new RangeError('The sound activation chunk range is outside the safe frame domain.');
	}
	if (!Array.isArray(value.channels) || value.channels.length === 0
		|| value.channels.some((channel) => (
			!(channel instanceof Float32Array) || channel.length !== value.frames
		))) {
		throw new RangeError('The sound activation chunk frame count must match every channel.');
	}
	for (const channel of value.channels) {
		for (const sample of channel) {
			if (!Number.isFinite(sample)) {
				throw new RangeError('Sound activation PCM samples must be finite.');
			}
		}
	}
	return value;
}

/**
 * Compact discontiguous admitted ranges into one persistence batch. Absolute
 * source geometry remains on the input segments; returned PCM preserves their
 * exact channel and sample order.
 */
export function compactSoundActivationSegments(
	segments: readonly SoundActivationAudioSegment[],
): readonly Float32Array[] {
	const first = segments[0];
	if (!first) return Object.freeze([]);
	if (segments.length === 1) return first.channels;
	const channelCount = first.channels.length;
	let frameCount = 0;
	for (const segment of segments) {
		if (segment.channels.length !== channelCount || segment.frames < 1) {
			throw new RangeError('Sound activation segments have inconsistent channel geometry.');
		}
		if (frameCount > Number.MAX_SAFE_INTEGER - segment.frames) {
			throw new RangeError('Sound activation compacted PCM exceeds the safe frame domain.');
		}
		frameCount += segment.frames;
		for (const channel of segment.channels) {
			if (!(channel instanceof Float32Array) || channel.length !== segment.frames) {
				throw new RangeError('Sound activation segments have inconsistent frame geometry.');
			}
		}
	}
	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	let offset = 0;
	for (const segment of segments) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			channels[channel]?.set(segment.channels[channel]!, offset);
		}
		offset += segment.frames;
	}
	return Object.freeze(channels);
}
