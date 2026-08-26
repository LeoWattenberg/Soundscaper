/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createExternalFfmpegShotOutputParser,
	ExternalFfmpegShotOutputError,
} from '../desktop/external-ffmpeg-shot-detection-output.ts';

test('parses ordered FFmpeg cuts in exact source-frame and presentation-tick authority', () => {
	const parser = createExternalFfmpegShotOutputParser({ stderrBytes: 4_096, metadataBytes: 8_192 });
	parser.pushStderr(Buffer.from(
		'[Parsed_showinfo_3 @ 0x1] config in time_base: 1/90000, frame_rate: 30000/1001\n',
	));
	parser.pushMetadata(Buffer.from([
		'frame:0    pts:9009    pts_time:0.1001',
		'lavfi.scd.mafd=0.000',
		'lavfi.scd.score=0.000',
		'frame:1    pts:12012   pts_time:0.133467',
		'lavfi.scd.mafd=1.000',
		'lavfi.scd.score=4.250',
		'frame:2    pts:18018   pts_time:0.2002',
		'lavfi.scd.mafd=42.500',
		'lavfi.scd.score=42.500',
		'lavfi.scd.time=0.2002',
		'frame:3    pts:24024   pts_time:0.266933',
		'lavfi.scd.mafd=3.000',
		'lavfi.scd.score=3.000',
		'',
	].join('\n')));

	assert.deepEqual(parser.finish(), {
		schemaVersion: 1,
		detector: 'ffmpeg-scdet',
		timescale: 90_000,
		sourceFrameCount: 4,
		boundaries: [{ sourceFrame: 2, presentationTick: '9009', score: 0.425 }],
	});
});

test('accepts split UTF-8 stream chunks without retaining ordinary FFmpeg logs', () => {
	const parser = createExternalFfmpegShotOutputParser({ stderrBytes: 1_024, metadataBytes: 2_048 });
	for (const chunk of [
		'[showinfo] config in time_',
		'base: 2/1000, frame_rate: 25/1\n[ffmpeg] ordinary diagnostic\n',
	]) parser.pushStderr(chunk);
	for (const chunk of [
		'frame:0 pts:-20 pts_time:-0.04\nlavfi.scd.score=0.',
		'000\nframe:1 pts:5 pts_time:0.01\nlavfi.scd.score=12.500\n',
		'lavfi.scd.time=0.01',
	]) parser.pushMetadata(chunk);

	assert.deepEqual(parser.finish(), {
		schemaVersion: 1,
		detector: 'ffmpeg-scdet',
		timescale: 1_000,
		sourceFrameCount: 2,
		boundaries: [{ sourceFrame: 1, presentationTick: '50', score: 0.125 }],
	});
});

test('preserves a valid no-cut result instead of fabricating a boundary', () => {
	const parser = outputParser();
	parser.pushMetadata([
		'frame:0 pts:0 pts_time:0',
		'lavfi.scd.score=0.000',
		'frame:1 pts:40 pts_time:0.04',
		'lavfi.scd.score=2.000',
	].join('\n'));
	assert.deepEqual(parser.finish().boundaries, []);
});

test('rejects incomplete, discontinuous, duplicate, and backward frame evidence', () => {
	for (const metadata of [
		'',
		'frame:0 pts:0 pts_time:0\n',
		'frame:1 pts:0 pts_time:0\nlavfi.scd.score=0.000\n',
		[
			'frame:0 pts:0 pts_time:0', 'lavfi.scd.score=0.000',
			'frame:2 pts:2 pts_time:0.002', 'lavfi.scd.score=20.000',
		].join('\n'),
		[
			'frame:0 pts:10 pts_time:0.01', 'lavfi.scd.score=0.000',
			'frame:1 pts:9 pts_time:0.009', 'lavfi.scd.score=20.000',
		].join('\n'),
		[
			'frame:0 pts:0 pts_time:0', 'lavfi.scd.score=10.000',
			'lavfi.scd.score=11.000',
		].join('\n'),
	]) assert.throws(() => {
		const parser = outputParser();
		parser.pushMetadata(metadata);
		parser.finish();
	}, ExternalFfmpegShotOutputError, metadata);
});

test('rejects malformed scores, timing drift, and presentation-tick overflow', () => {
	for (const metadata of [
		'frame:0 pts:0 pts_time:0\nlavfi.scd.score=NaN\n',
		'frame:0 pts:0 pts_time:0\nlavfi.scd.score=100.001\n',
		'frame:0 pts:N/A pts_time:N/A\nlavfi.scd.score=0.000\n',
		'frame:0 pts:0 pts_time:0\nlavfi.scd.score=50.000\nlavfi.scd.time=not-a-time\n',
	]) assert.throws(() => {
		const parser = outputParser();
		parser.pushMetadata(metadata);
		parser.finish();
	}, ExternalFfmpegShotOutputError, metadata);

	const overflow = createExternalFfmpegShotOutputParser({ stderrBytes: 1_024, metadataBytes: 2_048 });
	overflow.pushStderr('[showinfo] config in time_base: 2/1000, frame_rate: 25/1\n');
	overflow.pushMetadata([
		'frame:0 pts:0 pts_time:0', 'lavfi.scd.score=0.000',
		`frame:1 pts:${String(0x7fff_ffff_ffff_ffffn)} pts_time:1`,
		'lavfi.scd.score=20.000', 'lavfi.scd.time=1',
	].join('\n'));
	assert.throws(() => overflow.finish(), ExternalFfmpegShotOutputError);
});

test('enforces independent stderr, metadata, and line bounds', () => {
	for (const [stream, expected] of [
		['stderr', 'stderr-limit'],
		['metadata', 'metadata-limit'],
	] as const) {
		const parser = createExternalFfmpegShotOutputParser({ stderrBytes: 16, metadataBytes: 16 });
		assert.throws(
			() => stream === 'stderr' ? parser.pushStderr('x'.repeat(17)) : parser.pushMetadata('x'.repeat(17)),
			(error: unknown) => error instanceof ExternalFfmpegShotOutputError && error.reason === expected,
		);
	}
	const parser = createExternalFfmpegShotOutputParser({ stderrBytes: 8_192, metadataBytes: 8_192 });
	assert.throws(
		() => parser.pushMetadata(`frame:0 pts:0 pts_time:0 ${'x'.repeat(4_096)}`),
		(error: unknown) => error instanceof ExternalFfmpegShotOutputError
			&& error.reason === 'metadata-invalid',
	);
});

test('requires one stable bounded showinfo time base', () => {
	for (const stderr of [
		'',
		'[showinfo] config in time_base: 0/1000, frame_rate: 25/1\n',
		'[showinfo] config in time_base: 1/4294967296, frame_rate: 25/1\n',
		[
			'[showinfo] config in time_base: 1/1000, frame_rate: 25/1',
			'[showinfo] config in time_base: 1/90000, frame_rate: 25/1',
		].join('\n'),
	]) assert.throws(() => {
		const parser = createExternalFfmpegShotOutputParser({ stderrBytes: 4_096, metadataBytes: 4_096 });
		parser.pushStderr(stderr);
		parser.pushMetadata('frame:0 pts:0 pts_time:0\nlavfi.scd.score=0.000\n');
		parser.finish();
	}, ExternalFfmpegShotOutputError, stderr);
});

function outputParser() {
	const parser = createExternalFfmpegShotOutputParser({ stderrBytes: 1_024, metadataBytes: 2_048 });
	parser.pushStderr('[showinfo] config in time_base: 1/1000, frame_rate: 25/1\n');
	return parser;
}
