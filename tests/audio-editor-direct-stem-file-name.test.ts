/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isFlatStemFileName } from '../src/common/editor/controller/export/internal/direct/direct-stem-file-name.ts';

test('direct stem names preserve case-insensitive suffix and flat printable name admission', () => {
	for (const name of ['take.wav', 'TAKE.WAV', ' take.wav', 'épisode.wav', 'take.final.wav']) {
		assert.equal(isFlatStemFileName(name, '.wav'), true, name);
	}
	for (const name of ['', '.wav', '.', '..', 'take.mp3', 'take.wav ', '/take.wav', 'folder\\take.wav', 'take\0.wav', 'take\n.wav', 'take\x7f.wav']) {
		assert.equal(isFlatStemFileName(name, '.wav'), false, name);
	}
});
