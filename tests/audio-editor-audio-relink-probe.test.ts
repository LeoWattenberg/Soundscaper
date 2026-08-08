/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeAiff } from '../src/common/editor/aiff.js';
import { admitChangedContentAudioCandidate } from '../src/common/editor/controller/audio-relink-probe.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const SOURCE = Object.freeze({
	mimeType: 'audio/wav',
	frameCount: 4,
	channelCount: 2,
	sampleRate: 48_000,
	originalSampleRate: 48_000,
});

test('changed-content audio probe admits maintained WAV and AIFF with exact canonical geometry', async () => {
	const channels = [
		Float32Array.of(0.1, 0.2, 0.3, 0.4),
		Float32Array.of(-0.1, -0.2, -0.3, -0.4),
	];
	const wav = file(encodeWav(channels, {
		sampleRate: SOURCE.sampleRate, bitDepth: 24, dither: 'none',
	}), 'replacement.wav', 'audio/wav');
	const aiff = file(encodeAiff(channels, {
		sampleRate: SOURCE.sampleRate, bitDepth: 24, dither: 'none',
	}), 'replacement.aiff', 'audio/aiff');

	await admitChangedContentAudioCandidate(wav, SOURCE);
	await admitChangedContentAudioCandidate(aiff, { ...SOURCE, mimeType: 'audio/aiff' });
});

test('changed-content audio probe rejects frame, channel, and sample-rate drift', async () => {
	const cases = [
		{
			file: wavFile([new Float32Array(3), new Float32Array(3)], 48_000),
			message: /frame count/iu,
		},
		{
			file: wavFile([new Float32Array(4)], 48_000),
			message: /channel count/iu,
		},
		{
			file: wavFile([new Float32Array(4), new Float32Array(4)], 44_100),
			message: /sample rate/iu,
		},
	];
	for (const fixture of cases) {
		await assert.rejects(
			admitChangedContentAudioCandidate(fixture.file, SOURCE),
			fixture.message,
		);
	}
});

test('changed-content audio probe preserves the maintained container identity', async () => {
	const wav = wavFile([new Float32Array(4), new Float32Array(4)], 48_000);
	const wrongMime = file(new Uint8Array(await wav.arrayBuffer()), 'replacement.aiff', 'audio/aiff');
	const wrongName = file(new Uint8Array(await wav.arrayBuffer()), 'replacement.mp3', 'audio/wav');

	await assert.rejects(admitChangedContentAudioCandidate(wrongMime, SOURCE), /MIME type/iu);
	await assert.rejects(admitChangedContentAudioCandidate(wrongName, SOURCE), /file identity/iu);
});

test('changed-content audio probe preserves cancellation', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel changed-content audio probe');
	controller.abort(reason);

	await assert.rejects(
		admitChangedContentAudioCandidate(
			wavFile([new Float32Array(4), new Float32Array(4)], 48_000),
			SOURCE,
			{ signal: controller.signal },
		),
		(error) => error === reason,
	);
});

function wavFile(channels: readonly Float32Array[], sampleRate: number): File {
	return file(encodeWav(channels, { sampleRate, float: true, dither: 'none' }), 'replacement.wav', 'audio/wav');
}

function file(bytes: Uint8Array, name: string, type: string): File {
	return new File([bytes], name, { type });
}
