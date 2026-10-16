/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudioEditorCueSheet } from '../src/common/editor/cue-import.ts';

// K3b's rip writer emits both quoted fields whenever either CD-text field is set.
const unnamedCueProgramme = 'REM Cue file written by K3b\n\nPERFORMER "Presenter"\nTITLE ""\nFILE "Programme.wav" WAVE\n  TRACK 01 AUDIO\n    PERFORMER "Presenter"\n    TITLE ""\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    PERFORMER ""\n    TITLE "Interview"\n    INDEX 01 00:00:20\n';

test('a normal CUE sheet without album and first-track names retains its ordinary track fallback', () => {
	const sheet = parseAudioEditorCueSheet(unnamedCueProgramme, { sampleRate: 48_000 });
	assert.equal(sheet.title, '');
	assert.equal(sheet.performer, 'Presenter');
	assert.deepEqual(sheet.cues, [
		{ number: 1, title: 'Track 01', performer: 'Presenter', positionFrame: 0 },
		{ number: 2, title: 'Interview', performer: 'Presenter', positionFrame: 12_800 },
	]);
});

test('ordinary named CUE metadata remains unchanged', () => {
	const sheet = parseAudioEditorCueSheet(unnamedCueProgramme.replaceAll('TITLE ""', 'TITLE "Opening"')
		.replaceAll('PERFORMER ""', 'PERFORMER "Presenter"'), { sampleRate: 48_000 });
	assert.equal(sheet.title, 'Opening');
	assert.equal(sheet.cues[0]?.title, 'Opening');
});
