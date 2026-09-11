/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAssistanceVisualFramePackV2 } from '../../../src/common/editor/assistance/visual-frame-pack-v2.ts';

const HASHES = Object.freeze({
	'jfk.wav': '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e',
	'astronaut.png': '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5',
	'chelsea.png': '596aa1e7cb875eb79f437e310381d26b338a81c2da23439704a73c4651e8c4bb',
});

export function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function authenticatedFixture(name) {
	const bytes = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
	assert.equal(digest(bytes), HASHES[name], `The licensed ${name} fixture changed.`);
	return bytes;
}

export function encodeFloatWave(samples, sampleRate) {
	const bytes = Buffer.alloc(44 + samples.length * 4);
	bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 4, 28);
	bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(32, 34); bytes.write('data', 36);
	bytes.writeUInt32LE(samples.length * 4, 40);
	for (const [index, sample] of samples.entries()) bytes.writeFloatLE(sample, 44 + index * 4);
	return bytes;
}

export async function loadSpeechFixture(noisy) {
	const wav = await authenticatedFixture('jfk.wav');
	assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
	let pcm;
	for (let offset = 12; offset + 8 <= wav.length;) {
		const size = wav.readUInt32LE(offset + 4);
		const name = wav.toString('ascii', offset, offset + 4);
		if (name === 'fmt ') {
			assert.equal(wav.readUInt16LE(offset + 8), 1);
			assert.equal(wav.readUInt16LE(offset + 10), 1);
			assert.equal(wav.readUInt32LE(offset + 12), 16_000);
			assert.equal(wav.readUInt16LE(offset + 22), 16);
		}
		if (name === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size);
		offset += 8 + size + (size % 2);
	}
	assert.ok(pcm?.length > 160_000);
	const mono = new Float32Array(pcm.length / 2 + 32_000);
	for (let i = 0; i < pcm.length / 2; i += 1) mono[i + 16_000] = pcm.readInt16LE(i * 2) / 32768;
	const sampleRate = noisy ? 48_000 : 16_000;
	const samples = noisy ? new Float32Array(mono.length * 3) : mono;
	let seed = 0x51a7;
	if (noisy) for (let i = 0; i < samples.length; i += 1) {
		const position = i / 3;
		const left = Math.floor(position);
		const fraction = position - left;
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const hiss = (seed / 0x1_0000_0000 * 2 - 1) * 0.035;
		samples[i] = mono[left] * (1 - fraction) + mono[Math.min(left + 1, mono.length - 1)] * fraction + hiss;
	}
	return { bytes: encodeFloatWave(samples, sampleRate), role: 'audio', mediaType: 'audio/wav', sampleRate, frameCount: samples.length };
}

export async function prepareModelInput(fixtureId, page) {
	if (fixtureId === 'speech-16khz') return loadSpeechFixture(false);
	if (fixtureId === 'noisy-speech-48khz') return loadSpeechFixture(true);
	if (fixtureId === 'transcript-text') return {
		bytes: Buffer.from('A speaker explains how to restore a noisy recording and find the spoken words.'),
		role: 'text', mediaType: 'text/plain', frameCount: 1,
	};
	assert.ok(['visual-subject-frames', 'visual-text-frames'].includes(fixtureId), `Unknown fixture ${fixtureId}`);
	const photos = fixtureId === 'visual-subject-frames'
		? await Promise.all(['astronaut.png', 'chelsea.png'].map(async (name) => (await authenticatedFixture(name)).toString('base64')))
		: [null];
	const rasters = await page.evaluate(async (sources) => {
		const canvas = document.createElement('canvas');
		canvas.width = 512; canvas.height = 512;
		const context = canvas.getContext('2d');
		const frames = [];
		for (const base64 of sources) {
			context.fillStyle = 'white'; context.fillRect(0, 0, 512, 512);
			if (base64) {
				const image = new Image();
				image.src = `data:image/png;base64,${base64}`;
				await image.decode();
				const scale = Math.min(512 / image.naturalWidth, 512 / image.naturalHeight);
				const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
				context.drawImage(image, (512 - width) / 2, (512 - height) / 2, width, height);
			} else {
				context.fillStyle = 'black'; context.font = 'bold 54px sans-serif';
				context.fillText('LOCAL MODEL', 35, 200);
				context.fillText('TEST', 175, 280);
			}
			frames.push(Array.from(context.getImageData(0, 0, 512, 512).data));
		}
		return frames;
	}, photos);
	const frames = rasters.map((pixels, index) => ({ sourceFrame: index, presentationTick: String(index), rgba: Uint8Array.from(pixels) }));
	const authority = { width: 512, height: 512, timescale: 30,
		frames: frames.map(({ sourceFrame, presentationTick }) => ({ sourceFrame, presentationTick })) };
	const chunks = createAssistanceVisualFramePackV2({ sourceWidth: 512, sourceHeight: 512,
		rasterWidth: 512, rasterHeight: 512, timescale: 30, frames });
	return { bytes: Buffer.concat(chunks), role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack', frameCount: frames.length, authority };
}
