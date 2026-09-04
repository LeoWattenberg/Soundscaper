/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseBundledFlacStream } from '../../../desktop/bundled-flac-stream.ts';
import { parseBundledMpegAudioStream } from '../../../desktop/bundled-mpeg-audio-stream.ts';
import { parseBundledOpusStream } from '../../../desktop/bundled-opus-stream.ts';
import { parseBundledVorbisStream } from '../../../desktop/bundled-vorbis-stream.ts';
import { parseBundledWavPackStream } from '../../../desktop/bundled-wavpack-stream.ts';
import type { DedicatedAudioEncodeRequest } from './browser-dedicated-audio-codec.ts';

/** Verify that a reviewed encoder returned the exact requested complete-file profile. */
export function validateDedicatedAudioOutput(
	output: Uint8Array,
	request: DedicatedAudioEncodeRequest,
): void {
	if (request.format === 'flac') {
		const geometry = parseBundledFlacStream(output);
		if (!sameGeometry(geometry, request) || geometry.bitsPerSample !== 24) fail();
		return;
	}
	if (request.format === 'opus') {
		if (!sameGeometry(parseBundledOpusStream(output), request)) fail();
		return;
	}
	if (request.format === 'ogg-vorbis') {
		if (!sameGeometry(parseBundledVorbisStream(output), request)) fail();
		return;
	}
	if (request.format === 'wavpack') {
		if (!sameGeometry(parseBundledWavPackStream(output), request)) fail();
		return;
	}
	const geometry = parseBundledMpegAudioStream(output, request.format);
	const bitrateKbps = request.settings.bitrateKbps;
	if (request.format === 'mp3') {
		if (!sameGeometry(geometry, request) || geometry.layer !== 3 || geometry.mpegVersion !== 1
			|| !admittedMp3Bitrate(geometry.bitrateKbps, request) || geometry.gapless !== 'lame'
			|| geometry.encoderDelay < 1 || geometry.endPadding < 0) fail();
		return;
	}
	const mpegFrameCount = Math.ceil(request.frameCount / 1_152);
	if (geometry.layer !== 2 || geometry.mpegVersion !== 1
		|| geometry.sampleRate !== request.sampleRate || geometry.channelCount !== request.channelCount
		|| geometry.bitrateKbps !== bitrateKbps || geometry.mpegFrameCount !== mpegFrameCount
		|| geometry.frameCount !== mpegFrameCount * 1_152 || geometry.gapless !== 'none'
		|| geometry.encoderDelay !== 0 || geometry.endPadding !== 0) fail();
}

/**
 * A constant-rate request pins every frame to the requested rate, and so does
 * the Excessive preset, which is LAME's constant 320 kbps. The average, variable
 * and remaining preset strategies vary the rate per frame, so the parser reports
 * null whenever the frames differ; either way the rate stays inside MPEG-1
 * Layer III's table.
 */
function admittedMp3Bitrate(
	bitrateKbps: number | null,
	request: DedicatedAudioEncodeRequest,
): boolean {
	if (Object.hasOwn(request.settings, 'bitrateKbps')) {
		return bitrateKbps === request.settings.bitrateKbps;
	}
	if (request.settings.preset === 0) return bitrateKbps === 320;
	return bitrateKbps === null || bitrateKbps >= 32 && bitrateKbps <= 320;
}

function sameGeometry(
	geometry: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>,
	request: DedicatedAudioEncodeRequest,
): boolean {
	return geometry.frameCount === request.frameCount
		&& geometry.channelCount === request.channelCount
		&& geometry.sampleRate === request.sampleRate;
}

function fail(): never {
	throw new Error('The reviewed codec returned a file outside its requested profile.');
}
