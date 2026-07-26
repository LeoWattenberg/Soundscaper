/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_SAMPLE_RATE } from '../project.js';
import { RECORDING_CHANNEL_COUNT_MAXIMUM } from '../recording.js';
import { RECORDING_DEFAULT_DEVICE_ID } from '../recording-routing.js';

const LIVE_RECORDING_WAVEFORM_BUCKET_FRAMES = 64;
const LIVE_RECORDING_WAVEFORM_MAXIMUM_BUCKETS = 2_048;

interface AudioTrackLike {
	readonly readyState?: string;
	getSettings?(): Readonly<{ channelCount?: number }>;
}

export interface MediaStreamLike {
	getAudioTracks?(): readonly AudioTrackLike[];
	getVideoTracks?(): readonly AudioTrackLike[];
}

export interface AudioDevicePreferences {
	readonly inputDeviceId: string;
	readonly inputChannelCount: 1 | 2;
	readonly outputDeviceId: string;
}

export interface RecordingPreview {
	readonly trackId: string;
	readonly startFrame: number;
	framesToSkip: number;
	frames: number;
	framesPerBucket: number;
	bucketFrames: number;
	readonly minimums: number[];
	readonly maximums: number[];
	readonly buckets: number[][];
}

export interface RecordingPreviewSnapshot {
	readonly trackId: string;
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly channels: readonly Float32Array[];
}

export function normalizeLatencyOffset(value: unknown): number {
	return Math.max(-500, Math.min(500, Number(value) || 0));
}

export function normalizeTimedRecordingStart(value: unknown): number {
	const timestamp = value instanceof Date
		? value.getTime()
		: typeof value === 'number'
			? value
			: new Date(typeof value === 'string' ? value : '').getTime();
	if (!Number.isFinite(timestamp)) throw new TypeError('A valid timer recording start time is required.');
	return Math.round(timestamp);
}

export function scaleRecordingFrames(
	frameCount: unknown,
	inputSampleRate: unknown,
	outputSampleRate: unknown,
): number {
	const frames = Math.max(0, Math.floor(Number(frameCount) || 0));
	const inputRate = Math.max(1, Math.floor(Number(inputSampleRate) || AUDIO_EDITOR_SAMPLE_RATE));
	const outputRate = Math.max(1, Math.floor(Number(outputSampleRate) || AUDIO_EDITOR_SAMPLE_RATE));
	return Math.max(0, Math.round(frames * outputRate / inputRate));
}

export function normalizeAudioDevicePreferences(value: unknown): Readonly<AudioDevicePreferences> {
	const source = value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: {};
	return Object.freeze({
		inputDeviceId: normalizePreferredInputDeviceId(source.inputDeviceId),
		inputChannelCount: Number(source.inputChannelCount) === 2 ? 2 : 1,
		outputDeviceId: normalizePreferredOutputDeviceId(source.outputDeviceId),
	});
}

export function normalizePreferredInputDeviceId(deviceId: unknown): string {
	if (deviceId == null || deviceId === '') return RECORDING_DEFAULT_DEVICE_ID;
	if (typeof deviceId !== 'string') return RECORDING_DEFAULT_DEVICE_ID;
	return deviceId.trim() || RECORDING_DEFAULT_DEVICE_ID;
}

export function normalizePreferredOutputDeviceId(deviceId: unknown): string {
	if (deviceId == null || deviceId === 'default') return '';
	if (typeof deviceId !== 'string') return '';
	return deviceId.trim();
}

export function streamAudioChannelCount(stream: MediaStreamLike | null | undefined): number {
	let channelCount = 1;
	for (const track of stream?.getAudioTracks?.() || []) {
		channelCount = Math.max(
			channelCount,
			Math.max(1, Math.min(RECORDING_CHANNEL_COUNT_MAXIMUM, Number(track.getSettings?.().channelCount) || 1)),
		);
	}
	return channelCount;
}

export function recordingStreamIsLive(
	stream: MediaStreamLike | null | undefined,
	kind: string,
): boolean {
	const audioLive = stream?.getAudioTracks?.().some((track) => track?.readyState !== 'ended');
	if (!audioLive) return false;
	return kind !== 'display' || Boolean(stream?.getVideoTracks?.().some((track) => track?.readyState !== 'ended'));
}

export function createRecordingPreview({
	trackId,
	startFrame,
	channelCount,
	framesToSkip = 0,
}: {
	readonly trackId: string;
	readonly startFrame: unknown;
	readonly channelCount: unknown;
	readonly framesToSkip?: unknown;
}): RecordingPreview {
	const channels = Math.max(1, Math.min(2, Number(channelCount) || 1));
	return {
		trackId,
		startFrame: Math.max(0, Math.floor(Number(startFrame) || 0)),
		framesToSkip: Math.max(0, Math.floor(Number(framesToSkip) || 0)),
		frames: 0,
		framesPerBucket: LIVE_RECORDING_WAVEFORM_BUCKET_FRAMES,
		bucketFrames: 0,
		minimums: Array.from({ length: channels }, () => 1),
		maximums: Array.from({ length: channels }, () => -1),
		buckets: Array.from({ length: channels }, () => []),
	};
}

export function appendRecordingPreview(
	preview: RecordingPreview | null | undefined,
	channels: readonly Float32Array[] | null | undefined,
): void {
	if (!preview || !Array.isArray(channels) || !channels[0]?.length) return;
	const frameCount = Math.max(0, ...channels.map((channel) => channel?.length || 0));
	for (let frame = 0; frame < frameCount; frame += 1) {
		if (preview.framesToSkip > 0) {
			preview.framesToSkip -= 1;
			continue;
		}
		for (let channel = 0; channel < preview.buckets.length; channel += 1) {
			const value = Number(channels[channel]?.[frame]) || 0;
			preview.minimums[channel] = Math.min(preview.minimums[channel], value);
			preview.maximums[channel] = Math.max(preview.maximums[channel], value);
		}
		preview.frames += 1;
		preview.bucketFrames += 1;
		if (preview.bucketFrames < preview.framesPerBucket) continue;
		for (let channel = 0; channel < preview.buckets.length; channel += 1) {
			preview.buckets[channel].push(preview.minimums[channel], preview.maximums[channel]);
			preview.minimums[channel] = 1;
			preview.maximums[channel] = -1;
		}
		preview.bucketFrames = 0;
		compactRecordingPreview(preview);
	}
}

export function compactRecordingPreview(preview: RecordingPreview): void {
	const bucketCount = Math.floor(preview.buckets[0]?.length / 2) || 0;
	if (bucketCount < LIVE_RECORDING_WAVEFORM_MAXIMUM_BUCKETS) return;
	for (const channel of preview.buckets) {
		const compacted: number[] = [];
		for (let bucket = 0; bucket < channel.length; bucket += 4) {
			if (bucket + 3 >= channel.length) {
				compacted.push(channel[bucket] ?? 1, channel[bucket + 1] ?? -1);
				continue;
			}
			compacted.push(
				Math.min(channel[bucket] ?? 1, channel[bucket + 2] ?? 1),
				Math.max(channel[bucket + 1] ?? -1, channel[bucket + 3] ?? -1),
			);
		}
		channel.splice(0, channel.length, ...compacted);
	}
	preview.framesPerBucket *= 2;
}

export function recordingPreviewSnapshot(
	preview: RecordingPreview | null | undefined,
): Readonly<RecordingPreviewSnapshot> | null {
	if (!preview || preview.frames <= 0) return null;
	const channels = preview.buckets.map((buckets, index) => {
		const output = new Float32Array(buckets.length + (preview.bucketFrames ? 2 : 0));
		output.set(buckets);
		if (preview.bucketFrames) {
			output[output.length - 2] = preview.minimums[index] ?? 0;
			output[output.length - 1] = preview.maximums[index] ?? 0;
		}
		return output;
	});
	return Object.freeze({
		trackId: preview.trackId,
		startFrame: preview.startFrame,
		durationFrames: preview.frames,
		channels: Object.freeze(channels),
	});
}
