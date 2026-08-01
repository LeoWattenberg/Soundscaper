/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectPlanarPcmSinkPacket } from '../pcm-sink-admission.ts';

interface RealtimeCaptureGeometry {
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly outputFrames: number;
	readonly renderedFrames: number;
}

export interface RealtimeCaptureChunk {
	readonly type: 'audio-chunk';
	readonly channels: readonly Float32Array[];
	readonly frames: number;
	readonly frameOffset: number;
}

export interface RealtimeCaptureDone {
	readonly type: 'done';
	readonly frames: number;
}

export type RealtimeCaptureMessage = RealtimeCaptureChunk | RealtimeCaptureDone;

export function validateRealtimeCaptureMessage(
	value: unknown,
	geometry: RealtimeCaptureGeometry,
): RealtimeCaptureMessage | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const message = value as Readonly<Record<string, unknown>>;
	if (message.type === 'capture-error') throw captureWorkletError(message.code);
	if (message.type === 'audio-chunk') {
		const packet = inspectPlanarPcmSinkPacket(message.channels);
		if (packet.channelCount !== geometry.channelCount) {
			throw new TypeError('A realtime capture packet must have the exact output channel count.');
		}
		if (packet.frames > geometry.chunkFrames) {
			throw new RangeError('A realtime capture packet exceeds its admitted frame count.');
		}
		const frames = safeNonnegativeInteger(message.frames, 'declared frame count');
		if (frames !== packet.frames) {
			throw new Error('A realtime capture packet has an invalid declared frame count.');
		}
		const frameOffset = safeNonnegativeInteger(message.frameOffset, 'contiguous frame offset');
		if (frameOffset !== geometry.renderedFrames) {
			throw new Error('A realtime capture packet has a non-contiguous frame offset.');
		}
		if (frames > geometry.outputFrames - geometry.renderedFrames) {
			throw new RangeError('A realtime capture packet exceeds the requested output geometry.');
		}
		return Object.freeze({
			type: 'audio-chunk',
			channels: packet.channels,
			frames,
			frameOffset,
		});
	}
	if (message.type === 'done') {
		const frames = safeNonnegativeInteger(message.frames, 'completion frame count');
		if (frames !== geometry.outputFrames || frames !== geometry.renderedFrames) {
			throw new Error('The realtime capture worklet reported invalid completion geometry.');
		}
		return Object.freeze({ type: 'done', frames });
	}
	return null;
}

function captureWorkletError(code: unknown): Error {
	const backpressure = code === 'REALTIME_CAPTURE_BACKPRESSURE';
	const error = Object.assign(new Error(backpressure
		? 'The realtime capture worklet exhausted its admitted producer credits.'
		: 'The realtime capture worklet failed.'), {
		code: backpressure ? code : 'REALTIME_CAPTURE_FAILURE',
	});
	error.name = 'RealtimeCaptureError';
	return error;
}

function safeNonnegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new TypeError(`The realtime capture ${label} is invalid.`);
	}
	return value as number;
}
