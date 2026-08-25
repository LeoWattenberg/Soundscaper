/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopAudioFfmpegWaveOutputError,
	parseDesktopAudioFfmpegWaveOutput,
} from '../desktop/desktop-audio-ffmpeg-wave-output.ts';

test('float WAV output returns owned PCM with actual mono source geometry', () => {
	const pcm = new Uint8Array(Float32Array.from([0.25, -0.5, 0.75]).buffer);
	const wave = floatWave({ sampleRate: 44_100, channelCount: 1, pcm });
	const parsed = parseDesktopAudioFfmpegWaveOutput(wave, 1_024);
	assert.deepEqual(parsed.decodedGeometry, {
		sampleRate: 44_100, channelCount: 1, frameCount: 3,
	});
	assert.deepEqual(parsed.output, pcm);
	assert.notEqual(parsed.output.buffer, wave.buffer);
	assert.equal(Object.isFrozen(parsed), true);
});

test('WAVE_FORMAT_EXTENSIBLE float output preserves bounded multichannel geometry', () => {
	const pcm = new Uint8Array(4 * 6 * 2);
	const parsed = parseDesktopAudioFfmpegWaveOutput(floatWave({
		sampleRate: 96_000, channelCount: 6, pcm, extensible: true,
	}), pcm.byteLength);
	assert.deepEqual(parsed.decodedGeometry, {
		sampleRate: 96_000, channelCount: 6, frameCount: 2,
	});
});

test('malformed, integer, incomplete, and oversized WAV output is terminal', () => {
	const pcm = new Uint8Array(16);
	const valid = floatWave({ sampleRate: 48_000, channelCount: 2, pcm });
	for (const mutated of [
		valid.subarray(0, valid.byteLength - 1),
		withUint16(valid, 20, 1),
		withUint16(valid, 32, 4),
		withUint32(valid, 24, 7_999),
		withUint32(valid, 4, valid.byteLength),
	]) assert.throws(
		() => parseDesktopAudioFfmpegWaveOutput(mutated, 1_024),
		DesktopAudioFfmpegWaveOutputError,
	);
	assert.throws(() => parseDesktopAudioFfmpegWaveOutput(valid, pcm.byteLength - 1), /bound/iu);
});

function floatWave(options: Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly pcm: Uint8Array;
	readonly extensible?: boolean;
}>): Uint8Array {
	const formatBytes = options.extensible ? 40 : 16;
	const dataPadding = options.pcm.byteLength % 2;
	const output = new Uint8Array(12 + 8 + formatBytes + 8 + options.pcm.byteLength + dataPadding);
	ascii(output, 0, 'RIFF');
	const view = new DataView(output.buffer);
	view.setUint32(4, output.byteLength - 8, true);
	ascii(output, 8, 'WAVE');
	ascii(output, 12, 'fmt ');
	view.setUint32(16, formatBytes, true);
	view.setUint16(20, options.extensible ? 0xfffe : 3, true);
	view.setUint16(22, options.channelCount, true);
	view.setUint32(24, options.sampleRate, true);
	view.setUint32(28, options.sampleRate * options.channelCount * 4, true);
	view.setUint16(32, options.channelCount * 4, true);
	view.setUint16(34, 32, true);
	if (options.extensible) {
		view.setUint16(36, 22, true);
		view.setUint16(38, 32, true);
		view.setUint32(40, 0x3f, true);
		output.set([
			3, 0, 0, 0, 0, 0, 0x10, 0,
			0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71,
		], 44);
	}
	const dataOffset = 20 + formatBytes;
	ascii(output, dataOffset, 'data');
	view.setUint32(dataOffset + 4, options.pcm.byteLength, true);
	output.set(options.pcm, dataOffset + 8);
	return output;
}

function ascii(output: Uint8Array, offset: number, value: string): void {
	output.set([...value].map((character) => character.charCodeAt(0)), offset);
}

function withUint16(source: Uint8Array, offset: number, value: number): Uint8Array {
	const output = source.slice();
	new DataView(output.buffer).setUint16(offset, value, true);
	return output;
}

function withUint32(source: Uint8Array, offset: number, value: number): Uint8Array {
	const output = source.slice();
	new DataView(output.buffer).setUint32(offset, value, true);
	return output;
}
