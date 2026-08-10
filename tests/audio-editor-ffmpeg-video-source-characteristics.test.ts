/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	isFfmpegSourceCharacteristicsLog,
	parseFfmpegVideoSourceCharacteristics,
} from '../src/common/editor/ffmpeg-video-source-characteristics.ts';

const NTSC = { num: 30_000, den: 1_001 };
const PAL = { num: 25, den: 1 };

const ROTATED_PHONE_CLIP = Object.freeze([
	"Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mov':",
	'  Metadata:',
	'    major_brand     : qt  ',
	'  Duration: 00:00:04.00, start: 0.000000, bitrate: 12000 kb/s',
	'  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), '
		+ '1920x1080 [SAR 1:1 DAR 16:9], 11800 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)',
	'    Metadata:',
	'      handler_name    : Core Media Video',
	'      timecode        : 01:00:00;02',
	'    Side data:',
	'      displaymatrix: rotation of -90.00 degrees',
	'  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s',
	'Output #0, null, to \'pipe:\':',
	'  Stream #0:0: Video: wrapped_avframe, yuv420p, 1920x1080, q=2-31, 29.97 fps',
	'[Parsed_showinfo_0 @ 0x1] config in time_base: 1/30000, frame_rate: 30000/1001',
	'[Parsed_showinfo_0 @ 0x1] n: 0 pts: 0 pts_time:0 duration: 1001 fmt:yuv420p sar:1/1 '
		+ 's:1920x1080 i:P iskey:1 type:I checksum:00000000',
]);

test('a rotated phone clip reports every characteristic it states outright', () => {
	const characteristics = parseFfmpegVideoSourceCharacteristics(ROTATED_PHONE_CLIP, { rate: NTSC });
	assert.equal(characteristics.backend, 'ffmpeg');
	assert.equal(characteristics.videoCodec, 'h264');
	assert.equal(characteristics.codedWidth, 1_920);
	assert.equal(characteristics.codedHeight, 1_080);
	assert.deepEqual(characteristics.pixelAspectRatio, { num: 1, den: 1 });
	assert.equal(characteristics.fieldOrder, 'progressive');
	assert.equal(characteristics.hasAlpha, false);
	assert.deepEqual(characteristics.colour, {
		primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
	});
	assert.deepEqual(characteristics.startTimecode, {
		negative: false, hours: 1, minutes: 0, seconds: 0, frames: 2, dropFrame: true,
	});
	assert.deepEqual(characteristics.audioStreams, [
		{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'eng' },
	]);
});

test('a display matrix becomes the clockwise rotation a surface would apply', () => {
	const rotation = (degrees: string) => parseFfmpegVideoSourceCharacteristics([
		`      displaymatrix: rotation of ${degrees} degrees`,
	], { rate: PAL }).rotationDegrees;
	assert.equal(rotation('-90.00'), 90);
	assert.equal(rotation('90.00'), 270);
	assert.equal(rotation('180.00'), 180);
	assert.equal(rotation('-0.00'), 0);
	assert.equal(rotation('-33.00'), null, 'an arbitrary angle is not rounded into a quarter turn');
});

test('the output section and stream mappings are never mistaken for source truth', () => {
	const characteristics = parseFfmpegVideoSourceCharacteristics([
		'  Stream #0:0(und): Video: prores (apch / 0x68637061), yuv422p10le(tv, bt709), 1920x1080',
		'Stream mapping:',
		'  Stream #0:0 -> #0:0 (prores (native) -> wrapped_avframe (native))',
		'Output #0, null, to \'pipe:\':',
		'  Stream #0:0: Video: wrapped_avframe, yuv422p10le, 1920x1080',
		'  Stream #0:1: Audio: pcm_s16le, 44100 Hz, mono',
	], { rate: PAL });
	assert.equal(characteristics.videoCodec, 'prores');
	assert.equal(characteristics.audioStreams, null, 'an output stream is not an input inventory');
});

test('a multi-stream master reports every audio program it did not import', () => {
	const characteristics = parseFfmpegVideoSourceCharacteristics([
		'  Stream #0:0(und): Video: h264, yuv420p(pc, bt470bg/bt470bg/smpte170m), 720x576',
		'  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp, 192 kb/s',
		'  Stream #0:2(deu): Audio: ac3, 48000 Hz, 5.1(side), fltp, 448 kb/s',
		'  Stream #0:3(und): Audio: pcm_s24le, 96000 Hz, 8 channels, s32',
	], { rate: PAL });
	assert.deepEqual(characteristics.colour, {
		matrix: 'bt470bg', primaries: 'bt470bg', transfer: 'smpte170m', range: 'full',
	});
	assert.deepEqual(characteristics.audioStreams, [
		{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'eng' },
		{ index: 2, codec: 'ac3', channelCount: 6, sampleRate: 48_000, language: 'deu' },
		{ index: 3, codec: 'pcm_s24le', channelCount: 8, sampleRate: 96_000, language: null },
	]);
});

test('showinfo geometry carries sample aspect, field order, and alpha', () => {
	const interlaced = parseFfmpegVideoSourceCharacteristics([
		'[Parsed_showinfo_0] n: 0 pts: 0 fmt:yuv420p sar:64/45 s:720x576 i:T iskey:1 type:I',
	], { rate: PAL });
	assert.deepEqual(interlaced.pixelAspectRatio, { num: 64, den: 45 });
	assert.equal(interlaced.fieldOrder, 'top-field-first');
	assert.equal(interlaced.hasAlpha, false);
	const transparent = parseFfmpegVideoSourceCharacteristics([
		'[Parsed_showinfo_0] n: 0 pts: 0 fmt:yuva420p sar:0/1 s:1280x720 i:P iskey:1 type:I',
	], { rate: PAL });
	assert.equal(transparent.hasAlpha, true);
	assert.equal(transparent.pixelAspectRatio, null, 'an undefined sample aspect is not square pixels');
});

test('an undefined language is reported as unknown rather than as a language', () => {
	const characteristics = parseFfmpegVideoSourceCharacteristics([
		'  Stream #0:1(und): Audio: opus, 48000 Hz, stereo, fltp',
	], { rate: PAL });
	assert.equal(characteristics.audioStreams?.[0].language, null);
});

test('logs without any recognised statement report nothing but the backend', () => {
	const characteristics = parseFfmpegVideoSourceCharacteristics([
		'ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers',
		'  configuration: --enable-gpl',
	], { rate: PAL });
	assert.equal(characteristics.backend, 'ffmpeg');
	assert.equal(characteristics.videoCodec, null);
	assert.equal(characteristics.codedWidth, null);
	assert.equal(characteristics.startTimecode, null);
});

test('a container timecode the source rate cannot produce stays unreported', () => {
	assert.throws(
		() => parseFfmpegVideoSourceCharacteristics(ROTATED_PHONE_CLIP),
		/A nominal source rate is required/,
	);
	const mismatched = parseFfmpegVideoSourceCharacteristics(ROTATED_PHONE_CLIP, { rate: PAL });
	assert.equal(mismatched.startTimecode, null, 'a drop-frame label at 25 fps is not source truth');
	assert.equal(mismatched.videoCodec, 'h264', 'the rest of the banner is still read');
	const illegalFrame = parseFfmpegVideoSourceCharacteristics([
		'      timecode        : 00:00:00:29',
	], { rate: PAL });
	assert.equal(illegalFrame.startTimecode, null);
});

test('the log filter keeps exactly the lines the parser reads', () => {
	assert.equal(isFfmpegSourceCharacteristicsLog('  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo'), true);
	assert.equal(isFfmpegSourceCharacteristicsLog('      displaymatrix: rotation of -90.00 degrees'), true);
	assert.equal(isFfmpegSourceCharacteristicsLog('      timecode        : 01:00:00:00'), true);
	assert.equal(isFfmpegSourceCharacteristicsLog('Output #0, null, to \'pipe:\':'), true);
	assert.equal(isFfmpegSourceCharacteristicsLog('  configuration: --enable-gpl'), false);
	assert.equal(isFfmpegSourceCharacteristicsLog(null), false);
});
