/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact adapter-owned WAV geometry used for preparation, reservation, and review. */

import type { AssistanceOperation } from '../assistance/operation.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import { inspectWavLayout } from '../wav.js';

export interface LocalAssistanceAudioInputProfile {
	readonly sampleRate: number;
	readonly channels: 'mono' | 'preserve';
}

const PROFILES = Object.freeze({
	'voice-activity-detection': profile(16_000, 'mono'),
	'speech-recognition': profile(16_000, 'mono'),
	'word-alignment': profile(16_000, 'mono'),
	'speaker-diarization': profile(16_000, 'mono'),
	'speech-enhancement': profile(48_000, 'preserve'),
	'dereverberation': profile(44_100, 'preserve'),
	'source-separation': profile(44_100, 'preserve'),
	'audio-tagging': profile(32_000, 'mono'),
	'beat-tracking': profile(22_050, 'mono'),
} satisfies Partial<Record<AssistanceOperation, LocalAssistanceAudioInputProfile>>);

export type ProfiledAudioOperation = keyof typeof PROFILES;

export interface LocalAssistanceAudioWaveGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly byteLength: number;
}

export function localAssistanceAudioInputProfile(
	operation: AssistanceOperation,
): LocalAssistanceAudioInputProfile {
	const selected = (PROFILES as Partial<Record<AssistanceOperation,
		LocalAssistanceAudioInputProfile>>)[operation];
	if (!selected) throw new RangeError('This assistance operation has no audio input profile.');
	return selected;
}

export function localAssistanceAudioWaveGeometry(
	operation: ProfiledAudioOperation,
	inputFrameCount: number,
	inputSampleRate: number,
	inputChannelCount: number,
): LocalAssistanceAudioWaveGeometry {
	if (!Number.isSafeInteger(inputFrameCount) || inputFrameCount < 1
		|| !Number.isSafeInteger(inputSampleRate) || inputSampleRate < 1
		|| !Number.isSafeInteger(inputChannelCount) || inputChannelCount < 1
		|| inputChannelCount > 64) {
		throw new RangeError('The assistance audio geometry is invalid.');
	}
	const selected = localAssistanceAudioInputProfile(operation);
	const frameCount = Number(scaleSampleFrame(
		inputFrameCount, inputSampleRate, selected.sampleRate, 'point',
	));
	const channelCount = selected.channels === 'mono' ? 1 : inputChannelCount;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
		throw new RangeError('The assistance audio geometry exceeds safe timing.');
	}
	const layout = canonicalLayout(selected.sampleRate, channelCount, frameCount);
	if (layout.container !== 'riff' || layout.headerByteLength !== 44) {
		throw new RangeError('The assistance audio geometry exceeds canonical RIFF capacity.');
	}
	return Object.freeze({ sampleRate: selected.sampleRate, channelCount,
		frameCount, byteLength: layout.byteLength });
}

export function localAssistanceCanonicalWaveByteLength(
	sampleRate: number,
	channelCount: number,
	frameCount: number,
): number {
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1
		|| !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 64
		|| !Number.isSafeInteger(frameCount) || frameCount < 1) {
		throw new RangeError('The assistance WAV review geometry is invalid.');
	}
	const layout = canonicalLayout(sampleRate, channelCount, frameCount);
	if (layout.container !== 'riff' || layout.headerByteLength !== 44) {
		throw new RangeError('The assistance WAV review geometry exceeds canonical RIFF capacity.');
	}
	return layout.byteLength;
}

function canonicalLayout(sampleRate: number, channelCount: number, frameCount: number) {
	try {
		return inspectWavLayout({ sampleRate, channelCount, totalFrames: frameCount,
			bitDepth: 32, float: true });
	} catch (error) {
		throw new RangeError('The assistance WAV geometry exceeds safe capacity.', { cause: error });
	}
}

function profile(
	sampleRate: number,
	channels: LocalAssistanceAudioInputProfile['channels'],
): LocalAssistanceAudioInputProfile {
	return Object.freeze({ sampleRate, channels });
}
