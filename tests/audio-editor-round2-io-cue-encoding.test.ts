/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAudioEditorCueSheet } from '../src/common/editor/cue-import.ts';

const SHEET = 'TITLE "Frühlingskonzert"\r\nPERFORMER "René Müller"\r\nFILE "concert.wav" WAVE\r\n  TRACK 01 AUDIO\r\n    TITLE "Ouvertüre"\r\n    INDEX 01 00:00:00\r\n  TRACK 02 AUDIO\r\n    TITLE "Straße zum Café"\r\n    INDEX 01 00:01:00\r\n';

test('the ordinary CUE file route accepts the Windows encoding used by CUETools', () => {
	const cue = parseAudioEditorCueSheet(Uint8Array.from(Buffer.from(SHEET, 'latin1')), {
		sampleRate: 48_000, legacyTextEncoding: 'windows-1252',
	});
	assert.equal(cue.title, 'Frühlingskonzert');
	assert.deepEqual(cue.cues.map(({ title, performer, positionFrame }) => ({ title, performer, positionFrame })), [
		{ title: 'Ouvertüre', performer: 'René Müller', positionFrame: 0 },
		{ title: 'Straße zum Café', performer: 'René Müller', positionFrame: 48_000 },
	]);
});

test('CUE file legacy fallback leaves valid Unicode text and byte-view boundaries intact', () => {
	const sheet = 'TITLE "東京の録音"\nTRACK 01 AUDIO\n TITLE "Café"\n INDEX 01 00:00:01';
	const encoded = new TextEncoder().encode(sheet);
	const padded = new Uint8Array(encoded.length + 4).fill(0xff);
	padded.set(encoded, 2);
	const parsed = parseAudioEditorCueSheet(padded.subarray(2, 2 + encoded.length), {
		sampleRate: 44_100, legacyTextEncoding: 'windows-1252',
	});
	assert.equal(parsed.title, '東京の録音');
	assert.equal(parsed.cues[0]?.title, 'Café');
	assert.equal(parsed.cues[0]?.positionFrame, 588);
});
