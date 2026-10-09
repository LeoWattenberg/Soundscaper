/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isWavFile } from '../src/common/editor/controller/shared/app-helpers.ts';
import { inspectWavContainerSignature, inspectWavForImport } from '../src/common/editor/controller/import/internal/wav-import-routing.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

const recording = Buffer.from((await readFile(new URL('./fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8')).trim(), 'base64');

for (const extension of ['wav', 'BWF']) for (const type of ['', 'application/octet-stream', 'audio/wav']) {
	test(`the actual WAV import route retains ${extension} recorder metadata with ${type || 'unassigned'} MIME`, async () => {
		const file = new File([recording], `production-take.${extension}`, { type });
		const signature = await inspectWavContainerSignature(file, isWavFile);
		const descriptor = await inspectWavForImport(file, isWavFile, inspectWavBlobPcm, signature);
		assert.ok(descriptor);
		assert.equal(descriptor.sampleRate, 48_000);
		assert.equal(descriptor.frameCount, 48_000);
		assert.equal(descriptor.bext?.description, 'Production boom take');
		assert.ok(descriptor.ixml?.rawXml.includes('<SYNC_POINT_LOW>24000</SYNC_POINT_LOW>'));
		assert.ok(descriptor.ixml?.rawXml.includes('<NOTE>Clean boom take</NOTE>'));
	});
}

test('unrelated untyped files keep the ordinary WAV route refusal', async () => {
	const file = new File(['unrelated document'], 'notes.txt');
	assert.equal(await inspectWavContainerSignature(file, isWavFile), null);
	assert.equal(await inspectWavForImport(file, isWavFile, inspectWavBlobPcm, null), null);
});
