/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeIxmlPayload, parseIxmlPayload } from '../src/common/editor/ixml.ts';

test('iXML production metadata round-trips tracks, file family, timecode, and sync points', () => {
	const parsed = parseIxmlPayload(encodeIxmlPayload({ project: 'Drama', scene: '12A', take: '3', circled: true, timecodeRate: '25', timecodeFlag: 'NDF', fileSetId: 'family', tracks: [{ channelIndex: 1, name: 'Boom', function: 'DIALOG' }], syncPoints: [{ type: 'RELATIVE', sampleCount: '9007199254740993', function: 'SLATE_GENERIC' }] }));
	assert.equal(parsed.project, 'Drama');
	assert.deepEqual(parsed.tracks, [{ channelIndex: 1, name: 'Boom', function: 'DIALOG' }]);
	assert.equal(parsed.syncPoints[0].sampleCount, '9007199254740993');
});

test('iXML preserves safe unknown extensions through its bounded raw representation', () => {
	const xml = '<BWFXML><PROJECT>X</PROJECT><VENDOR_PRIVATE foo="bar">value</VENDOR_PRIVATE></BWFXML>';
	const parsed = parseIxmlPayload(new TextEncoder().encode(xml));
	assert.equal(new TextDecoder().decode(encodeIxmlPayload(parsed)), xml);
	assert.throws(() => parseIxmlPayload(new TextEncoder().encode('<!DOCTYPE x><BWFXML/>')), /Active XML/u);
});
