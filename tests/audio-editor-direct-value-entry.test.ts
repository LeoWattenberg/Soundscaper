/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimeText } from '../vendor/audacity-design-system/components/src/TimeCode/time-code-text.ts';
import { formatTimeToSegments, segmentsToSeconds } from '../vendor/audacity-design-system/components/src/TimeCode/time-code-segments.ts';
import { normalizeAudioEditorTimeDisplayFormat } from '../src/common/editor/time-display-preferences.ts';
import { parseManualValue } from '../vendor/audacity-design-system/components/src/ManualValueDialog/manual-value.ts';

test('direct time entry accepts upstream seconds, colon fields, units and decimal commas', () => {
	for (const [text, expected] of [['37.909', 37.909], ['1:02,5', 62.5], ['1:02:03', 3723], ['1d2h3m4.5s', 93784.5], ['2m3.5s', 123.5]] as const) {
		assert.equal(parseTimeText(text, 'hh:mm:ss'), expected);
	}
	assert.equal(parseTimeText('48000', 'samples', 48000), 1);
	assert.equal(parseTimeText('2s', 'samples', 48000), 2);
});

test('direct time and numeric entry reject malformed or nonfinite values', () => {
	for (const text of ['', '-1', 'oops', '1:2:3:4:5', '1s2m', 'Infinity']) assert.equal(parseTimeText(text, 'hh:mm:ss'), null);
	for (const text of ['', '1.2.3', 'abc', 'Infinity']) assert.equal(parseManualValue(text), null);
	assert.equal(parseManualValue('0,875'), 0.875);
	assert.equal(parseManualValue('-12 dB'), -12);
	assert.equal(parseManualValue('75 %'), 75);
});


test('minutes and milliseconds format displays unbounded minutes and persists through preferences', () => {
	assert.equal(normalizeAudioEditorTimeDisplayFormat('mm:ss+milliseconds'), 'mm:ss+milliseconds');
	const segments = formatTimeToSegments(3723.5, 'mm:ss+milliseconds', 48000, 24);
	assert.equal(segments.map(segment => segment.value).join(''), '62m03.500s');
	assert.equal(segmentsToSeconds(segments, 'mm:ss+milliseconds', 48000, 24), 3723.5);
});
