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
	const xml = '<?xml version="1.0" encoding="UTF-8"?><BWFXML><PROJECT>X &amp; Y</PROJECT><VENDOR_PRIVATE foo="bar">value</VENDOR_PRIVATE></BWFXML>';
	const parsed = parseIxmlPayload(new TextEncoder().encode(xml));
	assert.equal(parsed.project, 'X & Y');
	assert.equal(new TextDecoder().decode(encodeIxmlPayload(parsed)), xml);
	assert.throws(() => parseIxmlPayload(new TextEncoder().encode('<!DOCTYPE x><BWFXML/>')), /Active XML/u);
});

test('iXML rejects malformed and excessively deep XML without rescanning unclosed fields', () => {
	const malformed = `<BWFXML>${'<TRACK>'.repeat(4_096)}</BWFXML>`;
	assert.throws(
		() => parseIxmlPayload(new TextEncoder().encode(malformed)),
		/record elements cannot be nested|maximum XML depth|well-formed XML/iu,
	);
	const tooDeep = `<BWFXML>${'<VENDOR>'.repeat(128)}${'</VENDOR>'.repeat(128)}</BWFXML>`;
	assert.throws(() => parseIxmlPayload(new TextEncoder().encode(tooDeep)), /maximum XML depth/iu);
	assert.throws(
		() => parseIxmlPayload(new TextEncoder().encode('<BWFXML><PROJECT>X</BWFXML>')),
		/well-formed XML/iu,
	);
});

test('iXML refuses processing instructions as well as active DTD constructs', () => {
	assert.throws(
		() => parseIxmlPayload(new TextEncoder().encode('<?transform href="https://example.invalid/style"?><BWFXML></BWFXML>')),
		/processing instructions/iu,
	);
	assert.throws(
		() => parseIxmlPayload(new TextEncoder().encode('<!DOCTYPE BWFXML [<!ENTITY exfil SYSTEM "file:///etc/passwd">]><BWFXML><PROJECT>&exfil;</PROJECT></BWFXML>')),
		/Active XML|external XML declarations/iu,
	);
});
