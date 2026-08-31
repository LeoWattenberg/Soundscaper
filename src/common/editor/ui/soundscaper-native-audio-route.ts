/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NativeAudioSessionOpenRequestV1 } from './soundscaper-native-services-bridge.ts';

export type NativeAudioStreamingUiBackend = Exclude<
	NativeAudioSessionOpenRequestV1['candidates'][number]['backend'], 'jack'
>;

export function isNativeAudioStreamingBackend(value: string): value is NativeAudioStreamingUiBackend {
	return ['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa'].includes(value);
}

/** Validate and freeze the exact native route form before it reaches the desktop bridge. */
export function createNativeAudioRouteOpenRequest(
	value: NativeAudioSessionOpenRequestV1,
): NativeAudioSessionOpenRequestV1 {
	if (value.candidates.length < 1 || value.candidates.length > 4
		|| value.candidates.some((candidate) => !isNativeAudioStreamingBackend(candidate.backend)
			|| !candidate.deviceHandle || /[\0/\\]/u.test(candidate.deviceHandle))
		|| !['input', 'output', 'duplex'].includes(value.direction)
		|| !['shared', 'exclusive'].includes(value.mode)
		|| value.candidates.some((candidate) => candidate.backend === 'asio') && value.mode !== 'exclusive') {
		throw new TypeError('Invalid native audio route selection.');
	}
	for (const [entry, minimum, maximum] of [
		[value.sampleRate, 8_000, 768_000], [value.periodFrames, 1, 16_384], [value.channelCount, 1, 32],
	] as const) if (!Number.isSafeInteger(entry) || entry < minimum || entry > maximum) {
		throw new RangeError('A native audio route value is outside its admitted bounds.');
	}
	return Object.freeze({
		candidates: Object.freeze(value.candidates.map((candidate) => Object.freeze({ ...candidate }))),
		direction: value.direction, mode: value.mode, sampleRate: value.sampleRate,
		periodFrames: value.periodFrames, channelCount: value.channelCount,
	});
}
