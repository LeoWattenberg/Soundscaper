/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperBrowserAudioRecorder,
	type FramescaperAudioTrackProcessorConstructor,
	type FramescaperWorkletRecordingControllerFactory,
} from './framescaper-browser-audio-recorder.ts';
import type {
	BrowserCaptureStream,
	BrowserCaptureTrack,
} from './framescaper-browser-capture-source.ts';
import { selectFramescaperVideoMimeType } from './framescaper-browser-capture-source.ts';
import {
	createFramescaperBrowserVideoRecorder,
	type FramescaperMediaRecorderLike,
} from './framescaper-browser-video-recorder.ts';
import { createFramescaperCapturePcmPacketizer } from './framescaper-capture-pcm-packetizer.ts';
import type {
	FramescaperCaptureRecorder,
	FramescaperCaptureRecorderRequest,
} from './framescaper-capture-session-types.ts';

interface MediaRecorderConstructor<Recorder extends FramescaperMediaRecorderLike> {
	new(stream: unknown, options?: Readonly<{ mimeType?: string }>): Recorder;
	isTypeSupported(mimeType: string): boolean;
}

export interface FramescaperBrowserRecorderFactoryOptions<
	Recorder extends FramescaperMediaRecorderLike = FramescaperMediaRecorderLike,
> {
	/** Undefined probes the browser; null explicitly disables video recording. */
	readonly MediaRecorder?: MediaRecorderConstructor<Recorder> | null;
	readonly MediaStreamTrackProcessor?: FramescaperAudioTrackProcessorConstructor | null;
	readonly recordingControllerFactory?: FramescaperWorkletRecordingControllerFactory;
	getAudioContext(): PromiseLike<Readonly<{
		readonly sampleRate: number;
		readonly audioWorklet?: Readonly<{ readonly addModule?: unknown }>;
		readonly createMediaStreamSource?: unknown;
	}>> | Readonly<{
		readonly sampleRate: number;
		readonly audioWorklet?: Readonly<{ readonly addModule?: unknown }>;
		readonly createMediaStreamSource?: unknown;
	}>;
	readonly receiptTime?: () => number;
}

export type FramescaperBrowserRecorderFactory = (
	request: FramescaperCaptureRecorderRequest<BrowserCaptureStream, BrowserCaptureTrack>,
) => Promise<FramescaperCaptureRecorder>;

/** Creates role-specific encoders behind the session's uniform recorder port. */
export function createFramescaperBrowserRecorderFactory<
	Recorder extends FramescaperMediaRecorderLike = FramescaperMediaRecorderLike,
>(
	options: FramescaperBrowserRecorderFactoryOptions<Recorder>,
): FramescaperBrowserRecorderFactory {
	if (!options || typeof options.getAudioContext !== 'function') {
		throw new TypeError('Framescaper browser recorder dependencies are invalid.');
	}

	return async (request) => {
		if (request.source.role === 'camera' || request.source.role === 'display') {
			return createVideoRecorder(options, request);
		}
		return createAudioRecorder(options, request);
	};
}

function createVideoRecorder<Recorder extends FramescaperMediaRecorderLike>(
	options: FramescaperBrowserRecorderFactoryOptions<Recorder>,
	request: FramescaperCaptureRecorderRequest<BrowserCaptureStream, BrowserCaptureTrack>,
): FramescaperCaptureRecorder {
	const MediaRecorder = options.MediaRecorder === undefined
		? runtimeMediaRecorder<Recorder>()
		: options.MediaRecorder;
	const selectedMimeType = selectFramescaperVideoMimeType(MediaRecorder);
	if (!MediaRecorder || selectedMimeType === null) {
		throw new Error('Framescaper video recording is unavailable in this browser.');
	}
	const recorder = createFramescaperBrowserVideoRecorder({
		MediaRecorder,
		stream: request.source.stream,
		sessionId: request.sessionId,
		streamId: request.streamId,
		role: videoRole(request.source.role),
		selectedMimeType,
		receiptTime: options.receiptTime,
		onPacket: request.onPacket,
		onError: request.onError,
		onBackpressure: request.onBackpressure,
	});
	return Object.freeze({
		format: Object.freeze({ kind: 'encoded-media' as const, mimeType: recorder.mimeType }),
		start: (activeTimeUs = 0) => recorder.start(activeTimeUs),
		pause: () => recorder.pause(),
		resume: (pauseDurationUs = 0) => recorder.resume(pauseDurationUs),
		stop: () => recorder.stop(),
		dispose: () => recorder.dispose(),
	});
}

async function createAudioRecorder<Recorder extends FramescaperMediaRecorderLike>(
	options: FramescaperBrowserRecorderFactoryOptions<Recorder>,
	request: FramescaperCaptureRecorderRequest<BrowserCaptureStream, BrowserCaptureTrack>,
): Promise<FramescaperCaptureRecorder> {
	if (request.source.role !== 'microphone' && request.source.role !== 'system-audio') {
		throw new Error('Framescaper audio recording requires an audio source role.');
	}
	let packetizer: ReturnType<typeof createFramescaperCapturePcmPacketizer> | null = null;
	const context = await options.getAudioContext();
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: request.source.role,
		track: request.source.track,
		stream: request.source.stream,
		context,
		MediaStreamTrackProcessor: options.MediaStreamTrackProcessor,
		recordingControllerFactory: options.recordingControllerFactory,
		monitoring: request.monitoring,
		inputGain: request.inputGain,
		onChunk: (chunk) => {
			if (!packetizer) throw new Error('Framescaper PCM arrived before recorder admission.');
			return request.onPacket(packetizer.packet(chunk));
		},
		onError: request.onError,
		onBackpressure: () => request.onBackpressure(),
	});
	packetizer = createFramescaperCapturePcmPacketizer({
		sessionId: request.sessionId,
		streamId: request.streamId,
		role: request.source.role,
		sampleRate: recorder.sampleRate,
		channelCount: recorder.channelCount,
		receiptTime: options.receiptTime,
	});
	return Object.freeze({
		format: Object.freeze({
			kind: 'raw-pcm' as const,
			sampleRate: recorder.sampleRate,
			channelCount: recorder.channelCount,
			chunkFrames: recorder.chunkFrames,
		}),
		start: (activeTimeUs = 0) => recorder.start(activeTimeFrame(
			activeTimeUs,
			recorder.sampleRate,
		)),
		pause: () => {
			const paused = recorder.pause();
			if (paused) packetizer?.expectPauseGap();
			return paused;
		},
		resume: () => recorder.resume(),
		stop: () => recorder.stop(),
		dispose: () => recorder.dispose(),
	});
}

function videoRole(value: string): 'camera' | 'display' {
	if (value !== 'camera' && value !== 'display') {
		throw new Error('Framescaper video recording requires a video source role.');
	}
	return value;
}

function runtimeMediaRecorder<Recorder extends FramescaperMediaRecorderLike>():
	MediaRecorderConstructor<Recorder> | null {
	const value = globalThis.MediaRecorder;
	return typeof value === 'function'
		? value as unknown as MediaRecorderConstructor<Recorder>
		: null;
}

function activeTimeFrame(activeTimeUs: number, sampleRate: number): number {
	if (!Number.isSafeInteger(activeTimeUs) || activeTimeUs < 0) {
		throw new RangeError('Capture recorder active time must be a non-negative integer.');
	}
	const frame = Math.round(activeTimeUs * sampleRate / 1_000_000);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('Capture recorder start frame exceeds the safe range.');
	return frame;
}
