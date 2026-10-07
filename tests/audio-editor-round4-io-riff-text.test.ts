/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { decodeRiffMetadataText, riffMetadataCodePage } from '../src/common/editor/riff-metadata-text.ts';
import { correctImportedRiffMetadata } from '../src/common/editor/riff-imported-metadata.ts';

const recording = Buffer.from(readFileSync(new URL('./fixtures/bwfmetaedit-cp1252-info.wav.base64', import.meta.url), 'utf8').trim(), 'base64');

test('unchanged BWF MetaEdit INFO follows the declared CSET in both import readers', async () => {
	const blob = new Blob([recording], { type: 'audio/wav' });
	const inspected = await inspectImportedMediaMetadata(blob);
	assert.equal(inspected.metadata.normalized?.artist, 'Élodie – field recording');
	assert.equal(inspected.metadata.normalized?.title, 'Straße am Meer');
	assert.equal(inspected.metadata.raw?.IART, 'Élodie – field recording');
	const descriptor = await inspectWavBlobPcm(blob);
	assert.deepEqual(descriptor.info, { artist: 'Élodie – field recording', title: 'Straße am Meer' });
	assert.equal(descriptor.frameCount, 4800);
	assert.equal(descriptor.metadataWarnings.length, 0);
});

test('the editor own UTF8 WAV metadata remains readable without a CSET declaration', async () => {
	const bytes = encodeWav([Float32Array.of(0, 0.25, -0.25, 0)], {
		sampleRate: 48_000, bitDepth: 16, metadata: { title: '東京の記録', artist: 'Élodie' },
	});
	const blob = new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' });
	const inspected = await inspectImportedMediaMetadata(blob);
	assert.equal(inspected.metadata.normalized?.title, '東京の記録');
	assert.equal(inspected.metadata.normalized?.artist, 'Élodie');
	assert.deepEqual((await inspectWavBlobPcm(blob)).info, { title: '東京の記録', artist: 'Élodie' });
});

test('declared encodings win over detection and keep the original byte window', () => {
	const parent = Uint8Array.of(0xff, 0xc9, 0x96, 0, 0xff);
	assert.equal(decodeRiffMetadataText(parent.subarray(1, -1), 1252), 'É–');
	assert.equal(decodeRiffMetadataText(Uint8Array.of(0xc3, 0xa9), 28591), 'Ã©');
	assert.equal(decodeRiffMetadataText(Uint8Array.of(0xe9)), 'é');
	assert.equal(decodeRiffMetadataText(new TextEncoder().encode('東京\0ignored')), '東京');
	assert.equal(decodeRiffMetadataText(Uint8Array.of(0x82, 0xe1), 437), 'éß');
	assert.equal(decodeRiffMetadataText(Uint8Array.of(0x82, 0xd5), 850), 'éı');
	assert.equal(decodeRiffMetadataText(Uint8Array.of(0x82, 0xd5), 858), 'é€');
	assert.equal(decodeRiffMetadataText(Uint8Array.of(0xa1), 28592), 'Ą');
	assert.equal(riffMetadataCodePage(Uint8Array.of(0xe4, 4, 0, 0, 0, 0, 0, 0)), 1252);
	assert.equal(riffMetadataCodePage(Uint8Array.of(4, 0xe4, 0, 0, 0, 0, 0, 0), false), 1252);
});

test('correcting INFO retains independently admitted ID3 text and unrelated tags', async () => {
	const tags = { title: 'Independent ID3 title', artist: 'Élodie \u0096 field recording',
		raw: { INAM: 'Straße am Meer', IART: 'Élodie \u0096 field recording', TXXX: 'custom' }, genre: 'Field' };
	const corrected = await correctImportedRiffMetadata(new Blob([recording]), tags) as Record<string, unknown>;
	assert.equal(corrected.title, tags.title);
	assert.equal(corrected.artist, 'Élodie – field recording');
	assert.equal(corrected.genre, 'Field');
	assert.deepEqual(corrected.raw, { INAM: 'Straße am Meer', IART: 'Élodie – field recording', TXXX: 'custom' });
	assert.equal(tags.artist, 'Élodie \u0096 field recording');
});
