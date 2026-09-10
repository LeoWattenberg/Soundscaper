/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimeCode, timeCodeFormatOptionsForDomain, type TimeCodeFormat } from
	'../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';

import { timeCodeFrameFormat, timeCodeFrameSeconds, timeCodeLabelledFrameCount } from
	'../vendor/audacity-design-system/components/src/TimeCode/time-code-frames.ts';

function digits(value: number, format: TimeCodeFormat): string {
	const markup = renderToStaticMarkup(<TimeCode value={value} format={format} />);
	return [...markup.matchAll(/class="timecode-digit[^"]*"[^>]*>(\d)<\/span>/gu)]
		.map((match) => match[1]).join('');
}

test('time displays offer CDDA timecode and total frames independently of snap', () => {
	const options = timeCodeFormatOptionsForDomain('time');
	assert.ok(options.some(({ format, label }) => format === 'hh:mm:ss+cdda-frames' && label.includes('75 fps')));
	assert.ok(options.some(({ format, label }) => format === 'cdda-frames' && label.includes('75 fps')));
});

test('CDDA displays preserve exact frame boundaries and roll over at 75 frames', () => {
	assert.equal(digits(1 / 75, 'hh:mm:ss+cdda-frames'), '00000001');
	assert.equal(digits(74 / 75, 'hh:mm:ss+cdda-frames'), '00000074');
	assert.equal(digits(75 / 75, 'hh:mm:ss+cdda-frames'), '00000100');
	assert.equal(digits(76 / 75, 'hh:mm:ss+cdda-frames'), '00000101');
	assert.equal(digits(4_501 / 75, 'hh:mm:ss+cdda-frames'), '00010001');
	assert.equal(digits(270_001 / 75, 'hh:mm:ss+cdda-frames'), '01000001');
	assert.equal(digits(76 / 75, 'cdda-frames'), '76');
	assert.equal(digits(76 / 75 - 1 / 44_100, 'cdda-frames'), '75');
});

test('existing frame displays retain their rate and label configurable frame rates accurately', () => {
	assert.equal(digits(25 / 24, 'hh:mm:ss+frames'), '00000101');
	assert.equal(digits(25 / 24, 'film-frames'), '25');
	const options = timeCodeFormatOptionsForDomain('time', 30);
	assert.equal(options.find(({ format }) => format === 'hh:mm:ss+frames')?.label,
		'hh:mm:ss + frames (30fps)');
	assert.equal(options.find(({ format }) => format === 'cdda-frames')?.label,
		'CDDA frames (75 fps)');
});

test('frame choices are grouped into Video frames and CD frames submenus', () => {
	const options = timeCodeFormatOptionsForDomain('time');
	for (const format of ['hh:mm:ss+frames', 'film-frames', 'hh:mm:ss+ntsc-frames',
		'hh:mm:ss+ntsc-drop-frames', 'ntsc-frames', 'hh:mm:ss+pal-frames', 'pal-frames']) {
		assert.equal(options.find((option) => option.format === format)?.group, 'Video frames');
	}
	assert.equal(options.find(({ format }) => format === 'cdda-frames')?.group, 'CD frames');
	assert.equal(options.find(({ format }) => format === 'hh:mm:ss+cdda-frames')?.group, 'CD frames');
});

test('PAL, NTSC and NTSC drop-frame clocks count their own frames', () => {
	assert.equal(digits(26 / 25, 'hh:mm:ss+pal-frames'), '00000101');
	assert.equal(digits(26 / 25, 'pal-frames'), '26');
	assert.equal(digits(1_800 * 1_001 / 30_000, 'ntsc-frames'), '1800');
	assert.equal(digits(1_800 * 1_001 / 30_000, 'hh:mm:ss+ntsc-frames'), '00010000');
	assert.equal(digits(1_799 * 1_001 / 30_000, 'hh:mm:ss+ntsc-drop-frames'), '00005929');
	assert.equal(digits(1_800 * 1_001 / 30_000, 'hh:mm:ss+ntsc-drop-frames'), '00010002');
	assert.equal(digits(17_982 * 1_001 / 30_000, 'hh:mm:ss+ntsc-drop-frames'), '00100000');
	assert.equal(digits(107_892 * 1_001 / 30_000, 'hh:mm:ss+ntsc-drop-frames'), '01000000');
});

test('NTSC displays recover a chosen frame rounded to its nearest project sample', () => {
	const frame2Seconds = Math.round(2 * 48_000 * 1_001 / 30_000) / 48_000;
	const markup = renderToStaticMarkup(<TimeCode value={frame2Seconds} format="ntsc-frames" sampleRate={48_000} />);
	assert.match(markup, /class="timecode-digit[^>]*>2<\/span>/u);
});

test('frame edits round-trip at minute, ten-minute and hour boundaries', () => {
	for (const option of timeCodeFormatOptionsForDomain('time')) {
		const format = timeCodeFrameFormat(option.format, 24);
		if (!format) continue;
		for (const count of [0, 1, 29, 30, 74, 75, 1_799, 1_800, 17_982, 107_892]) {
			const labelled = timeCodeLabelledFrameCount(count, format);
			const seconds = Math.floor(labelled / format.nominalRate);
			const units: readonly number[] = format.total ? [Math.floor(count / 1_000), count % 1_000] : [
				Math.floor(seconds / 3_600), Math.floor(seconds / 60) % 60,
				seconds % 60, labelled % format.nominalRate,
			];
			assert.equal(timeCodeFrameSeconds(units, format), count / format.rate, `${option.format}: ${count}`);
		}
	}
	const drop = timeCodeFrameFormat('hh:mm:ss+ntsc-drop-frames', 24);
	assert.ok(drop);
	assert.equal(timeCodeFrameSeconds([0, 1, 0, 0], drop), 1_800 / drop.rate);
	assert.equal(timeCodeFrameSeconds([0, 1, 0, 1], drop), 1_800 / drop.rate);
	assert.equal(timeCodeFrameSeconds([0, 10, 0, 0], drop), 17_982 / drop.rate);
});
