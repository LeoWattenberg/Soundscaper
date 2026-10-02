/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admitAudioExportBlob,
	prepareAudioExportBlob,
	registerFileBackedExport,
} from '../src/common/editor/audio-export-output.ts';
import { LARGE_AUDIO_FILE_BYTES } from '../src/common/editor/large-audio-policy.ts';

function virtualBlob(size: number): Blob {
	const blob = new Blob([], { type: 'audio/wav' });
	Object.defineProperty(blob, 'size', { value: size });
	Object.defineProperty(blob, 'arrayBuffer', { value: () => { throw new Error('Whole-file read forbidden'); } });
	return blob;
}

test('file-backed audio reaches the exact 1 GB boundary without copying or reading its body', () => {
	const blob = registerFileBackedExport(virtualBlob(LARGE_AUDIO_FILE_BYTES));
	assert.equal(admitAudioExportBlob(blob), blob);
	assert.equal(prepareAudioExportBlob({ blob }), blob);
	assert.throws(() => admitAudioExportBlob(registerFileBackedExport(virtualBlob(LARGE_AUDIO_FILE_BYTES + 1))), /warning threshold|maximum/u);
});

test('large audio admission preserves the smaller whole-buffer budget and rejects unowned output', () => {
	assert.throws(() => admitAudioExportBlob(virtualBlob(LARGE_AUDIO_FILE_BYTES)), /warning threshold|maximum/u);
	assert.throws(() => prepareAudioExportBlob({ blob: {} }), /Blob/u);
	assert.throws(() => prepareAudioExportBlob({}), /encoded output/u);
	assert.throws(() => registerFileBackedExport({} as Blob), /Blob/u);
	const blob = new Blob([Uint8Array.of(1, 2)]);
	assert.equal(prepareAudioExportBlob({ blob }), blob);
	assert.equal(prepareAudioExportBlob({ bytes: Uint8Array.of(1, 2), mimeType: 'audio/mpeg' }).size, 2);
});

test('caller output thresholds and confirmed bounds apply to both storage routes', () => {
	for (const backed of [false, true]) {
		const blob = backed ? registerFileBackedExport(virtualBlob(4)) : virtualBlob(4);
		assert.equal(admitAudioExportBlob(blob, 'Audio export', 4), blob);
		assert.equal(admitAudioExportBlob(blob, 'Audio export', Number.MAX_SAFE_INTEGER), blob);
		assert.throws(() => admitAudioExportBlob(blob, 'Audio export', 3), /warning threshold|maximum/u);
		for (const maximum of [0, -1, 1.5, Infinity, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
			assert.throws(() => admitAudioExportBlob(blob, 'Audio export', maximum), /warning threshold|maximum/u);
		}
	}
});
