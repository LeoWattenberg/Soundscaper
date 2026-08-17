/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FCPXML_VERSION,
	createFcpxmlExport,
	frameDurationAttribute,
	frameTime,
} from '../src/common/editor/fcpxml-export.ts';

const SAMPLE_RATE = 48_000;
const NTSC = { num: 30_000, den: 1_001 };
const PAL = { num: 25, den: 1 };

function project(overrides: Record<string, unknown> = {}) {
	return {
		id: 'p', title: 'Cut', sampleRate: SAMPLE_RATE,
		sources: [
			{ kind: 'video', id: 'src-v', name: 'CAM A', storageKey: 'media/cam-a.mp4', hasAudio: true },
			{ kind: 'audio', id: 'src-a', name: 'MIX', storageKey: 'media/mix.wav' },
		],
		clips: [
			{
				kind: 'video', id: 'v1c', sourceId: 'src-v', title: 'Wide',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'video', id: 'v2c', sourceId: 'src-v', title: 'Tight',
				timelineStartFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'audio', id: 'a1c', sourceId: 'src-a', title: 'Bed',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
		],
		tracks: [
			{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v1c', 'v2c'], hidden: false },
			{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['a1c'], mute: false },
		],
		...overrides,
	};
}

test('times are exact rationals in FCPXML form, never decimal seconds', () => {
	const { text } = createFcpxmlExport({ project: project(), sequenceRate: NTSC });
	assert.doesNotMatch(text, /"\d+\.\d+s"/u, 'a decimal second is a frame boundary that stopped being one');
	for (const match of text.matchAll(/(?:offset|start|duration|tcStart|frameDuration)="([^"]+)"/gu)) {
		assert.match(match[1], /^(?:\d+|\d+\/\d+)s$/u, `unexpected time form: ${match[1]}`);
	}
});

test('frame duration is the exact reciprocal rate, reduced', () => {
	assert.equal(frameDurationAttribute(NTSC), '1001/30000s');
	assert.equal(frameDurationAttribute(PAL), '1/25s');
	assert.equal(frameDurationAttribute({ num: 24_000, den: 1_001 }), '1001/24000s');
});

test('a frame count becomes a whole multiple of the frame duration', () => {
	assert.equal(frameTime(0, NTSC), '0s');
	assert.equal(frameTime(1, NTSC), '1001/30000s');
	assert.equal(frameTime(30, NTSC), '1001/1000s', 'reduced, but still exact');
	assert.equal(frameTime(25, PAL), '1s', 'a rational that reduces to whole seconds is written as such');
	assert.equal(frameTime(30_000, NTSC), '1001s');
});

test('every emitted duration is a whole number of frames', () => {
	// A duration that is not a multiple of frameDuration is a clip starting
	// mid-frame, which FCP cannot represent and will silently move.
	const { text } = createFcpxmlExport({ project: project(), sequenceRate: NTSC });
	for (const match of text.matchAll(/duration="(\d+)(?:\/(\d+))?s"/gu)) {
		const numerator = Number(match[1]);
		const denominator = match[2] ? Number(match[2]) : 1;
		const frames = (numerator * 30_000) / (denominator * 1_001);
		assert.ok(Number.isInteger(frames), `duration ${match[0]} is not a whole frame count`);
	}
});

test('one asset is written per source identity, however often it is used', () => {
	const { text } = createFcpxmlExport({ project: project(), sequenceRate: NTSC });
	const assets = [...text.matchAll(/<asset id="([^"]+)"/gu)];
	assert.equal(assets.length, 2, 'two sources, two assets, despite three clips');
	const refs = [...text.matchAll(/<asset-clip ref="([^"]+)"/gu)].map((match) => match[1]);
	assert.equal(refs[0], refs[1], 'the same media referenced twice is one asset, so a relink reaches both');
});

test('the document declares its version and a format resource the sequence uses', () => {
	const { text } = createFcpxmlExport({ project: project(), sequenceRate: NTSC });
	assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n'));
	assert.ok(text.includes(`<fcpxml version="${FCPXML_VERSION}">`));
	assert.match(text, /<format id="r1"[^>]*frameDuration="1001\/30000s"/u);
	assert.match(text, /<sequence format="r1"/u, 'the sequence must reference the format it was written at');
});

test('drop frame is declared on the sequence, not inferred from the rate', () => {
	const drop = createFcpxmlExport({ project: project(), sequenceRate: NTSC, dropFrame: true });
	const nonDrop = createFcpxmlExport({ project: project(), sequenceRate: NTSC, dropFrame: false });
	assert.match(drop.text, /tcFormat="DF"/u);
	assert.match(nonDrop.text, /tcFormat="NDF"/u);
});

test('the sequence start timecode is carried as an exact rational', () => {
	const { text } = createFcpxmlExport({
		project: project(), sequenceRate: NTSC, startFrameCount: 107_892,
	});
	const tcStart = /tcStart="(\d+)\/(\d+)s"/u.exec(text);
	assert.ok(tcStart, 'the start timecode must be a rational, not a decimal');
	// Assert the value, not the reduced literal: 107892 frames is the property,
	// and which equivalent fraction expresses it is the writer's business.
	assert.equal(
		(Number(tcStart[1]) * 30_000) / (Number(tcStart[2]) * 1_001),
		107_892,
		'one hour at 29.97 must survive reduction exactly',
	);
});

test('roles are one default per track kind, with no vocabulary invented', () => {
	const { text } = createFcpxmlExport({ project: project(), sequenceRate: NTSC });
	assert.ok(text.includes('videoRole="video"'));
	assert.ok(text.includes('audioRole="dialogue"'));
});

test('XML-significant characters in names are escaped', () => {
	const { text } = createFcpxmlExport({
		project: project({ title: 'Rush & <Cut> "One"' }), sequenceRate: NTSC,
	});
	assert.ok(text.includes('Rush &amp; &lt;Cut&gt; &quot;One&quot;'));
	assert.doesNotMatch(text, /name="[^"]*<Cut>/u);
});

test('a missing source is an error item and writes no dangling reference', () => {
	const result = createFcpxmlExport({ project: project({ sources: [] }), sequenceRate: NTSC });
	assert.doesNotMatch(result.text, /<asset-clip/u, 'a clip with no asset must not reference one');
	assert.equal(
		result.report.items.filter((item) => item.code === 'fcpxml.media-reference-missing').length,
		3,
	);
	assert.equal(result.report.counts.missing, 3);
});

test('a silent track is omitted and reported, and a sub-frame clip likewise', () => {
	const result = createFcpxmlExport({
		project: project({
			clips: [{
				kind: 'video', id: 'blink', sourceId: 'src-v', title: 'Blink',
				timelineStartFrame: 0, durationFrames: 7, sourceStartFrame: 0, speedRatio: 1,
			}],
			tracks: [
				{ type: 'video', id: 'v1', name: 'V1', clipIds: ['blink'], hidden: false },
				{ type: 'audio', id: 'a1', name: 'A1', clipIds: [], mute: true },
			],
		}),
		sequenceRate: NTSC,
	});
	assert.ok(result.report.items.some((item) => item.code === 'fcpxml.sub-frame-clip-omitted'));
	assert.ok(result.report.items.some((item) => item.code === 'fcpxml.track-silent-omitted'));
	assert.equal(
		result.report.counts.omitted,
		result.report.items.filter((item) => item.disposition === 'omitted').length,
	);
});

test('a retimed clip carries its rendered duration and names the omission', () => {
	const result = createFcpxmlExport({
		project: project({
			clips: [{
				kind: 'video', id: 'v1c', sourceId: 'src-v', title: 'Fast',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 0.5,
			}],
			tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v1c'], hidden: false }],
		}),
		sequenceRate: NTSC,
	});
	assert.ok(result.report.items.some((item) => item.code === 'fcpxml.speed-change-omitted'));
});

test('serialization is deterministic and the export refuses a guessed rate', () => {
	const build = () => createFcpxmlExport({ project: project(), sequenceRate: NTSC }).text;
	assert.equal(build(), build());
	assert.throws(() => createFcpxmlExport({ project: project(), sequenceRate: { num: 30, den: 0 } }), /rational/u);
	assert.throws(
		() => createFcpxmlExport({ project: project({ sampleRate: -1 }), sequenceRate: NTSC }),
		/sample rate/u,
	);
});

test('simultaneous tracks go to connected lanes, not on top of each other in the spine', () => {
	// A spine is a single sequential lane. Two clips sharing offset="0s" in it
	// is not a second track, it is a malformed first one — so the first video
	// track is the spine and everything simultaneous with it is connected:
	// further video above at 1, 2, ..., audio below at -1, -2, ...
	const result = createFcpxmlExport({
		project: project({
			clips: [
				{
					kind: 'video', id: 'a', sourceId: 'src-v', title: 'A',
					timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
				},
				{
					kind: 'video', id: 'b', sourceId: 'src-v', title: 'B',
					timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
				},
				{
					kind: 'audio', id: 'c', sourceId: 'src-a', title: 'C',
					timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
				},
			],
			tracks: [
				{ type: 'video', id: 'v1', name: 'V1', clipIds: ['a'], hidden: false },
				{ type: 'video', id: 'v2', name: 'V2', clipIds: ['b'], hidden: false },
				{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['c'], mute: false },
			],
		}),
		sequenceRate: NTSC,
	});
	const clips = [...result.text.matchAll(/<asset-clip[^>]*name="([^"]+)"(?:[^>]*lane="(-?\d+)")?/gu)]
		.map((match) => ({ name: match[1], lane: match[2] ?? '0' }));
	assert.deepEqual(
		clips,
		[{ name: 'A', lane: '0' }, { name: 'B', lane: '1' }, { name: 'C', lane: '-1' }],
		'the primary video track is the spine; video stacks above and audio below',
	);
});

test('the document satisfies the FCPXML DTD in the ways a lenient reader hides', () => {
	// Checked against Apple's FCPXMLv1_10.dtd with xmllint. All three of these
	// were accepted by the reference reader and rejected by the DTD, which is
	// what Final Cut itself applies.
	const { text } = createFcpxmlExport({ project: project(), sequenceRate: NTSC });
	assert.doesNotMatch(text, /<asset[^>]*\bsrc=/u, 'asset carries no src; the location lives on media-rep');
	assert.match(text, /<asset\b[^>]*>\n\s*<media-rep kind="original-media" src="[^"]+"\/>/u,
		'asset is declared (media-rep+, metadata?), so it cannot be an empty element');
	assert.doesNotMatch(text, /<asset-clip[^>]*\srole=/u, 'asset-clip declares audioRole and videoRole, not role');
	assert.match(text, /<asset-clip[^>]*videoRole="video"/u);
	assert.match(text, /<asset-clip[^>]*audioRole="dialogue"/u);
});

test('the spine is emitted in timeline order, whatever order the track stores', () => {
	// A spine is serial. clipIds carries authoring order, so a track authored
	// out of order would otherwise emit descending offsets in a container that
	// means "one after another".
	const reversed = createFcpxmlExport({
		project: project({
			tracks: [
				{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v2c', 'v1c'], hidden: false },
				{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['a1c'], mute: false },
			],
		}),
		sequenceRate: NTSC,
	});
	const spineNames = [...reversed.text.matchAll(/<asset-clip(?![^>]*lane=)[^>]*name="([^"]+)"/gu)]
		.map((match) => match[1]);
	assert.deepEqual(spineNames, ['Wide', 'Tight'], 'ascending offsets, not array order');
});
