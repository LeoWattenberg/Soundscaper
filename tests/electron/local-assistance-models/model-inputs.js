/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAssistanceVisualFramePackV2 } from '../../../src/common/editor/assistance/visual-frame-pack-v2.ts';
import { createAssistanceEditorialGenerationPlanV1 } from '../../../src/common/editor/assistance/editorial-generation-v1.ts';
import { reviewAssistanceFloat32MonoWaveV1 } from '../../../src/common/editor/assistance/float32-mono-wave-v1.ts';
import { createAssistanceFramePackV1 } from '../../../src/common/editor/assistance/binary-formats-v1.ts';

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
	if (fixtureId === 'aligned-speech-16khz') {
		const input = await loadSpeechFixture(false);
		const text = 'And so my fellow Americans ask not what your country can do for you ask what you can do for your country';
		return { ...input, expectedWords: text.split(' '), additionalInputs: [{ role: 'transcript',
			mediaType: 'application/vnd.soundscaper.transcript+json',
			bytes: Buffer.from(JSON.stringify({ language: 'en', segments: [{ startSeconds: 1,
				endSeconds: input.frameCount / input.sampleRate - 1, text }] })),
		}] };
	}
	if (['mixed-speech-44100hz', 'reverberant-speech-44100hz', 'speech-tags-32khz', 'rhythmic-music-22050hz'].includes(fixtureId)) {
		return additionalAudioInput(fixtureId);
	}
	if (fixtureId === 'editorial-candidates') {
		const plan = createAssistanceEditorialGenerationPlanV1([
			{ candidateId: 'restoration', evidenceMode: 'transcript',
				transcriptExcerpt: 'Here is how we restored the old recording and brought the speech back.', visualSummary: null },
			{ candidateId: 'comparison', evidenceMode: 'transcript',
				transcriptExcerpt: 'Listen to the original and the cleaned recording before deciding which sounds better.', visualSummary: null },
		]);
		return { bytes: Buffer.from(JSON.stringify(plan)), role: 'editorial-context',
			mediaType: 'application/vnd.soundscaper.editorial-context+json', frameCount: 1, candidateIds: plan.authorizedCandidateIds };
	}
	if (fixtureId === 'transcript-text') return {
		bytes: Buffer.from('A speaker explains how to restore a noisy recording and find the spoken words.'),
		role: 'text', mediaType: 'text/plain', frameCount: 1,
	};
	assert.ok(['visual-subject-frames', 'visual-text-frames', 'visual-shot-frames'].includes(fixtureId), `Unknown fixture ${fixtureId}`);
	const shots = fixtureId === 'visual-shot-frames';
	const width = shots ? 48 : 512;
	const height = shots ? 27 : 512;
	const photos = fixtureId !== 'visual-text-frames'
		? await Promise.all(['astronaut.png', 'chelsea.png'].map(async (name) => (await authenticatedFixture(name)).toString('base64')))
		: [null];
	const rasters = await page.evaluate(async ({ sources, width, height }) => {
		const canvas = document.createElement('canvas');
		canvas.width = width; canvas.height = height;
		const context = canvas.getContext('2d');
		const frames = [];
		for (const base64 of sources) {
			context.fillStyle = 'white'; context.fillRect(0, 0, width, height);
			if (base64) {
				const image = new Image();
				image.src = `data:image/png;base64,${base64}`;
				await image.decode();
				const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
				const drawnWidth = image.naturalWidth * scale; const drawnHeight = image.naturalHeight * scale;
				context.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
			} else {
				context.fillStyle = 'black'; context.font = 'bold 54px sans-serif';
				context.fillText('LOCAL MODEL', 35, 200);
				context.fillText('TEST', 175, 280);
			}
			frames.push(Array.from(context.getImageData(0, 0, width, height).data));
		}
		return frames;
	}, { sources: photos, width, height });
	const sequence = shots ? Array.from({ length: 120 }, (_, index) => rasters[index < 60 ? 0 : 1]) : rasters;
	const frames = sequence.map((pixels, index) => ({ sourceFrame: index, presentationTick: String(index), rgba: Uint8Array.from(pixels) }));
	const authority = { width, height, timescale: 30,
		frames: frames.map(({ sourceFrame, presentationTick }) => ({ sourceFrame, presentationTick })) };
	const chunks = shots ? createAssistanceFramePackV1({ width, height, timescale: 30, frames })
		: createAssistanceVisualFramePackV2({ sourceWidth: width, sourceHeight: height,
			rasterWidth: width, rasterHeight: height, timescale: 30, frames });
	return { bytes: Buffer.concat(chunks), role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack', frameCount: frames.length, authority };
}

async function additionalAudioInput(fixtureId) {
	const rhythmic = fixtureId === 'rhythmic-music-22050hz';
	const sampleRate = rhythmic ? 22_050 : fixtureId === 'speech-tags-32khz' ? 32_000 : 44_100;
	const original = await loadSpeechFixture(false);
	const speech = reviewAssistanceFloat32MonoWaveV1(original.bytes, original.sampleRate).samples;
	const samples = new Float32Array(rhythmic ? sampleRate * 16 : Math.round(speech.length * sampleRate / original.sampleRate));
	for (let index = 0; index < samples.length; index += 1) {
		const time = index / sampleRate;
		const position = index * original.sampleRate / sampleRate;
		const left = Math.floor(position);
		const fraction = position - left;
		let sample = rhythmic ? 0 : speech[left] * (1 - fraction) + speech[Math.min(left + 1, speech.length - 1)] * fraction;
		if (rhythmic || fixtureId === 'mixed-speech-44100hz') {
			const beatTime = time % 0.5;
			const beat = Math.floor(time * 2);
			const kick = 0.35 * Math.exp(-beatTime * 22) * Math.sin(2 * Math.PI * (55 * beatTime + 3 * (1 - Math.exp(-beatTime * 30))));
			const hat = 0.08 * Math.exp(-(time % 0.25) * 100) * Math.sin(2 * Math.PI * 6_000 * time);
			const chord = 0.035 * Math.sin(2 * Math.PI * [220, 261.6256, 329.6276, 293.6648][Math.floor(beat / 4) % 4] * time);
			sample = sample * 0.65 + kick + hat + chord;
		}
		samples[index] = sample;
	}
	if (fixtureId === 'reverberant-speech-44100hz') {
		const dry = samples.slice();
		for (const [delay, gain] of [[0.07, 0.35], [0.13, 0.22], [0.23, 0.15], [0.37, 0.08]]) {
			const offset = Math.round(delay * sampleRate);
			for (let index = offset; index < samples.length; index += 1) samples[index] += dry[index - offset] * gain;
		}
	}
	return { bytes: encodeFloatWave(samples, sampleRate), role: 'audio', mediaType: 'audio/wav', sampleRate, frameCount: samples.length };
}
