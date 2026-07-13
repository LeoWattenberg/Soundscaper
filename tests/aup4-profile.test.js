import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	AUP4_APPLICATION_ID,
	AUP4_BINARY_XML_VERSION,
	AUP4_SAMPLE_FORMAT_FLOAT32,
	AUP4_USER_VERSION,
	createAup4ProjectDocument,
	createAup4ProjectTree,
	createAup4SampleBlock,
	decodeAup4Float32Samples,
	effectiveAup4SaveLimit,
	getAup4SaveLimit,
	inspectAup4Header,
	readAup4ProjectSummary,
	validateAup4SchemaObjects,
} from '../src/lib/tools/audio-editor/aup4-profile.js';
import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/lib/tools/audio-editor/audacity-binary-xml.js';
import { AUP4_SAMPLEBLOCK_ORACLE } from './fixtures/aup4-sampleblock-oracle.js';

test('AUP4 sample blocks use upstream Float32 layout and padded summaries', () => {
	const input = Float32Array.of(1, -1, 0.5, -0.5);
	const block = createAup4SampleBlock(input);
	assert.equal(block.sampleformat, AUP4_SAMPLE_FORMAT_FLOAT32);
	assert.equal(block.sampleCount, 4);
	assert.equal(block.samples.byteLength, 16);
	assert.equal(block.summary256.byteLength, 256 * 3 * 4);
	assert.equal(block.summary64k.byteLength, 3 * 4);
	assert.deepEqual(decodeAup4Float32Samples(block.samples), input);
	assert.equal(block.summin, -1);
	assert.equal(block.summax, 1);
	assert.ok(Math.abs(block.sumrms - Math.sqrt(0.625)) < 1e-12);

	const summary256 = decodeAup4Float32Samples(block.summary256);
	assert.equal(summary256[0], -1);
	assert.equal(summary256[1], 1);
	assert.ok(Math.abs(summary256[2] - Math.fround(Math.sqrt(0.625))) < 1e-7);
	assert.equal(summary256[3], 3.4028234663852886e38);
	assert.equal(summary256[4], -3.4028234663852886e38);
	const unclamped = createAup4SampleBlock([2, -2, Number.NaN]);
	assert.equal(unclamped.summin, -2);
	assert.equal(unclamped.summax, 2);
	assert.deepEqual(decodeAup4Float32Samples(unclamped.samples), Float32Array.of(2, -2, 0));
});

test('AUP4 summaries match a real Audacity sample block byte-for-byte', () => {
	const samples = new Float32Array(AUP4_SAMPLEBLOCK_ORACLE.sampleCount);
	const words = new Uint32Array(samples.buffer);
	words.set(AUP4_SAMPLEBLOCK_ORACLE.words, 0);
	words.set(AUP4_SAMPLEBLOCK_ORACLE.words, AUP4_SAMPLEBLOCK_ORACLE.repeatAt);
	const block = createAup4SampleBlock(samples);
	assert.equal(block.summin, AUP4_SAMPLEBLOCK_ORACLE.summin);
	assert.equal(block.summax, AUP4_SAMPLEBLOCK_ORACLE.summax);
	assert.equal(block.sumrms, AUP4_SAMPLEBLOCK_ORACLE.sumrms);
	assert.equal(sha256(block.samples), AUP4_SAMPLEBLOCK_ORACLE.samplesSha256);
	assert.equal(sha256(block.summary256), AUP4_SAMPLEBLOCK_ORACLE.summary256Sha256);
	assert.equal(sha256(block.summary64k), AUP4_SAMPLEBLOCK_ORACLE.summary64kSha256);
});

test('AUP4 project documents round-trip the browser model through typed binary XML', () => {
	const project = {
		id: 'project-1',
		title: 'Native project',
		sampleRate: 44_100,
		tempo: { bpm: 145 },
		timeSignature: { numerator: 7, denominator: 8 },
		snap: { enabled: true, type: 4, triplets: true },
		timeDisplay: { format: 'bar:beat' },
		selection: { startFrame: 4410, endFrame: 8820, trackIds: ['track-1'] },
		view: { zoom: 100, horizontalPosition: 2, verticalPosition: 1 },
		metadata: { title: 'Example', artist: 'kw.media' },
		clips: [{
			id: 'clip-1', sourceId: 'source-1', name: 'Audio', timelineStartFrame: 2205,
			durationFrames: 4, pitchCents: 100, stretchRatio: 1.25, groupId: 2,
			envelope: [{ frame: 0, value: 0.5 }],
		}],
		tracks: [{
			id: 'track-1', kind: 'audio', name: 'Stereo', channelCount: 2, gain: 1, pan: 0,
			mute: false, solo: false, sampleRate: 44_100, display: 'multiview', clipIds: ['clip-1'], effects: [],
		}, {
			id: 'labels-1', type: 'label', name: 'Labels',
			labels: [{ id: 'label-1', title: 'Marker', startFrame: 0, endFrame: 4410 }],
		}],
		master: { effects: [] },
	};
	const blocks = new Map([
		['clip-1:0', [{ blockId: 11, sampleCount: 4 }]],
		['clip-1:1', [{ blockId: 12, sampleCount: 4 }]],
	]);
	const tree = createAup4ProjectTree(project, blocks);
	const encoded = encodeAudacityBinaryXml(tree);
	const decoded = decodeAudacityBinaryXml(encoded.dictionary, encoded.document);
	const summary = readAup4ProjectSummary(decoded.root);
	assert.equal(summary.xmlVersion, AUP4_BINARY_XML_VERSION);
	assert.equal(summary.sampleRate, 44_100);
	assert.equal(summary.tempo, 145);
	assert.deepEqual(summary.timeSignature, { numerator: 7, denominator: 8 });
	assert.deepEqual(summary.selection, { startFrame: 4410, endFrame: 8820 });
	assert.equal(summary.audioTrackCount, 2);
	assert.equal(summary.labelTrackCount, 1);

	const waveTracks = audacityXmlChildren(decoded.root, 'wavetrack');
	assert.deepEqual(waveTracks.map((node) => audacityXmlAttribute(node, 'channel')), [0, 1]);
	assert.equal(audacityXmlAttributes(waveTracks[0], 'minFreq')[0].type, 'double');
	assert.equal(audacityXmlAttributes(waveTracks[0], 'maxFreq')[0].type, 'double');
	// The pinned native writer deliberately emits both the spectrogram gain
	// attachment and the later WaveTrack volume under the historical `gain`
	// name. Attribute order and numeric widths are therefore significant.
	assert.deepEqual(audacityXmlAttributes(waveTracks[0], 'gain').map(({ type, value }) => ({ type, value })), [
		{ type: 'int', value: 20 },
		{ type: 'double', value: 1 },
	]);
	assert.equal(audacityXmlChildren(waveTracks[0], 'effects').length, 1);
	assert.equal(audacityXmlChildren(waveTracks[1], 'effects').length, 0);
	const waveClip = audacityXmlChildren(waveTracks[0], 'waveclip')[0];
	assert.equal(audacityXmlAttributes(waveClip, 'centShift')[0].type, 'double');
	assert.equal(audacityXmlAttributes(waveClip, 'colorindex')[0].type, 'int');
	assert.equal(audacityXmlAttributes(waveClip, 'clipTempo').length, 0);
	const waveBlock = audacityXmlChildren(audacityXmlChildren(waveClip, 'sequence')[0], 'waveblock')[0];
	assert.equal(audacityXmlAttribute(waveBlock, 'length'), 4);
	assert.equal(audacityXmlAttributes(waveBlock, 'length')[0].type, 'long-long');
	const labelTrack = audacityXmlChildren(decoded.root, 'labeltrack')[0];
	assert.equal(audacityXmlAttribute(labelTrack, 'numlabels'), 1);
	assert.equal(audacityXmlAttribute(audacityXmlChildren(labelTrack, 'label')[0], 'isSelected'), false);
	const tags = audacityXmlChildren(audacityXmlChildren(decoded.root, 'tags')[0], 'tag');
	assert.deepEqual(tags.map((tag) => audacityXmlAttribute(tag, 'name')), ['TITLE', 'ARTIST']);
	const nativeEncoded = encodeAudacityBinaryXml(createAup4ProjectDocument(project, blocks));
	const nativeDocument = decodeAudacityBinaryXml(nativeEncoded.dictionary, nativeEncoded.document);
	assert.equal(nativeDocument.roots.filter((entry) => entry.kind === 'raw').length, 10);
	assert.equal(nativeDocument.roots.find((entry) => entry.kind === 'raw').value, '<?xml ');
});

test('AUP4 compatibility and GitHub Pages save tiers are explicit', () => {
	assert.deepEqual(inspectAup4Header({
		applicationId: AUP4_APPLICATION_ID,
		userVersion: AUP4_USER_VERSION,
		xmlVersion: AUP4_BINARY_XML_VERSION,
	}), {
		compatible: true,
		readOnly: false,
		applicationId: AUP4_APPLICATION_ID,
		userVersion: AUP4_USER_VERSION,
		xmlVersion: AUP4_BINARY_XML_VERSION,
		issues: [],
	});
	assert.equal(inspectAup4Header({ applicationId: AUP4_APPLICATION_ID, userVersion: AUP4_USER_VERSION + 1 }).readOnly, true);
	assert.equal(inspectAup4Header({
		applicationId: AUP4_APPLICATION_ID, userVersion: AUP4_USER_VERSION, xmlVersion: 'future',
	}).compatible, false);
	assert.equal(getAup4SaveLimit({ opfs: false }), 64 * 1024 * 1024);
	assert.equal(getAup4SaveLimit({ mobile: true }), 128 * 1024 * 1024);
	assert.equal(getAup4SaveLimit({ deviceMemory: 6 }), 256 * 1024 * 1024);
	assert.equal(getAup4SaveLimit({ deviceMemory: 8 }), 512 * 1024 * 1024);
	const mebibyte = 1024 * 1024;
	assert.equal(effectiveAup4SaveLimit({
		deviceMemory: 8,
		quota: 300 * mebibyte,
		usage: 100 * mebibyte,
		workingBytes: 50 * mebibyte,
	}), 150 * mebibyte);
	assert.equal(effectiveAup4SaveLimit({
		quota: 32 * mebibyte,
		usage: 20 * mebibyte,
	}), 0);
	assert.equal(effectiveAup4SaveLimit({
		mobile: true,
		quota: 1024 * mebibyte,
		usage: 0,
	}), 128 * mebibyte);
	assert.equal(effectiveAup4SaveLimit({
		quota: 100 * mebibyte,
		usage: 0,
		workingBytes: 'not-a-number',
	}), 84 * mebibyte);
});

test('AUP4 schema validation permits only pinned tables and SQLite-owned objects', () => {
	assert.equal(validateAup4SchemaObjects([
		{ type: 'table', name: 'project' },
		{ type: 'table', name: 'autosave' },
		{ type: 'table', name: 'sampleblocks' },
		{ type: 'table', name: 'project_history' },
		{ type: 'table', name: 'sqlite_sequence' },
		{ type: 'index', name: 'sqlite_autoindex_project_1', tbl_name: 'project' },
	]), true);
	assert.throws(
		() => validateAup4SchemaObjects([{ type: 'trigger', name: 'steal_data' }]),
		(error) => error.code === 'UNSAFE_SCHEMA',
	);
	assert.throws(
		() => validateAup4SchemaObjects([{ type: 'trigger', name: 'sqlite_autoindex_project_1', tbl_name: 'project' }]),
		(error) => error.code === 'UNSAFE_SCHEMA',
	);
	assert.equal(validateAup4SchemaObjects([
		{ type: 'table', name: 'newer_data', tbl_name: 'newer_data' },
		{ type: 'index', name: 'newer_data_index', tbl_name: 'newer_data' },
	], { futureReadOnly: true }), true);
	assert.throws(
		() => validateAup4SchemaObjects([{
			type: 'table', name: 'future_search', tbl_name: 'future_search', sql: 'CREATE VIRTUAL TABLE future_search USING fts5(value)',
		}], { futureReadOnly: true }),
		(error) => error.code === 'UNSAFE_SCHEMA',
	);
});

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
