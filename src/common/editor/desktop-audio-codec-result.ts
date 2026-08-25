/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-side correlation and planar projection of main-owned desktop audio results. */

import type {
	DesktopAudioCodecRequest,
	DesktopAudioCodecResult,
} from '../../../desktop/desktop-audio-codec-operation-contract.ts';

export interface DesktopAudioCodecDecodedResult {
	readonly sampleRate: number;
	readonly channels: readonly Float32Array[];
	readonly frameCount: number;
}

export function projectDesktopAudioDecodeResult(
	result: DesktopAudioCodecResult,
): DesktopAudioCodecDecodedResult {
	if (result.operation !== 'audio-decode') {
		throw new Error('The desktop audio bridge returned an encode result for decode.');
	}
	const channels = Array.from({ length: result.metadata.channelCount }, () => (
		new Float32Array(result.metadata.frameCount)
	));
	const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
	for (let frame = 0; frame < result.metadata.frameCount; frame += 1) {
		for (let channel = 0; channel < channels.length; channel += 1) {
			const sample = view.getFloat32((frame * channels.length + channel) * 4, true);
			channels[channel]![frame] = Number.isFinite(sample) ? sample : 0;
		}
	}
	return Object.freeze({
		sampleRate: result.metadata.sampleRate,
		channels: Object.freeze(channels),
		frameCount: result.metadata.frameCount,
	});
}

export function assertDesktopAudioCodecResultCorrelation(
	result: DesktopAudioCodecResult,
	request: DesktopAudioCodecRequest,
): void {
	if (result.requestId !== request.requestId) {
		throw new Error('The desktop audio bridge result request ID does not match its request.');
	}
	if (result.operation !== request.operation) {
		throw new Error('The desktop audio bridge result operation does not match its request.');
	}
	if (result.operation === 'audio-decode') {
		if (request.operation !== 'audio-decode' || result.metadata.sourceFormat !== request.format) {
			throw new Error('The desktop audio bridge decoded metadata does not match its request.');
		}
		return;
	}
	if (request.operation !== 'audio-encode' || result.metadata.format !== request.format
		|| result.metadata.sampleRate !== request.sampleRate
		|| result.metadata.channelCount !== request.channelCount
		|| result.metadata.frameCount !== request.input.byteLength / (request.channelCount * 4)) {
		throw new Error('The desktop audio bridge encoded metadata does not match its request.');
	}
}
