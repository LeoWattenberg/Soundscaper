/* SPDX-License-Identifier: AGPL-3.0-only */

// The capture inputs a recording can draw from, and the values a caller
// describes them with. A hardware input is requested with the browser's speech
// processing turned off so the exact device signal arrives; a display input is
// requested for its audio but keeps the video track the browser insists on
// pairing with it. Split out of recording.js; no behaviour changes here.

import { acquireSoundscaperNativeAudioCapture } from './soundscaper-native-audio-capture.ts';

const DISPLAY_REPLACEMENT_SUFFIX = ':replacement';

export const DISPLAY_INPUT_KEY = 'display';
export const DISPLAY_REPLACEMENT_KEY = `${DISPLAY_INPUT_KEY}${DISPLAY_REPLACEMENT_SUFFIX}`;
export const HARDWARE_INPUT_KEY_PREFIX = 'device:';

export const RECORDING_INPUT_GAIN_MINIMUM = 0;
export const RECORDING_INPUT_GAIN_MAXIMUM = 2;
export const RECORDING_INPUT_GAIN_DEFAULT = 1;
// Chromium rejects AudioWorkletNode output channel counts above 32.
export const RECORDING_CHANNEL_COUNT_MAXIMUM = 32;

export async function requestMicrophone(constraints = { audio: true }) {
	const mediaDevices = getMediaDevices();
	if (!mediaDevices?.getUserMedia) {
		throw new Error('Microphone recording is not supported in this browser.');
	}
	return mediaDevices.getUserMedia.call(mediaDevices, constraints);
}

/** Request exact hardware input without browser speech processing. */
export async function requestHardwareInput({
	deviceId,
	channelCount = 2,
	sampleRate,
	audioConstraints = {},
	mediaDevices = getMediaDevices(),
} = {}) {
	const nativeStream = acquireSoundscaperNativeAudioCapture({ deviceId, channelCount, sampleRate });
	if (nativeStream) return nativeStream;
	if (!mediaDevices?.getUserMedia) {
		throw new Error('Hardware audio recording is not supported in this browser.');
	}
	const normalizedChannelCount = normalizeRecordingChannelCount(channelCount);
	const audio = {
		...audioConstraints,
		channelCount: { ideal: normalizedChannelCount, max: normalizedChannelCount },
		echoCancellation: false,
		noiseSuppression: false,
		autoGainControl: false,
	};
	if (deviceId !== undefined && deviceId !== null && String(deviceId)) {
		audio.deviceId = { exact: String(deviceId) };
	}
	if (Number.isFinite(sampleRate) && sampleRate > 0) {
		audio.sampleRate = { ideal: Math.floor(sampleRate) };
	}
	return mediaDevices.getUserMedia.call(mediaDevices, { audio });
}

/** Request tab/window/system audio while retaining its required video track. */
export async function requestDisplayInput({
	audioConstraints = true,
	videoConstraints = true,
	displayConstraints = {},
	mediaDevices = getMediaDevices(),
} = {}) {
	if (!mediaDevices?.getDisplayMedia) {
		throw new Error('Desktop audio recording is not supported in this browser.');
	}
	return mediaDevices.getDisplayMedia.call(mediaDevices, {
		...displayConstraints,
		video: videoConstraints || true,
		audio: audioConstraints || true,
		selfBrowserSurface: 'exclude',
		systemAudio: 'include',
		windowAudio: 'system',
	});
}


/**
 * Normalize the browser's software recording gain. Values are linear: 1 is
 * unity, 0 is silence, and 2 is approximately +6 dB. Keeping the range small
 * limits accidental monitor blasts while still allowing a modest boost.
 */
export function normalizeRecordingInputGain(value) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError('Recording input gain must be a finite number.');
	}
	return Math.max(RECORDING_INPUT_GAIN_MINIMUM, Math.min(RECORDING_INPUT_GAIN_MAXIMUM, value));
}

/** Normalize capture channels to Soundscaper's planar PCM limit. */
export function normalizeRecordingChannelCount(value) {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(RECORDING_CHANNEL_COUNT_MAXIMUM, Math.floor(value)));
}

export function exposedAudioChannelCount(stream) {
	let channelCount = 1;
	for (const track of stream?.getAudioTracks?.() || []) {
		channelCount = Math.max(channelCount, normalizeRecordingChannelCount(track.getSettings?.().channelCount));
	}
	return channelCount;
}

export function hasLiveTrack(stream, kind) {
	const tracks = kind === 'audio' ? stream?.getAudioTracks?.() : stream?.getVideoTracks?.();
	return Boolean(tracks?.some((track) => track?.readyState !== 'ended'));
}

export function stopStream(stream) {
	for (const track of stream?.getTracks?.() || []) track.stop?.();
}

export function normalizeDeviceId(deviceId) {
	if (typeof deviceId !== 'string' || !deviceId) throw new TypeError('A hardware device ID is required.');
	return deviceId;
}

export function hardwareInputKey(deviceId) {
	return `${HARDWARE_INPUT_KEY_PREFIX}${normalizeDeviceId(deviceId)}`;
}

export function getMediaDevices() {
	return globalThis.navigator?.mediaDevices;
}
