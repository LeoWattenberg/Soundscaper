/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	exportVideoCaptionTrackV1,
	importVideoCaptionTrackV1,
	normalizeVideoCaptionTrackV1,
	VideoCaptionInterchangeError,
	type VideoCaptionInterchangeFormatV1,
	type VideoCaptionTrackV1,
} from '../src/common/editor/video-caption-track-v27.ts';

const IMPORT_IDENTITY = Object.freeze({
	trackId: 'fallback-track',
	sequenceId: 'sequence-main',
	trackName: 'Imported captions',
	language: 'en-GB',
});

function captionTrack(overrides: Partial<VideoCaptionTrackV1> = {}): VideoCaptionTrackV1 {
	return normalizeVideoCaptionTrackV1({
		schemaVersion: 1,
		id: 'captions-en',
		sequenceId: 'sequence-main',
		name: 'English & Welsh',
		language: 'en-GB',
		styles: [{
			schemaVersion: 1,
			id: 'style-dialogue',
			fontFamily: 'soundscaper-sans',
			fontSizePercent: 5,
			foregroundColor: '#fefefeff',
			backgroundColor: '#102030cc',
			fontWeight: 'bold',
			fontStyle: 'italic',
			textDecoration: 'underline',
			textAlign: 'center',
		}],
		regions: [{
			schemaVersion: 1,
			id: 'region-bottom',
			xPercent: 10,
			yPercent: 80,
			widthPercent: 80,
			heightPercent: 15,
			displayAlign: 'after',
		}],
		speakers: [{ schemaVersion: 1, id: 'speaker-alex', name: 'Alex & Jo' }],
		cues: [{
			schemaVersion: 1,
			id: 'cue-1',
			startFrame: 48_000,
			endFrame: 96_000,
			text: 'A <-complete-> sentence.\nNext line.',
			styleId: 'style-dialogue',
			regionId: 'region-bottom',
			speakerId: 'speaker-alex',
			words: [
				{ startFrame: 48_000, endFrame: 52_000, text: 'A' },
				{ startFrame: 52_000, endFrame: 80_000, text: '<-complete->' },
				{ startFrame: 80_000, endFrame: 96_000, text: 'sentence.\nNext line.' },
			],
		}],
		...overrides,
	});
}

test('IMSC 1.1 preserves the complete caption document with exact sample-frame ticks', () => {
	const source = captionTrack();
	const exported = exportVideoCaptionTrackV1(source, { format: 'imsc1.1', sampleRate: 48_000 });
	assert.deepEqual(exported.losses.map((loss) => loss.code), ['sequence-binding-omitted']);
	assert.equal(exported.losses[0]?.path, 'track.sequenceId');
	assert.match(exported.text, /ttp:contentProfiles="http:\/\/www\.w3\.org\/ns\/ttml\/profile\/imsc1\.1\/text"/u);
	assert.match(exported.text, /ttp:tickRate="48000"/u);
	assert.match(exported.text, /begin="48000t" end="96000t"/u);
	assert.match(exported.text, /<span begin="0t" end="4000t">A<\/span>/u);
	assert.doesNotMatch(exported.text, /script|href|src=/iu);

	const imported = importVideoCaptionTrackV1(exported.text, {
		format: 'imsc1.1',
		sampleRate: 48_000,
		...IMPORT_IDENTITY,
	});
	assert.deepEqual(imported.track, source);
	assert.deepEqual(imported.losses, []);
	assert.equal(Object.isFrozen(imported), true);
	assert.equal(Object.isFrozen(imported.losses), true);
});

test('IMSC tick timing remains exact at single-sample boundaries', () => {
	const source = captionTrack({
		styles: [], regions: [], speakers: [],
		cues: [{
			schemaVersion: 1,
			id: 'cue-sample',
			startFrame: 1,
			endFrame: 2,
			text: 'one sample',
			styleId: null,
			regionId: null,
			speakerId: null,
			words: [],
		}],
	});
	const exported = exportVideoCaptionTrackV1(source, { format: 'imsc1.1', sampleRate: 44_100 });
	const imported = importVideoCaptionTrackV1(exported.text, {
		format: 'imsc1.1', sampleRate: 44_100, ...IMPORT_IDENTITY,
	});
	assert.deepEqual(imported.track.cues[0], source.cues[0]);
	assert.deepEqual(exported.losses.map((loss) => loss.code), ['sequence-binding-omitted']);
	assert.deepEqual(imported.losses, []);
});

test('IMSC normalizes non-XML model identities and preserves every reference', () => {
	const source = captionTrack({
		id: '1:track',
		styles: [{ ...captionTrack().styles[0]!, id: '1:style' }],
		regions: [{ ...captionTrack().regions[0]!, id: '1:region' }],
		speakers: [{ ...captionTrack().speakers[0]!, id: '1:speaker' }],
		cues: [{
			...captionTrack().cues[0]!,
			id: '1:cue',
			styleId: '1:style',
			regionId: '1:region',
			speakerId: '1:speaker',
		}],
	});
	const exported = exportVideoCaptionTrackV1(source, { format: 'imsc1.1', sampleRate: 48_000 });
	assert.deepEqual(exported.losses.map((loss) => loss.code), [
		'sequence-binding-omitted',
		'track-identity-normalized',
		'style-identity-normalized',
		'region-identity-normalized',
		'speaker-identity-normalized',
		'cue-identity-normalized',
	]);
	assert.doesNotMatch(exported.text, /xml:id="1:/u);
	const imported = importVideoCaptionTrackV1(exported.text, {
		format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY,
	});
	const cue = imported.track.cues[0]!;
	assert.equal(cue.styleId, imported.track.styles[0]?.id);
	assert.equal(cue.regionId, imported.track.regions[0]?.id);
	assert.equal(cue.speakerId, imported.track.speakers[0]?.id);
});

test('IMSC reports word timing it cannot map into cue text', () => {
	const source = captionTrack({
		cues: [{
			...captionTrack().cues[0]!,
			words: [{ startFrame: 48_000, endFrame: 96_000, text: 'not present' }],
		}],
	});
	const exported = exportVideoCaptionTrackV1(source, { format: 'imsc1.1', sampleRate: 48_000 });
	assert.deepEqual(exported.losses.map((loss) => loss.code), [
		'sequence-binding-omitted', 'word-timing-omitted',
	]);
	assert.equal(exported.losses[1]?.path, 'cues.cue-1.words');
});

test('SRT and WebVTT report every model field their maintained subsets omit', () => {
	const source = captionTrack();
	const expected = {
		srt: [
			'track-metadata-omitted', 'cue-identity-omitted', 'style-omitted',
			'region-omitted', 'speaker-omitted', 'word-timing-omitted',
		],
		webvtt: [
			'track-metadata-omitted', 'style-properties-omitted', 'region-omitted',
			'speaker-identity-omitted', 'word-timing-omitted',
		],
	} as const;
	for (const format of ['srt', 'webvtt'] as const) {
		const exported = exportVideoCaptionTrackV1(source, { format, sampleRate: 48_000 });
		assert.deepEqual(exported.losses.map((loss) => loss.code), expected[format]);
		assert.equal(new Set(exported.losses.map((loss) => loss.path)).size, exported.losses.length);
		assert.match(exported.text, format === 'srt' ? /00:00:01,000 --> 00:00:02,000/u : /WEBVTT\n\ncue-1\n00:00:01\.000 --> 00:00:02\.000/u);
		// WebVTT escapes angle brackets as character references; SRT has no
		// entity syntax so non-markup angle-bracket text stays literal.
		if (format === 'srt') assert.match(exported.text, /<-complete->/u);
		else assert.doesNotMatch(exported.text, /<-complete->/u);
		const imported = importVideoCaptionTrackV1(exported.text, {
			format,
			sampleRate: 48_000,
			...IMPORT_IDENTITY,
		});
		assert.equal(imported.track.cues[0]?.startFrame, 48_000);
		assert.equal(imported.track.cues[0]?.endFrame, 96_000);
		assert.equal(imported.track.cues[0]?.text, source.cues[0]?.text);
	}
});

test('text sidecars report unreferenced definitions instead of silently dropping them', () => {
	const source = captionTrack({ cues: [] });
	for (const format of ['srt', 'webvtt'] as const) {
		const exported = exportVideoCaptionTrackV1(source, { format, sampleRate: 48_000 });
		assert.deepEqual(exported.losses.map((loss) => loss.path), [
			'track.metadata',
			'styles.style-dialogue',
			'regions.region-bottom',
			'speakers.speaker-alex',
		]);
	}
});

test('millisecond sidecars expose deterministic timing quantization as structured loss', () => {
	const source = captionTrack({
		styles: [], regions: [], speakers: [],
		cues: [{
			schemaVersion: 1,
			id: 'cue-fractional',
			startFrame: 1,
			endFrame: 49,
			text: 'fractional',
			styleId: null,
			regionId: null,
			speakerId: null,
			words: [],
		}],
	});
	for (const format of ['srt', 'webvtt'] as const) {
		const exported = exportVideoCaptionTrackV1(source, { format, sampleRate: 48_000 });
		assert.deepEqual(
			exported.losses.filter((loss) => loss.code === 'timing-quantized').map((loss) => loss.path),
			['cues.cue-fractional.startFrame', 'cues.cue-fractional.endFrame'],
		);
		const imported = importVideoCaptionTrackV1(exported.text, {
			format, sampleRate: 44_100, ...IMPORT_IDENTITY,
		});
		assert.deepEqual(imported.track.cues.map(({ startFrame, endFrame }) => ({ startFrame, endFrame })), [
			{ startFrame: 0, endFrame: 44 },
		]);
		assert.deepEqual(imported.losses.map((loss) => loss.code), ['timing-quantized']);
	}
});

test('WebVTT sidecars preserve cue-leading, trailing, and blank lines as passive entities', () => {
	const source = captionTrack({
		styles: [], regions: [], speakers: [],
		cues: [{
			schemaVersion: 1,
			id: 'cue-lines',
			startFrame: 0,
			endFrame: 48_000,
			text: '\nfirst\n\nlast\n',
			styleId: null,
			regionId: null,
			speakerId: null,
			words: [],
		}],
	});
	const exported = exportVideoCaptionTrackV1(source, { format: 'webvtt', sampleRate: 48_000 });
	assert.match(exported.text, /&#10;/u);
	const imported = importVideoCaptionTrackV1(exported.text, {
		format: 'webvtt', sampleRate: 48_000, ...IMPORT_IDENTITY,
	});
	assert.equal(imported.track.cues[0]?.text, source.cues[0]?.text);
});

test('SRT export writes literal plain text and reports unrepresentable line structure', () => {
	// SRT has no entity syntax: a standard player renders '&amp;' and '&#10;'
	// literally on screen, so cue bodies must export verbatim. Blank, leading,
	// and trailing lines terminate an SRT block and are the one structural
	// loss — dropped and reported, never silently entity-encoded.
	const source = captionTrack({
		styles: [], regions: [], speakers: [],
		cues: [{
			schemaVersion: 1,
			id: 'cue-plain',
			startFrame: 0,
			endFrame: 48_000,
			text: 'Tom & Jerry\nEpisode 1',
			styleId: null,
			regionId: null,
			speakerId: null,
			words: [],
		}, {
			schemaVersion: 1,
			id: 'cue-lines',
			startFrame: 48_000,
			endFrame: 96_000,
			text: '\nfirst\n\nlast\n',
			styleId: null,
			regionId: null,
			speakerId: null,
			words: [],
		}],
	});
	const exported = exportVideoCaptionTrackV1(source, { format: 'srt', sampleRate: 48_000 });
	assert.match(exported.text, /Tom & Jerry\nEpisode 1/u);
	assert.doesNotMatch(exported.text, /&amp;|&#10;/u);
	assert.match(exported.text, /first\nlast/u);
	assert.ok(
		exported.losses.some((loss) => loss.code === 'text-lines-normalized'
			&& loss.path === 'cues.cue-lines.text'),
		'the dropped blank and boundary lines are reported',
	);
	assert.ok(
		!exported.losses.some((loss) => loss.code === 'text-lines-normalized'
			&& loss.path === 'cues.cue-plain.text'),
		'an ordinary multi-line cue is lossless',
	);
	const imported = importVideoCaptionTrackV1(exported.text, {
		format: 'srt', sampleRate: 48_000, ...IMPORT_IDENTITY,
	});
	assert.equal(imported.track.cues[0]?.text, 'Tom & Jerry\nEpisode 1');
	assert.equal(imported.track.cues[1]?.text, 'first\nlast');
});

test('SRT import accepts plain-text ampersands and basic styling markup', () => {
	const imported = importVideoCaptionTrackV1(
		'1\n00:00:01,000 --> 00:00:02,000\nAT&T announced today\n\n'
		+ '2\n00:00:02,000 --> 00:00:03,000\n<i>italic aside</i>\n',
		{ format: 'srt', sampleRate: 48_000, ...IMPORT_IDENTITY },
	);
	assert.equal(imported.track.cues[0]?.text, 'AT&T announced today');
	assert.equal(imported.track.cues[0]?.styleId, null);
	assert.equal(imported.track.cues[1]?.text, 'italic aside');
	const styleId = imported.track.cues[1]?.styleId;
	assert.ok(styleId, 'whole-body italics map to a caption style');
	assert.equal(imported.track.styles.find(({ id }) => id === styleId)?.fontStyle, 'italic');
});

test('IMSC import accepts bounded clock time but reports conversion that is not frame exact', () => {
	const xml = minimalImsc('<p xml:id="cue-1" begin="00:00:00.001" end="00:00:00.002">Clock</p>', 1_000);
	const imported = importVideoCaptionTrackV1(xml, {
		format: 'imsc1.1', sampleRate: 44_100, ...IMPORT_IDENTITY,
	});
	assert.deepEqual(imported.track.cues.map(({ startFrame, endFrame }) => ({ startFrame, endFrame })), [
		{ startFrame: 44, endFrame: 88 },
	]);
	assert.deepEqual(imported.losses.map((loss) => loss.code), ['timing-quantized', 'timing-quantized']);
});

test('IMSC word spans resolve relative to their containing cue interval', () => {
	const xml = minimalImsc(
		'<p xml:id="cue-1" begin="48000t" end="96000t">'
		+ '<span begin="0t" end="12000t">Relative</span> timing</p>',
		48_000,
	);
	const imported = importVideoCaptionTrackV1(xml, {
		format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY,
	});
	assert.deepEqual(imported.track.cues[0]?.words, [
		{ startFrame: 48_000, endFrame: 60_000, text: 'Relative' },
	]);
});

test('IMSC rejects prototype-named font families as unsupported styles', () => {
	for (const fontFamily of ['constructor', '__proto__']) {
		const xml = minimalImsc('', 48_000).replace(
			'<head/>',
			'<head><styling><style xmlns:tts="http://www.w3.org/ns/ttml#styling" '
			+ `xml:id="style-1" tts:fontFamily="${fontFamily}" /></styling></head>`,
		);
		assertInterchangeError(
			() => importVideoCaptionTrackV1(xml, {
				format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY,
			}),
			'UNSUPPORTED_STYLE',
		);
	}
});

test('IMSC rejects external XML, entities, processing instructions, and active or foreign markup', () => {
	const attacks = [
		'<!DOCTYPE tt SYSTEM "https://example.invalid/caption.dtd">' + minimalImsc('', 48_000),
		'<!DOCTYPE tt [<!ENTITY exfil SYSTEM "file:///etc/passwd">]>' + minimalImsc('<p xml:id="cue-1" begin="0t" end="1t">&exfil;</p>', 48_000),
		'<?xml-stylesheet href="https://example.invalid/style.css"?>' + minimalImsc('', 48_000),
		minimalImsc('<script>alert(1)</script>', 48_000),
		minimalImsc('<p xml:id="cue-1" begin="0t" end="1t" href="https://example.invalid/">x</p>', 48_000),
	];
	for (const attack of attacks) {
		assert.throws(
			() => importVideoCaptionTrackV1(attack, { format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY }),
			(error: unknown) => error instanceof VideoCaptionInterchangeError && error.code === 'ACTIVE_CONTENT',
		);
	}
});

test('text sidecars reject active cue markup outside the passive maintained subset', () => {
	assertInterchangeError(
		() => importVideoCaptionTrackV1('1\n00:00:00,000 --> 00:00:01,000\n<script>x</script>\n', {
			format: 'srt', sampleRate: 48_000, ...IMPORT_IDENTITY,
		}),
		'ACTIVE_CONTENT',
	);
	assertInterchangeError(
		() => importVideoCaptionTrackV1('WEBVTT\n\ncue\n00:00:00.000 --> 00:00:01.000\n<img src=x>\n', {
			format: 'webvtt', sampleRate: 48_000, ...IMPORT_IDENTITY,
		}),
		'ACTIVE_CONTENT',
	);
});

test('WebVTT keeps an ampersand that an entity scan could mistake for a reference', () => {
	// Escaping turns `AT&T` into `AT&amp;T`, and once decoded that ampersand is
	// indistinguishable from the start of an entity, so scanning the decoded text
	// rejected the exporter's own output and every conforming sidecar naming a
	// brand like M&Ms.
	const source = captionTrack({
		styles: [], regions: [], speakers: [],
		cues: [{
			schemaVersion: 1,
			id: 'cue-brand',
			startFrame: 48_000,
			endFrame: 96_000,
			text: 'AT&T, M&Ms and R&B',
			styleId: null,
			regionId: null,
			speakerId: null,
			words: [],
		}],
	});
	const exported = exportVideoCaptionTrackV1(source, { format: 'webvtt', sampleRate: 48_000 });
	assert.match(exported.text, /AT&amp;T, M&amp;Ms and R&amp;B/u);
	const imported = importVideoCaptionTrackV1(exported.text, {
		format: 'webvtt', sampleRate: 48_000, ...IMPORT_IDENTITY,
	});
	assert.equal(imported.track.cues[0]?.text, 'AT&T, M&Ms and R&B');

	// An entity the passive subset does not carry is still refused.
	assertInterchangeError(
		() => importVideoCaptionTrackV1('WEBVTT\n\ncue\n00:00:00.000 --> 00:00:01.000\nhard&nbsp;space\n', {
			format: 'webvtt', sampleRate: 48_000, ...IMPORT_IDENTITY,
		}),
		'ACTIVE_CONTENT',
	);
});

test('interchange hard-bounds UTF-8 bytes, XML elements/depth, and cue counts', () => {
	const oneCue = minimalImsc('<p xml:id="cue-1" begin="0t" end="1t">é</p>', 48_000);
	const bytes = new TextEncoder().encode(oneCue).byteLength;
	assertInterchangeError(
		() => importVideoCaptionTrackV1(oneCue, {
			format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY,
			limits: { maximumInputBytes: bytes - 1 },
		}),
		'INPUT_LIMIT',
	);
	assertInterchangeError(
		() => importVideoCaptionTrackV1(oneCue, {
			format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY,
			limits: { maximumElements: 4 },
		}),
		'ELEMENT_LIMIT',
	);
	assertInterchangeError(
		() => importVideoCaptionTrackV1(oneCue, {
			format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY,
			limits: { maximumDepth: 3 },
		}),
		'DEPTH_LIMIT',
	);
	const twoCues = minimalImsc([
		'<p xml:id="cue-1" begin="0t" end="1t">one</p>',
		'<p xml:id="cue-2" begin="1t" end="2t">two</p>',
	].join(''), 48_000);
	assertInterchangeError(
		() => importVideoCaptionTrackV1(twoCues, {
			format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY,
			limits: { maximumCues: 1 },
		}),
		'CUE_LIMIT',
	);
	assert.throws(
		() => importVideoCaptionTrackV1(oneCue, {
			format: 'imsc1.1', sampleRate: 48_000, ...IMPORT_IDENTITY,
			limits: { maximumDepth: 65 },
		}),
		/cannot exceed.*hard limit/iu,
	);
});

test('interchange rejects malformed encoding, timing, and unsupported formats', () => {
	assertInterchangeError(
		() => importVideoCaptionTrackV1(Uint8Array.from([0xc3, 0x28]), {
			format: 'srt', sampleRate: 48_000, ...IMPORT_IDENTITY,
		}),
		'INVALID_UTF8',
	);
	assertInterchangeError(
		() => importVideoCaptionTrackV1('1\n00:00:02,000 --> 00:00:01,000\nbackwards\n', {
			format: 'srt', sampleRate: 48_000, ...IMPORT_IDENTITY,
		}),
		'INVALID_TIMING',
	);
	assert.throws(
		() => exportVideoCaptionTrackV1(captionTrack(), {
			format: 'ass' as VideoCaptionInterchangeFormatV1,
			sampleRate: 48_000,
		}),
		/unsupported caption interchange format/iu,
	);
});

function minimalImsc(body: string, tickRate: number): string {
	return '<tt xmlns="http://www.w3.org/ns/ttml" '
		+ 'xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:xml="http://www.w3.org/XML/1998/namespace" '
		+ 'ttp:profile="http://www.w3.org/ns/ttml/profile/imsc1.1/text" '
		+ `ttp:timeBase="media" ttp:tickRate="${tickRate}" xml:lang="en-GB" xml:space="preserve">`
		+ `<head/><body><div>${body}</div></body></tt>`;
}

function assertInterchangeError(run: () => unknown, code: string): void {
	assert.throws(run, (error: unknown) => error instanceof VideoCaptionInterchangeError && error.code === code);
}
