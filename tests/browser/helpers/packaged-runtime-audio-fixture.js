/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute } from 'node:path';

const SAMPLE_RATE = 48_000;
const SAMPLE_COUNT = SAMPLE_RATE;
const SAMPLE_BYTES = 2;

export function createPackagedRuntimeAudioWave() {
	const dataLength = SAMPLE_COUNT * SAMPLE_BYTES;
	const wave = Buffer.alloc(44 + dataLength);
	wave.write('RIFF', 0, 'ascii');
	wave.writeUInt32LE(36 + dataLength, 4);
	wave.write('WAVE', 8, 'ascii');
	wave.write('fmt ', 12, 'ascii');
	wave.writeUInt32LE(16, 16);
	wave.writeUInt16LE(1, 20);
	wave.writeUInt16LE(1, 22);
	wave.writeUInt32LE(SAMPLE_RATE, 24);
	wave.writeUInt32LE(SAMPLE_RATE * SAMPLE_BYTES, 28);
	wave.writeUInt16LE(SAMPLE_BYTES, 32);
	wave.writeUInt16LE(16, 34);
	wave.write('data', 36, 'ascii');
	wave.writeUInt32LE(dataLength, 40);
	for (let index = 0; index < SAMPLE_COUNT; index += 1) {
		const sample = Math.sin(2 * Math.PI * 440 * index / SAMPLE_RATE) * 0.25;
		wave.writeInt16LE(Math.round(sample * 32_767), 44 + index * SAMPLE_BYTES);
	}
	return wave;
}

export function packagedRuntimeAudioArguments(wavePath) {
	if (typeof wavePath !== 'string' || !isAbsolute(wavePath)) {
		throw new TypeError('Packaged runtime audio fixture path must be absolute.');
	}
	return Object.freeze([
		'--use-fake-device-for-media-stream',
		`--use-file-for-fake-audio-capture=${wavePath}`,
	]);
}
