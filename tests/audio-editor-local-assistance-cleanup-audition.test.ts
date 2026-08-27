/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalAssistanceCleanupAuditionWave } from
	'../src/common/editor/ui/local-assistance-cleanup-audition.ts';

test('cleanup audition omits merged checked ranges in a new exact WAV only', async () => {
	const source = wave(Float32Array.from({ length: 10 }, (_, index) => index));
	const audition = await createLocalAssistanceCleanupAuditionWave(source, [
		{ startSeconds: 0.2, endSeconds: 0.4 },
		{ startSeconds: 0.4, endSeconds: 0.5 },
		{ startSeconds: 0.7, endSeconds: 0.8 },
	]);
	assert.notEqual(audition, source);
	assert.equal(source.size, 84);
	assert.equal(audition.size, 68);
	const bytes = new Uint8Array(await audition.arrayBuffer());
	const view = new DataView(bytes.buffer);
	assert.equal(view.getUint32(4, true), 60);
	assert.equal(view.getUint32(40, true), 24);
	assert.deepEqual([...new Float32Array(bytes.buffer, 44)], [0, 1, 5, 6, 8, 9]);
});

test('cleanup audition refuses malformed ranges and complete-wave omission', async () => {
	const source = wave(Float32Array.of(0, 1, 2, 3));
	await assert.rejects(createLocalAssistanceCleanupAuditionWave(source,
		[{ startSeconds: Number.NaN, endSeconds: 1 }]), /range/iu);
	await assert.rejects(createLocalAssistanceCleanupAuditionWave(source,
		[{ startSeconds: 0, endSeconds: 1 }]), /complete/iu);
});

function wave(samples: Float32Array): Blob {
	const header = new ArrayBuffer(44);
	const bytes = new Uint8Array(header);
	const view = new DataView(header);
	write(bytes, 0, 'RIFF');
	view.setUint32(4, 36 + samples.byteLength, true);
	write(bytes, 8, 'WAVE');
	write(bytes, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 3, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 10, true);
	view.setUint32(28, 40, true);
	view.setUint16(32, 4, true);
	view.setUint16(34, 32, true);
	write(bytes, 36, 'data');
	view.setUint32(40, samples.byteLength, true);
	return new Blob([header, samples.slice().buffer], { type: 'audio/wav' });
}

function write(bytes: Uint8Array, offset: number, value: string): void {
	for (const [index, character] of [...value].entries()) {
		bytes[offset + index] = character.charCodeAt(0);
	}
}
