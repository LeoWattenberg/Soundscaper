/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	selectFramescaperDesktopImageSequenceProfessionalMedia,
} from '../src/framescaper/editor-native-image-sequence-selection.ts';

test('the candidate picker turns opaque desktop ranges into fresh pathless streams', async () => {
	const body = Uint8Array.from([1, 2, 3, 4, 5]);
	let releases = 0;
	const selected = await selectFramescaperDesktopImageSequenceProfessionalMedia({
		bridge: {
			selectImageSequence: async () => ({
				selectionId: 'a'.repeat(40),
				files: [{ fileId: 'b'.repeat(40), name: 'shot.0001.png', byteLength: body.byteLength }],
			}),
			readImageSequenceFile: async ({ offset, length }: Readonly<{
				offset: number; length: number;
			}>) => body.slice(offset, offset + length),
			releaseImageSequence: async () => { releases += 1; return true; },
		},
		sourceId: 'sequence-source',
		projectBinClipId: 'sequence-bin-clip',
		name: 'Sequence-source',
		frameRate: { num: 24, den: 1 },
		maximumChunkBytes: 2,
	});
	assert.ok(selected);
	assert.deepEqual(Object.keys(selected.files[0]!).sort(), ['byteLength', 'chunks', 'name']);
	for (let pass = 0; pass < 2; pass += 1) {
		const chunks: number[] = [];
		for await (const chunk of selected.files[0]!.chunks()) chunks.push(...chunk);
		assert.deepEqual(chunks, [...body]);
	}
	assert.equal(releases, 1);
});

test('the candidate picker fails closed unless the complete pathless bridge is mounted', async () => {
	await assert.rejects(() => selectFramescaperDesktopImageSequenceProfessionalMedia({
		bridge: {}, sourceId: 'source', projectBinClipId: 'clip', name: 'Sequence',
		frameRate: { num: 24, den: 1 },
	}), /pathless desktop image-sequence bridge/u);
});
