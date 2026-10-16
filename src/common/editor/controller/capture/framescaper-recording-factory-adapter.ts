/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperWorkletRecordingControllerFactory } from './internal/browser/framescaper-browser-audio-recorder.ts';
import type { RecordingAudioContext, RecordingControllerFactory, RecordingMediaStream } from '../recording/recording-transaction-types.ts';
import { createRecordingController } from '../../recording.js';
import { withFramescaperCaptureListeningOutput, type FramescaperCaptureListeningGain } from './internal/browser/framescaper-capture-listening-output.ts';

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

function audioContext(value: unknown): value is RecordingAudioContext {
	return object(value)
		&& typeof value.sampleRate === 'number' && Number.isFinite(value.sampleRate) && value.sampleRate > 0
		&& typeof value.currentTime === 'number' && Number.isFinite(value.currentTime)
		&& typeof value.resume === 'function'
		&& (value.state === undefined || typeof value.state === 'string')
		&& ['baseLatency', 'outputLatency'].every(key => value[key] === undefined || typeof value[key] === 'number')
		&& ['addEventListener', 'removeEventListener'].every(key => value[key] === undefined || typeof value[key] === 'function');
}

function mediaStream(value: unknown): value is RecordingMediaStream {
	return object(value) && typeof value.getAudioTracks === 'function'
		&& ['getTracks', 'getVideoTracks'].every(key => value[key] === undefined || typeof value[key] === 'function');
}

/** Preserve the shared host factory while adapting the capture owner's callback contract. */
export function adaptFramescaperRecordingControllerFactory(
	factory?: RecordingControllerFactory,
	listening?: FramescaperCaptureListeningGain,
): FramescaperWorkletRecordingControllerFactory | undefined {
	if (!factory && !listening) return undefined;
	const createRecorder = factory ?? (createRecordingController as unknown as RecordingControllerFactory);
	const adapted: FramescaperWorkletRecordingControllerFactory = async options => {
		if (!audioContext(options.context)) throw new TypeError('Recording requires an audio context.');
		if (!mediaStream(options.stream)) throw new TypeError('Recording requires a media stream.');
		return createRecorder({
			...options, context: options.context, stream: options.stream,
			onChunk: async chunk => { await options.onChunk(chunk); },
			onState: () => {},
		});
	};
	return listening ? withFramescaperCaptureListeningOutput(adapted, listening) : adapted;
}
