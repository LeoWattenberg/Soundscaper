/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudioEditorLabels } from '../src/common/editor/label-io.js';

test('SubRip byte import accepts a normal Western ANSI caption from Subtitle Edit', () => {
	const bytes = Buffer.from('1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n\r\n', 'latin1');
	const before = new Uint8Array(bytes);
	const imported = parseAudioEditorLabels(bytes, { filename: 'western-captions.srt', sampleRate: 48_000 });
	assert.equal(imported.labels.length, 1);
	assert.equal(imported.labels[0]!.title, 'Élodie au café');
	assert.equal(imported.labels[0]!.startFrame, 4_800);
	assert.equal(imported.labels[0]!.endFrame, 24_000);
	assert.deepEqual(imported.warnings, []);
	assert.deepEqual(new Uint8Array(bytes), before);
});

test('SubRip keeps valid UTF-8 text and decodes only the supplied byte window', () => {
	const text = '1\n00:00:00,100 --> 00:00:00,500\nÉlodie 🎵\n';
	const wrapped = Buffer.concat([Buffer.from('ignored'), Buffer.from(text), Buffer.from('ignored')]);
	const bytes = wrapped.subarray(7, wrapped.length - 7);
	const imported = parseAudioEditorLabels(bytes, { format: '.SRT' });
	assert.equal(imported.labels[0]!.title, 'Élodie 🎵');
	assert.equal(imported.labels.length, 1);
});

test('legacy SubRip decoding does not change explicit WebVTT or Audacity TXT UTF-8 admission', () => {
	const subtitle = Buffer.from('1\n00:00:00,100 --> 00:00:00,500\nÉlodie\n', 'latin1');
	const vtt = Buffer.from('WEBVTT\n\n00:00:00.100 --> 00:00:00.500\nÉlodie\n', 'latin1');
	const txt = Buffer.from('0.1\t0.5\tÉlodie\n', 'latin1');
	for (const [bytes, options] of [
		[subtitle, { format: 'vtt', filename: 'captions.srt' }],
		[vtt, { filename: 'captions.vtt' }],
		[txt, { filename: 'labels.txt' }],
	] as const) {
		assert.throws(() => parseAudioEditorLabels(bytes, options), { code: 'INVALID_UTF8' });
	}
});
