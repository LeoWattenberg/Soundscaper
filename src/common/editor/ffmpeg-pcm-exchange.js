/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';

/**
 * Moving PCM across the FFmpeg worker boundary.
 *
 * FFmpeg reads and writes its own in-memory filesystem, so every decode leaves the editor
 * holding WAV bytes it has to turn back into planar float channels. Both directions are
 * copies on purpose: the bytes handed to the worker must not alias a caller's buffer that
 * could be reused while the worker still holds it.
 */

export function toUint8Array(value) {
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	throw new TypeError('Expected WAV bytes');
}

export async function decodeFloatWave(bytes, signal) {
	const blob = new Blob([bytes]);
	const descriptor = await inspectWavBlobPcm(blob, { signal });
	if (descriptor.encoding !== 'ieee-float' || descriptor.bitDepth !== 32) {
		throw new Error('FFmpeg returned an unexpected PCM format.');
	}
	const channels = Array.from(
		{ length: descriptor.channelCount },
		() => new Float32Array(descriptor.frameCount),
	);
	await streamWavBlobPcm(blob, {
		descriptor,
		signal,
		onChunk(packet, { frameOffset }) {
			for (let channel = 0; channel < channels.length; channel += 1) {
				channels[channel].set(packet[channel], frameOffset);
			}
		},
	});
	return {
		sampleRate: descriptor.sampleRate,
		channels,
		frameCount: descriptor.frameCount,
	};
}
