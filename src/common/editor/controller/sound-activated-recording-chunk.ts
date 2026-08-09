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
	const chunk = validateChunk(value);
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

function validateChunk(value: SoundActivationRecorderChunk): SoundActivationRecorderChunk {
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
	return value;
}
