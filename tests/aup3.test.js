import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import {
	decodeAup3SampleBlock,
	parseAup3BinaryXml,
} from '../src/lib/tools/aup3.js';
import {
	aup3OutputName,
	decodeAup3Bytes,
	getAup3MemoryLimits,
	isAup3FileName,
	requiresAup3LargeProjectConfirmation,
} from '../src/lib/tools/aup3-browser.js';
import {
	AUP3_SAMPLE_FORMAT,
	createAup3Fixture,
} from './aup3-fixture.js';

const SQL = await initSqlJs();
const MEBIBYTE = 1024 * 1024;

test('selects adaptive AUP3 memory limits and an explicit large-project profile', () => {
	assert.deepEqual(getAup3MemoryLimits({ navigator: { deviceMemory: 4, userAgent: 'Desktop' } }), {
		databaseBytes: 128 * MEBIBYTE,
		decodedAudioBytes: 256 * MEBIBYTE,
		mixBytes: 384 * MEBIBYTE,
	});
	assert.equal(
		getAup3MemoryLimits({ navigator: { deviceMemory: 8, userAgent: 'Android' } }).databaseBytes,
		128 * MEBIBYTE,
	);
	assert.deepEqual(getAup3MemoryLimits({ navigator: { deviceMemory: 8, userAgent: 'Desktop' } }), {
		databaseBytes: 256 * MEBIBYTE,
		decodedAudioBytes: 384 * MEBIBYTE,
		mixBytes: 512 * MEBIBYTE,
	});
	assert.deepEqual(getAup3MemoryLimits({ allowLargeProject: true }), {
		databaseBytes: 512 * MEBIBYTE,
		decodedAudioBytes: 512 * MEBIBYTE,
		mixBytes: 768 * MEBIBYTE,
	});
});

test('requires confirmation only for AUP3 files larger than 256 MB', () => {
	assert.equal(requiresAup3LargeProjectConfirmation(256 * MEBIBYTE), false);
	assert.equal(requiresAup3LargeProjectConfirmation(256 * MEBIBYTE + 1), true);
});

test('decodes all Audacity sample block formats', () => {
	const int16 = new Uint8Array(6);
	const int16View = new DataView(int16.buffer);
	int16View.setInt16(0, -32768, true);
	int16View.setInt16(2, 0, true);
	int16View.setInt16(4, 16384, true);
	assert.deepEqual(Array.from(decodeAup3SampleBlock(int16, AUP3_SAMPLE_FORMAT.INT16)), [-1, 0, 0.5]);

	const int24 = new Uint8Array(12);
	const int24View = new DataView(int24.buffer);
	int24View.setInt32(0, -8388608, true);
	int24View.setInt32(4, 2097152, true);
	int24View.setInt32(8, 8388607, true);
	const decodedInt24 = decodeAup3SampleBlock(int24, AUP3_SAMPLE_FORMAT.INT24);
	assert.equal(decodedInt24[0], -1);
	assert.equal(decodedInt24[1], 0.25);
	assert.ok(Math.abs(decodedInt24[2] - 0.99999988) < 1e-6);

	const float = new Uint8Array(12);
	const floatView = new DataView(float.buffer);
	floatView.setFloat32(0, -0.75, true);
	floatView.setFloat32(4, Number.NaN, true);
	floatView.setFloat32(8, 1.25, true);
	assert.deepEqual(Array.from(decodeAup3SampleBlock(float, AUP3_SAMPLE_FORMAT.FLOAT32)), [-0.75, 0, 1.25]);

	assert.throws(
		() => decodeAup3SampleBlock(Uint8Array.of(0), AUP3_SAMPLE_FORMAT.INT16),
		(error) => error.code === 'INVALID_SAMPLE_BLOCK',
	);
	assert.throws(
		() => decodeAup3SampleBlock(new Uint8Array(3), 0x00030001),
		(error) => error.code === 'UNSUPPORTED_SAMPLE_FORMAT',
	);
});

test('parses document-local binary XML name scopes', () => {
	const dictionary = bytes(
		0, 1,
		15, ...u16(1), ...u16(7), ...utf8('project'),
	);
	const label = utf8('scoped');
	const header = utf8('<?xml version="1.0"?>');
	const document = bytes(
		12, ...i32(header.length), ...header,
		1, ...u16(1),
		13,
		15, ...u16(1), ...u16(5), ...utf8('child'),
		15, ...u16(2), ...u16(5), ...utf8('label'),
		1, ...u16(1),
		3, ...u16(2), ...i32(label.length), ...label,
		2, ...u16(1),
		14,
		2, ...u16(1),
	);
	const root = parseAup3BinaryXml(dictionary, document);
	assert.equal(root.name, 'project');
	assert.equal(root.children[0].name, 'child');
	assert.equal(root.children[0].attributes.label, 'scoped');

	assert.throws(
		() => parseAup3BinaryXml(dictionary, bytes(1, ...u16(99))),
		(error) => error.code === 'INVALID_PROJECT_XML',
	);
});

test('parses UTF-16LE and UTF-32LE binary XML dictionaries', () => {
	for (const charSize of [2, 4]) {
		const name = 'pröject';
		const encoded = encodedText(name, charSize);
		const dictionary = bytes(
			0, charSize,
			15, ...u16(1), ...u16(encoded.length), ...encoded,
		);
		const document = bytes(1, ...u16(1), 2, ...u16(1));
		assert.equal(parseAup3BinaryXml(dictionary, document).name, name);
	}
});

test('opens an AUP3 database and honors clip trims, timing, gain, and metadata', async () => {
	const fixture = await createAup3Fixture({
		SQL,
		sampleRate: 48000,
		tracks: [{
			name: 'Voice',
			channel: 2,
			gain: 0.5,
			clips: [{
				samples: [0, 0.25, 0.5, 0.75, 1, 0.5],
				trimLeft: 2 / 48000,
				trimRight: 1 / 48000,
			}],
		}],
	});
	const progress = [];
	const decoded = await decodeAup3Bytes(fixture, {
		SQL,
		fileName: 'My Session.AUP3',
		onProgress: (event) => progress.push(event.progress),
	});

	assert.equal(decoded.sampleRate, 48000);
	assert.equal(decoded.channels.length, 1);
	assert.deepEqual(Array.from(decoded.channels[0]), [0, 0, 0.25, 0.375, 0.5]);
	assert.deepEqual(decoded.warnings, []);
	assert.deepEqual(decoded.metadata, {
		title: 'My Session',
		trackCount: 1,
		durationSeconds: 5 / 48000,
		source: 'project',
	});
	assert.equal(progress[0], 0);
	assert.equal(progress.at(-1), 1);
});

test('mixes linked stereo tracks, skips muted tracks, and counts logical tracks', async () => {
	const fixture = await createAup3Fixture({
		SQL,
		tracks: [
			{ name: 'Stereo L', channel: 0, linked: true, clips: [{ samples: [0.25, -0.25] }] },
			{ name: 'Stereo R', channel: 1, clips: [{ samples: [0.5, -0.5] }] },
			{ name: 'Muted', channel: 2, mute: true, clips: [{ samples: [1, 1] }] },
		],
	});
	const decoded = await decodeAup3Bytes(fixture, { SQL });
	assert.equal(decoded.channels.length, 2);
	assert.deepEqual(Array.from(decoded.channels[0]), [0.25, -0.25]);
	assert.deepEqual(Array.from(decoded.channels[1]), [0.5, -0.5]);
	assert.equal(decoded.metadata.trackCount, 2);
});

test('structured AUP3 decoding preserves tracks, clips, trims, pitch, stretch, envelopes, and source channels', async () => {
	const fixture = await createAup3Fixture({
		SQL,
		projectName: 'Structured session',
		projectTempo: 120,
		tracks: [
			{
				name: 'Music', channel: 0, linked: true, gain: 0.75,
				clips: [{
					samples: [0, 0.25, 0.5, 0.75, 1], trimLeft: 1 / 48_000,
					stretchRatio: 1.5, rawAudioTempo: 60, centShift: 300, envelope: true,
				}],
			},
			{
				name: 'Music', channel: 1,
				clips: [{
					samples: [1, 0.75, 0.5, 0.25, 0], trimLeft: 1 / 48_000,
					stretchRatio: 1.5, rawAudioTempo: 60, centShift: 300, envelope: true,
				}],
			},
		],
	});
	const decoded = await decodeAup3Bytes(fixture, { SQL, structured: true });
	assert.equal(decoded.channels, undefined);
	assert.equal(decoded.sampleRate, 48_000);
	assert.equal(decoded.tempo.bpm, 120);
	assert.equal(decoded.tracks.length, 1);
	assert.equal(decoded.tracks[0].channelLayout, 'stereo');
	assert.equal(decoded.tracks[0].gain, 0.75);
	assert.equal(decoded.tracks[0].clips.length, 1);
	assert.equal(decoded.tracks[0].clips[0].channels.length, 2);
	assert.equal(decoded.tracks[0].clips[0].pitchCents, 300);
	assert.equal(decoded.tracks[0].clips[0].stretch, 0.75);
	assert.equal(decoded.tracks[0].clips[0].sourceStart, 1);
	assert.deepEqual(decoded.tracks[0].clips[0].envelope, [{ frame: 0, value: 0.5 }]);
	assert.ok(decoded.opaqueExtensions.aup3Project);
});

test('treats current Audacity channel-zero tracks as mono unless they are linked', async () => {
	const fixture = await createAup3Fixture({
		SQL,
		tracks: [{ name: 'Current mono', channel: 0, linked: false, clips: [{ samples: [0.25, -0.25] }] }],
	});
	const decoded = await decodeAup3Bytes(fixture, { SQL });
	assert.equal(decoded.channels.length, 1);
	assert.deepEqual(Array.from(decoded.channels[0]), [0.25, -0.25]);
});

test('uses canonical project and raw-audio tempos for stretched clip timing', async () => {
	const fixture = await createAup3Fixture({
		SQL,
		projectTempo: 120,
		tracks: [{
			clips: [{ samples: [0, 0.25, 0.5, 0.75], stretchRatio: 1.5, rawAudioTempo: 60 }],
		}],
	});
	const decoded = await decodeAup3Bytes(fixture, { SQL });
	assert.equal(decoded.channels[0].length, 3);
	assert.ok(decoded.warnings.some((warning) => warning.includes('approximated')));
});

test('uses autosave data and reports best-effort repairs and unsupported features', async () => {
	const fixture = await createAup3Fixture({
		SQL,
		autosave: true,
		realtimeEffect: true,
		tracks: [{
			name: 'Repairs',
			clips: [{
				blocks: [
					{ samples: [0.1, 0.2], start: 4 },
					{ id: -2, start: 99 },
				],
				declaredSamples: 99,
				envelope: true,
				stretchRatio: 1.5,
			}],
		}],
	});
	const decoded = await decodeAup3Bytes(fixture, { SQL });
	assert.equal(decoded.metadata.source, 'autosave');
	assert.equal(decoded.channels[0].length, 6);
	assert.ok(decoded.warnings.some((warning) => warning.includes('realtime')));
	assert.ok(decoded.warnings.some((warning) => warning.includes('envelopes')));
	assert.ok(decoded.warnings.some((warning) => warning.includes('stretching')));
	assert.ok(decoded.warnings.some((warning) => warning.includes('block positions')));
	assert.ok(decoded.warnings.some((warning) => warning.includes('sample count')));
});

test('rejects non-AUP3 data and missing sample blocks clearly', async () => {
	await assert.rejects(
		decodeAup3Bytes(utf8('not a sqlite database'), { SQL }),
		(error) => error.code === 'NOT_AUP3',
	);
	const fixture = await createAup3Fixture({
		SQL,
		tracks: [{ clips: [{ samples: [0.5], missingBlock: true }] }],
	});
	await assert.rejects(
		decodeAup3Bytes(fixture, { SQL }),
		(error) => error.code === 'MISSING_SAMPLE_BLOCK' && error.message.includes('1'),
	);

	const lookalike = new SQL.Database(fixture);
	let wrongApplicationId;
	try {
		lookalike.run('PRAGMA application_id = 0');
		wrongApplicationId = lookalike.export();
	} finally {
		lookalike.close();
	}
	await assert.rejects(
		decodeAup3Bytes(wrongApplicationId, { SQL }),
		(error) => error.code === 'NOT_AUP3',
	);
});

test('rejects hostile silent-block sizes before allocating them', async () => {
	const fixture = await createAup3Fixture({
		SQL,
		tracks: [{ clips: [{ blocks: [{ id: -(67_108_864 + 1) }] }] }],
	});
	await assert.rejects(
		decodeAup3Bytes(fixture, {
			SQL,
			memoryLimits: {
				databaseBytes: 128 * MEBIBYTE,
				decodedAudioBytes: 256 * MEBIBYTE,
				mixBytes: 384 * MEBIBYTE,
			},
		}),
		(error) => error.code === 'PROJECT_TOO_LARGE',
	);
});

test('recognizes AUP3 names and creates WAV output names case-insensitively', () => {
	assert.equal(isAup3FileName('session.AUP3'), true);
	assert.equal(isAup3FileName('session.wav'), false);
	assert.equal(aup3OutputName('session.AUP3'), 'session.wav');
	assert.equal(aup3OutputName(''), 'audacity-project.wav');
});

function bytes(...values) {
	return Uint8Array.from(values.flat());
}

function utf8(value) {
	return Array.from(new TextEncoder().encode(value));
}

function u16(value) {
	return [value & 0xff, value >>> 8 & 0xff];
}

function i32(value) {
	return [value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff];
}

function encodedText(value, charSize) {
	const codePoints = Array.from(value);
	const buffer = new ArrayBuffer(codePoints.reduce((total, character) => total + (charSize === 2 && character.codePointAt(0) > 0xffff ? 4 : charSize), 0));
	const view = new DataView(buffer);
	let offset = 0;
	for (const character of codePoints) {
		const codePoint = character.codePointAt(0);
		if (charSize === 2 && codePoint > 0xffff) {
			const adjusted = codePoint - 0x10000;
			view.setUint16(offset, 0xd800 + (adjusted >>> 10), true);
			view.setUint16(offset + 2, 0xdc00 + (adjusted & 0x3ff), true);
			offset += 4;
		} else if (charSize === 2) {
			view.setUint16(offset, codePoint, true);
			offset += 2;
		} else {
			view.setUint32(offset, codePoint, true);
			offset += 4;
		}
	}
	return Array.from(new Uint8Array(buffer));
}
