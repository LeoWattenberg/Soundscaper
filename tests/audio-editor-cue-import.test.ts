/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AudioEditorCueImportError,
	parseAudioEditorCueSheet,
} from '../src/common/editor/cue-import.ts';

const CUE = `REM GENRE Rock
PERFORMER "The Example"
TITLE "A Record"
FILE "record.wav" WAVE
  TRACK 01 AUDIO
    TITLE "Opening Theme"
    INDEX 00 00:00:00
    INDEX 01 00:02:00
  TRACK 02 AUDIO
    PERFORMER "A Guest"
    TITLE "Second \u2603"
    INDEX 01 03:04:37
`;

test('CUE import reads AUDIO track titles and converts CD frames to sample frames', () => {
	const parsed = parseAudioEditorCueSheet(CUE, { sampleRate: 48_000 });

	assert.equal(parsed.title, 'A Record');
	assert.equal(parsed.performer, 'The Example');
	assert.deepEqual(parsed.cues, [
		{ number: 1, title: 'Opening Theme', performer: 'The Example', positionFrame: 96_000 },
		{ number: 2, title: 'Second \u2603', performer: 'A Guest', positionFrame: 8_855_680 },
	]);
});

test('CUE import accepts unquoted metadata, ignores non-audio tracks, and supplies track names', () => {
	const parsed = parseAudioEditorCueSheet(`TITLE Demo album
FILE demo.bin BINARY
  TRACK 01 MODE1/2352
    TITLE Data
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    INDEX 01 01:02:03
`, { sampleRate: 44_100 });

	assert.deepEqual(parsed.cues, [{
		number: 2,
		title: 'Track 02',
		performer: '',
		positionFrame: 2_735_964,
	}]);
});

test('CUE import rejects malformed, missing, and multi-file AUDIO indexes', () => {
	assert.throws(
		() => parseAudioEditorCueSheet('TRACK 01 AUDIO\n INDEX 01 00:60:00', { sampleRate: 48_000 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'INVALID_TIMESTAMP',
	);
	assert.throws(
		() => parseAudioEditorCueSheet('TRACK 01 AUDIO\n TITLE "No index"', { sampleRate: 48_000 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'MISSING_INDEX',
	);
	assert.throws(
		() => parseAudioEditorCueSheet(`FILE "a.wav" WAVE
TRACK 01 AUDIO
 INDEX 01 00:00:00
FILE "b.wav" WAVE
TRACK 02 AUDIO
 INDEX 01 00:00:00`, { sampleRate: 48_000 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'MULTI_FILE_UNSUPPORTED',
	);
});

test('CUE import decodes UTF-8 bytes and enforces its admitted cue limit', () => {
	const bytes = new TextEncoder().encode('TRACK 01 AUDIO\n TITLE "Caf\u00e9"\n INDEX 01 00:00:00');
	assert.equal(parseAudioEditorCueSheet(bytes, { sampleRate: 48_000 }).cues[0]?.title, 'Caf\u00e9');
	assert.throws(
		() => parseAudioEditorCueSheet(`${CUE}\nTRACK 03 AUDIO\n INDEX 01 04:00:00`, {
			sampleRate: 48_000,
			maxCues: 2,
		}),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'CUE_LIMIT',
	);
});

test('CUE import refuses timestamps that exceed safe sample-frame positions', () => {
	assert.throws(
		() => parseAudioEditorCueSheet('TRACK 01 AUDIO\n INDEX 01 100000000000:00:00', { sampleRate: 48_000 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'INVALID_TIMESTAMP',
	);
});

test('CUE import accepts a byte view with BOM and CR-only line endings', () => {
	const bytes = new TextEncoder().encode('\uFEFFFILE "album side.wav" WAVE\rTRACK 01 AUDIO\r INDEX 01 00:00:01');
	const padded = new Uint8Array(bytes.length + 4);
	padded.set(bytes, 2);
	assert.deepEqual(parseAudioEditorCueSheet(padded.subarray(2, 2 + bytes.length), { sampleRate: 44_100 }).cues, [
		{ number: 1, title: 'Track 01', performer: '', positionFrame: 588 },
	]);
});

test('CUE import rejects undecodable UTF-8 and embedded NUL input', () => {
	for (const [input, code] of [
		[Uint8Array.of(0xc3, 0x28), 'INVALID_UTF8'],
		['TRACK 01 AUDIO\n TITLE "bad\0name"\n INDEX 01 00:00:00', 'INVALID_CHARACTER'],
	] as const) {
		assert.throws(
			() => parseAudioEditorCueSheet(input, { sampleRate: 48_000 }),
			(error: unknown) => error instanceof AudioEditorCueImportError && error.code === code,
		);
	}
});

test('CUE import rejects duplicate track numbers and repeated INDEX 01 directives', () => {
	assert.throws(
		() => parseAudioEditorCueSheet('TRACK 01 AUDIO\n INDEX 01 00:00:00\nTRACK 01 AUDIO\n INDEX 01 00:01:00', { sampleRate: 48_000 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'INVALID_TRACK'
			&& error.details.line === 3,
	);
	assert.throws(
		() => parseAudioEditorCueSheet('TRACK 01 AUDIO\n INDEX 01 00:00:00\n INDEX 01 00:01:00', { sampleRate: 48_000 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'DUPLICATE_INDEX'
			&& error.details.line === 3,
	);
});

test('CUE import rejects indexes that run backwards across AUDIO tracks', () => {
	assert.throws(
		() => parseAudioEditorCueSheet('TRACK 01 AUDIO\n INDEX 01 00:02:00\nTRACK 02 AUDIO\n INDEX 01 00:01:00', { sampleRate: 48_000 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'NON_CHRONOLOGICAL_INDEX',
	);
});

test('CUE import permits a data file before one audio file but rejects malformed FILE directives', () => {
	const parsed = parseAudioEditorCueSheet('FILE data.bin BINARY\nTRACK 01 MODE1/2352\n INDEX 01 00:00:00\nFILE "album.wav" WAVE\nTRACK 02 AUDIO\n INDEX 01 00:01:00', { sampleRate: 48_000 });
	assert.equal(parsed.cues.length, 1);
	assert.equal(parsed.cues[0]?.number, 2);
	assert.throws(
		() => parseAudioEditorCueSheet('FILE "missing-type.wav"\nTRACK 01 AUDIO\n INDEX 01 00:00:00', { sampleRate: 48_000 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'INVALID_FILE',
	);
});

test('CUE import enforces input and numeric limits before authoring cues', () => {
	assert.throws(
		() => parseAudioEditorCueSheet('TRACK 01 AUDIO\n INDEX 01 00:00:00', { sampleRate: 48_000, maxInputChars: 5 }),
		(error: unknown) => error instanceof AudioEditorCueImportError && error.code === 'INPUT_LIMIT',
	);
	for (const sampleRate of [0, 44_100.5, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => parseAudioEditorCueSheet('', { sampleRate }), RangeError);
	}
});
