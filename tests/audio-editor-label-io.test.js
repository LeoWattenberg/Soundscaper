import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDIO_EDITOR_LABEL_FORMATS,
	AudioEditorLabelIoError,
	detectAudioEditorLabelFormat,
	parseAudacityLabelsTxt,
	parseAudioEditorLabels,
	parseSubRipLabels,
	parseWebVttLabels,
	serializeAudacityLabelsTxt,
	serializeAudioEditorLabels,
	serializeSubRipLabels,
	serializeWebVttLabels,
} from '../src/common/editor/label-io.js';

test('label formats are stable and detection honors explicit values, extensions, and content', () => {
	assert.deepEqual(AUDIO_EDITOR_LABEL_FORMATS, ['txt', 'srt', 'vtt']);
	assert.equal(detectAudioEditorLabelFormat({ format: '.VTT', filename: 'wrong.srt' }), 'vtt');
	assert.equal(detectAudioEditorLabelFormat('Captions.SRT'), 'srt');
	assert.equal(detectAudioEditorLabelFormat({ text: '\uFEFFWEBVTT\n\n' }), 'vtt');
	assert.equal(detectAudioEditorLabelFormat({ text: '1\n00:00:01,000 --> 00:00:02,000\nText\n' }), 'srt');
	assert.equal(detectAudioEditorLabelFormat({ text: '0\t1\tText' }), 'txt');
	assert.throws(() => detectAudioEditorLabelFormat({ format: 'csv' }), /Unsupported label format/);
});

test('Audacity TXT imports point and range labels, Unicode, CRLF, and spectral continuations', () => {
	const result = parseAudacityLabelsTxt('\uFEFF0.5\tPunkt\r\n1\t1.25\tGrüße 世界\r\n\\\t80\t12000\r\n', {
		sampleRate: 48_000,
		idFactory: (index) => `imported-${index}`,
		color: 'violet',
	});
	assert.equal(result.format, 'txt');
	assert.deepEqual(result.warnings, []);
	assert.deepEqual(result.labels[0], {
		id: 'imported-0', title: 'Punkt', startFrame: 24_000, endFrame: 24_000, color: 'violet', opaqueExtensions: {},
	});
	assert.deepEqual(result.labels[1], {
		id: 'imported-1', title: 'Grüße 世界', startFrame: 48_000, endFrame: 60_000, color: 'violet',
		opaqueExtensions: { frequencyRange: { minimumFrequency: 80, maximumFrequency: 12_000 } },
	});
	assert.ok(Object.isFrozen(result));
	assert.ok(Object.isFrozen(result.labels[1]));
});

test('Audacity TXT serialization preserves arbitrary-rate frames and safe label data', () => {
	const labels = [{
		id: 'one', title: 'eins\tzehn\nelf', startFrame: 12_345, endFrame: 20_001, color: 'auto',
		opaqueExtensions: { frequencyRange: { minimumFrequency: 100.5, maximumFrequency: 9_999.25 } },
	}, {
		id: 'point', title: '', startFrame: 44_100, endFrame: 44_100, color: 'auto', opaqueExtensions: {},
	}];
	const text = serializeAudacityLabelsTxt(labels, { sampleRate: 44_100 });
	assert.match(text, /eins zehn elf/);
	assert.match(text, /\\\t100\.5\t9999\.25/);
	const roundTrip = parseAudacityLabelsTxt(text, { sampleRate: 44_100 });
	assert.deepEqual(roundTrip.labels.map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })), [
		{ title: 'eins zehn elf', startFrame: 12_345, endFrame: 20_001 },
		{ title: '', startFrame: 44_100, endFrame: 44_100 },
	]);
});

test('TXT validation is fail-fast by default and can report recoverable row warnings', () => {
	assert.throws(
		() => parseAudacityLabelsTxt('not-a-time\tLabel\n'),
		(error) => error instanceof AudioEditorLabelIoError && error.code === 'INVALID_TIME' && error.details.line === 1,
	);
	const result = parseAudacityLabelsTxt('broken\trow\n0.25\tKept\n2\t1\tbackwards\n', {
		sampleRate: 1_000,
		strict: false,
	});
	assert.deepEqual(result.labels.map((label) => label.title), ['Kept']);
	assert.deepEqual(result.warnings.map((warning) => warning.code), ['INVALID_TIME', 'REVERSED_RANGE']);
	assert.throws(
		() => parseAudacityLabelsTxt('\\\t20\t40\n'),
		(error) => error.code === 'ORPHAN_CONTINUATION',
	);
	assert.throws(
		() => parseAudacityLabelsTxt('0\tOne\n\\\tnan\t40\n'),
		(error) => error.code === 'INVALID_CONTINUATION',
	);
	assert.throws(
		() => parseAudacityLabelsTxt('0\tOne\n1\tTwo\n', { idFactory: () => 'same' }),
		(error) => error.code === 'DUPLICATE_LABEL_ID',
	);
});

test('SubRip import handles multiline Unicode cues, long hours, and point labels', () => {
	const input = [
		'7',
		'00:00:01,250 --> 00:00:02,500',
		'Erste Zeile',
		'第二行',
		'',
		'8',
		'27:15:00,001 --> 27:15:00,001',
		'Punkt',
		'',
	].join('\r\n');
	const result = parseSubRipLabels(input, { sampleRate: 1_000 });
	assert.deepEqual(result.labels.map((label) => ({
		title: label.title,
		startFrame: label.startFrame,
		endFrame: label.endFrame,
		cue: label.opaqueExtensions.cueIdentifier,
	})), [
		{ title: 'Erste Zeile\n第二行', startFrame: 1_250, endFrame: 2_500, cue: '7' },
		{ title: 'Punkt', startFrame: 98_100_001, endFrame: 98_100_001, cue: '8' },
	]);
});

test('SubRip serialization uses millisecond rounding and round-trips ranges', () => {
	const text = serializeSubRipLabels([
		{ id: 'a', title: 'Hello\nworld', startFrame: 44_100, endFrame: 110_250 },
		{ id: 'b', title: 'Point', startFrame: 132_300, endFrame: 132_300 },
	], { sampleRate: 44_100, lineEnding: '\r\n', includeBom: true });
	assert.ok(text.startsWith('\uFEFF1\r\n00:00:01,000 --> 00:00:02,500'));
	assert.match(text, /Hello\r\nworld\r\n\r\n2/);
	const parsed = parseAudioEditorLabels(text, { filename: 'captions.srt', sampleRate: 44_100 });
	assert.deepEqual(parsed.labels.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [
		[44_100, 110_250], [132_300, 132_300],
	]);
});

test('WebVTT import supports cue identifiers, settings, hourless timestamps, and metadata blocks', () => {
	const input = [
		'WEBVTT Kind: captions',
		'',
		'NOTE generated fixture',
		'ignored note',
		'',
		'intro',
		'00:01.250 --> 00:02.500 align:start position:10%',
		'Äöü',
		'',
		'01:02:03.004 --> 01:02:03.004',
		'Point',
		'',
	].join('\n');
	const result = parseWebVttLabels(input, { sampleRate: 1_000 });
	assert.equal(result.labels.length, 2);
	assert.deepEqual(result.labels[0], {
		id: 'label-1', title: 'Äöü', startFrame: 1_250, endFrame: 2_500, color: 'auto',
		opaqueExtensions: { cueIdentifier: 'intro' },
	});
	assert.deepEqual([result.labels[1].startFrame, result.labels[1].endFrame], [3_723_004, 3_723_004]);
	assert.throws(
		() => parseWebVttLabels('00:00.000 --> 00:01.000\nNo header\n'),
		(error) => error.code === 'MISSING_WEBVTT_HEADER',
	);
});

test('WebVTT serialization emits a valid header and preserves cue identifiers', () => {
	const text = serializeWebVttLabels([{
		id: 'label-a', title: 'Caption', startFrame: 30_000, endFrame: 60_000,
		opaqueExtensions: { cueIdentifier: 'custom-id' },
	}], { sampleRate: 30_000 });
	assert.equal(text, 'WEBVTT\n\ncustom-id\n00:00:01.000 --> 00:00:02.000\nCaption\n');
	const generatedIds = serializeAudioEditorLabels([
		{ title: 'One', startFrame: 0, endFrame: 1_000 },
	], { format: 'vtt', sampleRate: 1_000 });
	assert.match(generatedIds, /\n1\n00:00:00\.000 -->/);
	assert.equal(serializeWebVttLabels([]), 'WEBVTT\n\n');
	assert.match(serializeSubRipLabels([
		{ title: 'Required ID', startFrame: 0, endFrame: 1_000 },
	], { sampleRate: 1_000, includeCueIdentifiers: false }), /^1\n/);
});

test('label I/O enforces encoding, count, title, range, and input limits', () => {
	assert.throws(
		() => parseAudioEditorLabels(new Uint8Array([0xC3, 0x28]), { format: 'txt' }),
		(error) => error.code === 'INVALID_UTF8',
	);
	assert.throws(
		() => parseAudacityLabelsTxt('0\tOne\n1\tTwo\n', { maxLabels: 1 }),
		(error) => error.code === 'LABEL_COUNT_LIMIT',
	);
	assert.throws(
		() => parseAudacityLabelsTxt('0\tLong\n', { maxTitleChars: 3 }),
		(error) => error.code === 'TITLE_LIMIT',
	);
	assert.throws(
		() => parseAudacityLabelsTxt('0\tOne\n', { maxInputChars: 3 }),
		(error) => error.code === 'INPUT_LIMIT',
	);
	assert.throws(
		() => serializeAudioEditorLabels([{ title: 'bad', startFrame: 2, endFrame: 1 }], { format: 'txt' }),
		(error) => error.code === 'REVERSED_RANGE',
	);
	assert.throws(
		() => serializeAudioEditorLabels([{ title: 'bad\0title', startFrame: 0 }], { format: 'txt' }),
		(error) => error.code === 'INVALID_CHARACTER',
	);
});
