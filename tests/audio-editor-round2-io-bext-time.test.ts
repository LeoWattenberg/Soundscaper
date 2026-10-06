/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBextMetadata } from '../src/common/editor/broadcast-wave.ts';
import { normalizeBextMetadataEditorValue } from '../src/common/editor/ui/bext-metadata-editor-model.ts';

test('the BEXT editor conforms a native whole-minute time to the file field', () => {
	for (const [input, expected] of [['00:00', '00:00:00'], ['12:34', '12:34:00'], ['23:59', '23:59:00'], ['12:34:56', '12:34:56'], ['', '']]) {
		const draft = normalizeBextMetadataEditorValue({ originationTime: input, timeReference: '0' });
		assert.equal(draft.originationTime, expected);
		assert.equal(normalizeBextMetadata(draft).originationTime, expected);
	}
});

test('the BEXT editor preserves invalid clock text for strict domain validation', () => {
	for (const input of ['24:00', '12:60', '2:34', 'not a time']) {
		const draft = normalizeBextMetadataEditorValue({ originationTime: input, timeReference: '0' });
		assert.equal(draft.originationTime, input);
		assert.throws(() => normalizeBextMetadata(draft), /origination time/u);
	}
});
