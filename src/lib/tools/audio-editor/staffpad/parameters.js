/*
 * Browser adaptation of Audacity's StaffPad time-and-pitch parameter model.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const STAFFPAD_AUDACITY_REVISION = '908ad0a526e5bfdab68de780e893cebe172d27eb';
export const STAFFPAD_PFFFT_REVISION = '09796885cd5b';
export const STAFFPAD_WASM_ABI_VERSION = 1;
export const STAFFPAD_ALGORITHM_ID = 'audacity-staffpad-time-and-pitch';
export const STAFFPAD_ALGORITHM_VERSION = `${STAFFPAD_AUDACITY_REVISION}:${STAFFPAD_PFFFT_REVISION}:scalar-wasm-abi${STAFFPAD_WASM_ABI_VERSION}`;
export const STAFFPAD_MINIMUM_RATIO = 0.5;
export const STAFFPAD_MAXIMUM_RATIO = 2;
export const STAFFPAD_MINIMUM_PITCH_CENTS = -1200;
export const STAFFPAD_MAXIMUM_PITCH_CENTS = 1200;
export const STAFFPAD_MAXIMUM_RENDER_BYTES = 512 * 1024 ** 2;

const MAXIMUM_KEYFRAMES = 1024;

export function pitchCentsToRatio(cents) {
	const normalized = finiteRange(
		cents,
		STAFFPAD_MINIMUM_PITCH_CENTS,
		STAFFPAD_MAXIMUM_PITCH_CENTS,
		'pitchCents',
	);
	return 2 ** (normalized / 1200);
}

export function pitchRatioToCents(ratio) {
	return 1200 * Math.log2(ratioValue(ratio, 'pitchRatio'));
}

export function createStaffPadChangePitchTransform(options = {}) {
	return normalizeStaffPadTransform({
		tempoRatio: 1,
		pitchRatio: pitchCentsToRatio(options.cents ?? 0),
		preserveFormants: options.preserveFormants ?? true,
	});
}

export function createStaffPadChangeTempoTransform(options = {}) {
	const percent = finiteRange(options.percent ?? 0, -50, 100, 'tempoPercent');
	return normalizeStaffPadTransform({
		tempoRatio: 1 + percent / 100,
		pitchRatio: 1,
		preserveFormants: false,
	});
}

export function createStaffPadChangeSpeedTransform(options = {}) {
	const rate = ratioValue(options.rate ?? 1, 'speedRate');
	return normalizeStaffPadTransform({
		tempoRatio: rate,
		pitchRatio: rate,
		preserveFormants: false,
	});
}

export function createStaffPadSlidingStretchTransform(options = {}) {
	const startTempoPercent = finiteRange(options.startTempoPercent ?? 0, -50, 100, 'startTempoPercent');
	const endTempoPercent = finiteRange(options.endTempoPercent ?? 0, -50, 100, 'endTempoPercent');
	return normalizeStaffPadTransform({
		preserveFormants: options.preserveFormants ?? true,
		keyframes: [
			{
				position: 0,
				tempoRatio: 1 + startTempoPercent / 100,
				pitchRatio: pitchCentsToRatio(options.startPitchCents ?? 0),
			},
			{
				position: 1,
				tempoRatio: 1 + endTempoPercent / 100,
				pitchRatio: pitchCentsToRatio(options.endPitchCents ?? 0),
			},
		],
	});
}

/**
 * Tempo is expressed as source-time per output-time. StaffPad receives its
 * reciprocal as `timeRatio`; keeping tempo linear here reproduces Sliding
 * Stretch's output/input duration of 2 / (startTempo + endTempo).
 */
export function normalizeStaffPadTransform(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('StaffPad transform must be an object.');
	}
	const preserveFormants = booleanValue(value.preserveFormants ?? true, 'preserveFormants');
	let keyframes;
	if (value.keyframes == null) {
		const tempoRatio = constantTempoRatio(value);
		const pitchRatio = ratioValue(value.pitchRatio ?? 1, 'pitchRatio');
		keyframes = [
			{ position: 0, tempoRatio, pitchRatio },
			{ position: 1, tempoRatio, pitchRatio },
		];
	} else {
		if (!Array.isArray(value.keyframes) || value.keyframes.length < 2 || value.keyframes.length > MAXIMUM_KEYFRAMES) {
			throw new RangeError(`StaffPad keyframes must contain between 2 and ${MAXIMUM_KEYFRAMES} entries.`);
		}
		keyframes = value.keyframes.map((keyframe, index) => normalizeKeyframe(keyframe, index));
		if (keyframes[0].position !== 0 || keyframes.at(-1).position !== 1) {
			throw new RangeError('StaffPad keyframes must begin at position 0 and end at position 1.');
		}
		for (let index = 1; index < keyframes.length; index += 1) {
			if (keyframes[index].position <= keyframes[index - 1].position) {
				throw new RangeError('StaffPad keyframe positions must be strictly increasing.');
			}
		}
	}
	return {
		preserveFormants,
		keyframes,
		durationRatio: durationRatioForKeyframes(keyframes),
	};
}

export function evaluateStaffPadTransform(transform, position) {
	const normalized = normalizeStaffPadTransform(transform);
	const clamped = Math.max(0, Math.min(1, finiteNumber(position, 'position')));
	let rightIndex = 1;
	while (rightIndex < normalized.keyframes.length - 1
		&& normalized.keyframes[rightIndex].position < clamped) {
		rightIndex += 1;
	}
	const left = normalized.keyframes[rightIndex - 1];
	const right = normalized.keyframes[rightIndex];
	const extent = right.position - left.position;
	const amount = extent === 0 ? 0 : (clamped - left.position) / extent;
	const tempoRatio = left.tempoRatio + (right.tempoRatio - left.tempoRatio) * amount;
	const pitchRatio = left.pitchRatio + (right.pitchRatio - left.pitchRatio) * amount;
	return { timeRatio: 1 / tempoRatio, pitchRatio };
}

export function staffPadTransformOutputFrames(inputFrames, transform) {
	const frames = positiveSafeInteger(inputFrames, 'inputFrames');
	const normalized = normalizeStaffPadTransform(transform);
	const outputFrames = Math.max(1, Math.round(frames * normalized.durationRatio));
	return positiveSafeInteger(outputFrames, 'outputFrames');
}

export function isStaffPadPassThrough(transform) {
	const normalized = normalizeStaffPadTransform(transform);
	return normalized.keyframes.every((keyframe) => keyframe.tempoRatio === 1 && keyframe.pitchRatio === 1);
}

export function normalizeStaffPadRenderRequest(request) {
	if (!request || typeof request !== 'object' || Array.isArray(request)) {
		throw new TypeError('StaffPad render request must be an object.');
	}
	const channels = normalizeChannels(request.channels);
	const sampleRate = integerRange(request.sampleRate, 8000, 192000, 'sampleRate');
	const selection = normalizeSelection(request.selection, channels[0].length);
	const transform = normalizeStaffPadTransform(request.transform);
	const calculatedOutputFrames = staffPadTransformOutputFrames(selection.frameCount, transform);
	const outputFrames = request.outputFrames == null
		? calculatedOutputFrames
		: positiveSafeInteger(request.outputFrames, 'outputFrames');
	if (outputFrames !== calculatedOutputFrames) {
		throw new RangeError(`outputFrames must equal the StaffPad transform length (${calculatedOutputFrames}).`);
	}
	const renderBytes = outputFrames * channels.length * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(renderBytes) || renderBytes > STAFFPAD_MAXIMUM_RENDER_BYTES) {
		throw new RangeError(`StaffPad output must not exceed ${STAFFPAD_MAXIMUM_RENDER_BYTES} bytes.`);
	}
	const chunkFrames = request.chunkFrames == null
		? 16_384
		: integerRange(request.chunkFrames, 1024, 65_536, 'chunkFrames');
	return {
		channels,
		sampleRate,
		selection,
		transform,
		outputFrames,
		chunkFrames,
	};
}

export function createStaffPadCacheDescriptor(request, source) {
	const normalized = normalizeStaffPadRenderRequest(request);
	if (source == null) throw new TypeError('source is required for a StaffPad cache key.');
	return {
		algorithm: STAFFPAD_ALGORITHM_ID,
		version: STAFFPAD_ALGORITHM_VERSION,
		source: normalizeJsonValue(source, 'source', new Set()),
		range: {
			startFrame: normalized.selection.startFrame,
			frameCount: normalized.selection.frameCount,
			direction: source?.direction === 'reverse' ? 'reverse' : 'forward',
		},
		sampleRate: normalized.sampleRate,
		channelCount: normalized.channels.length,
		outputFrames: normalized.outputFrames,
		transform: normalized.transform,
	};
}

export async function staffPadRenderCacheKey(request, source) {
	const descriptor = createStaffPadCacheDescriptor(request, source);
	const cryptoApi = globalThis.crypto;
	if (!cryptoApi?.subtle) throw new Error('SHA-256 is unavailable in this environment.');
	const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(stableSerialize(descriptor)));
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${STAFFPAD_ALGORITHM_ID}:${hash}`;
}

export function stableSerializeStaffPadCacheDescriptor(descriptor) {
	return stableSerialize(descriptor);
}

function constantTempoRatio(value) {
	if (value.tempoRatio != null && value.timeRatio != null) {
		throw new TypeError('Specify either tempoRatio or timeRatio, not both.');
	}
	if (value.timeRatio != null) return 1 / ratioValue(value.timeRatio, 'timeRatio');
	return ratioValue(value.tempoRatio ?? 1, 'tempoRatio');
}

function normalizeKeyframe(keyframe, index) {
	if (!keyframe || typeof keyframe !== 'object' || Array.isArray(keyframe)) {
		throw new TypeError(`keyframes[${index}] must be an object.`);
	}
	return {
		position: finiteRange(keyframe.position, 0, 1, `keyframes[${index}].position`),
		tempoRatio: constantTempoRatio(keyframe),
		pitchRatio: ratioValue(keyframe.pitchRatio ?? 1, `keyframes[${index}].pitchRatio`),
	};
}

function durationRatioForKeyframes(keyframes) {
	let integral = 0;
	for (let index = 1; index < keyframes.length; index += 1) {
		const left = keyframes[index - 1];
		const right = keyframes[index];
		integral += (right.position - left.position) * (left.tempoRatio + right.tempoRatio) / 2;
	}
	return 1 / integral;
}

function normalizeChannels(channels) {
	if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) {
		throw new RangeError('StaffPad supports one or two Float32Array channels.');
	}
	let frameCount = null;
	for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
		const channel = channels[channelIndex];
		if (!(channel instanceof Float32Array)) {
			throw new TypeError(`channels[${channelIndex}] must be a Float32Array.`);
		}
		if (frameCount == null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError('StaffPad channels must have matching lengths.');
		for (let frame = 0; frame < channel.length; frame += 1) {
			if (!Number.isFinite(channel[frame])) {
				throw new RangeError(`channels[${channelIndex}] contains a non-finite sample at frame ${frame}.`);
			}
		}
	}
	if (frameCount === 0) throw new RangeError('StaffPad input must contain at least one frame.');
	return channels;
}

function normalizeSelection(selection, inputFrames) {
	if (selection == null) return { startFrame: 0, frameCount: inputFrames };
	if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
		throw new TypeError('selection must be an object.');
	}
	const startFrame = nonNegativeSafeInteger(selection.startFrame ?? 0, 'selection.startFrame');
	const frameCount = selection.frameCount == null
		? inputFrames - startFrame
		: positiveSafeInteger(selection.frameCount, 'selection.frameCount');
	if (startFrame + frameCount > inputFrames) throw new RangeError('selection exceeds the StaffPad input.');
	return { startFrame, frameCount };
}

function normalizeJsonValue(value, name, ancestors) {
	if (value === null) return null;
	if (value === undefined) throw new TypeError(`${name} must not be undefined.`);
	if (typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return finiteNumber(value, name);
	if (typeof value !== 'object') throw new TypeError(`${name} must be JSON-safe.`);
	if (ancestors.has(value)) throw new TypeError(`${name} must not contain circular references.`);
	if (!Array.isArray(value) && !isPlainObject(value)) throw new TypeError(`${name} must contain only plain objects and arrays.`);
	ancestors.add(value);
	let normalized;
	if (Array.isArray(value)) {
		normalized = value.map((item, index) => normalizeJsonValue(item, `${name}[${index}]`, ancestors));
	} else {
		normalized = {};
		for (const key of Object.keys(value).sort()) {
			if (value[key] === undefined) throw new TypeError(`${name}.${key} must not be undefined.`);
			normalized[key] = normalizeJsonValue(value[key], `${name}.${key}`, ancestors);
		}
	}
	ancestors.delete(value);
	return normalized;
}

function stableSerialize(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(Object.is(value, -0) ? 0 : value);
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function isPlainObject(value) {
	if (!value || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function booleanValue(value, name) {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
}

function finiteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
	return number;
}

function finiteRange(value, minimum, maximum, name) {
	const number = finiteNumber(value, name);
	if (number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	return number;
}

function ratioValue(value, name) {
	return finiteRange(value, STAFFPAD_MINIMUM_RATIO, STAFFPAD_MAXIMUM_RATIO, name);
}

function integerRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

function positiveSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function nonNegativeSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}
