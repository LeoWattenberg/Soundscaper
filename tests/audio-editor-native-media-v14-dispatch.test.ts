/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createNativeMediaV14CpuRetry,
	nativeMediaV14DecodeDispatch,
	nativeMediaV14EncodeDispatch,
	nativeMediaV14HardwareEncodeDispatch,
	NATIVE_MEDIA_V14_NATIVE_PROFILE_DISPATCH,
} from '../src/common/editor/native-media-v14-native-dispatch.ts';
import {
	NATIVE_MEDIA_V14_VIDEO_DECODE_PROFILE_IDS,
	NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS,
} from '../src/common/editor/native-media-v14-support.ts';

const FINGERPRINT = '12'.repeat(32);

test('every advertised V14 professional profile owns one executable native tuple', () => {
	assert.deepEqual(
		NATIVE_MEDIA_V14_NATIVE_PROFILE_DISPATCH.map(({ id }) => id).sort(),
		[...NATIVE_MEDIA_V14_VIDEO_DECODE_PROFILE_IDS,
			...NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS].sort(),
	);
	for (const id of NATIVE_MEDIA_V14_VIDEO_DECODE_PROFILE_IDS) {
		const row = nativeMediaV14DecodeDispatch(id);
		assert.equal(row.operation, 'decode');
		assert.ok(row.decoder.length > 0);
		assert.ok(row.demuxers.length > 0 || row.imageSequence);
	}
	for (const id of NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS) {
		const row = nativeMediaV14EncodeDispatch(id);
		assert.equal(row.operation, 'encode');
		assert.ok(row.encoder.length > 0);
		assert.ok(row.muxer.length > 0);
		assert.ok(row.pixelFormat.length > 0);
	}
});

test('the closed professional encode tuples preserve their distinguishing semantics', () => {
	assert.deepEqual(tuple('encode-mp4-h264'), ['mp4', 'libx264', 'yuv420p', null, false, false]);
	assert.deepEqual(tuple('encode-webm-vp9'), ['webm', 'libvpx-vp9', 'yuv420p', null, false, false]);
	assert.deepEqual(tuple('encode-hevc-main10-sdr'), ['mp4', 'libx265', 'yuv420p10le', 'main10', false, false]);
	assert.deepEqual(tuple('encode-hevc-main10-hdr10'), ['mp4', 'libx265', 'yuv420p10le', 'main10', true, false]);
	assert.deepEqual(tuple('encode-mov-prores-proxy'), ['mov', 'prores_ks', 'yuv422p10le', 'proxy', true, false]);
	assert.deepEqual(tuple('encode-mov-prores-422-hq'), ['mov', 'prores_ks', 'yuv422p10le', 'hq', true, false]);
	assert.deepEqual(tuple('encode-mov-prores-4444'), ['mov', 'prores_ks', 'yuva444p10le', '4444', true, true]);
	assert.deepEqual(tuple('encode-mxf-dnxhr-hqx'), ['mxf', 'dnxhd', 'yuv422p10le', 'dnxhr_hqx', true, false]);
	assert.deepEqual(tuple('encode-matroska-ffv1'), ['matroska', 'ffv1', 'gbrap16le', 'level3', true, true]);
	assert.deepEqual(tuple('encode-png-sequence'), ['image2', 'png', 'rgba64be', null, false, true]);
	assert.deepEqual(tuple('encode-tiff-sequence'), ['image2', 'tiff', 'rgba64le', null, false, true]);
	assert.deepEqual(tuple('encode-openexr-sequence'), ['image2', 'exr', 'gbrapf32le', null, false, true]);
});

test('hardware encode uses a hardware encoder name or refuses the combination', () => {
	const applicable = [
		['win32', 'media-foundation', 'encode-mp4-h264', 'h264_mf'],
		['win32', 'qsv', 'encode-hevc-main10-sdr', 'hevc_qsv'],
		['win32', 'nvenc', 'encode-hevc-main10-hdr10', 'hevc_nvenc'],
		['win32', 'amf', 'encode-mp4-h264', 'h264_amf'],
		['darwin', 'videotoolbox', 'encode-mov-prores-422-hq', 'prores_videotoolbox'],
		['linux', 'vaapi', 'encode-webm-vp9', 'vp9_vaapi'],
		['linux', 'qsv', 'encode-mp4-h264', 'h264_qsv'],
		['linux', 'nvenc', 'encode-mp4-h264', 'h264_nvenc'],
		['linux', 'amf', 'encode-hevc-main10-sdr', 'hevc_amf'],
	] as const;
	for (const [platform, backend, profileId, encoder] of applicable) {
		const dispatch = nativeMediaV14HardwareEncodeDispatch({ platform, backend, profileId });
		assert.ok(dispatch);
		assert.equal(dispatch.encoder, encoder);
		assert.notEqual(dispatch.encoder, nativeMediaV14EncodeDispatch(profileId).encoder);
		assert.equal(dispatch.hardware, true);
	}
	assert.equal(nativeMediaV14HardwareEncodeDispatch({
		platform: 'linux', backend: 'vaapi', profileId: 'encode-mov-prores-4444',
	}), null);
	assert.equal(nativeMediaV14HardwareEncodeDispatch({
		platform: 'win32', backend: 'd3d11va', profileId: 'encode-mp4-h264',
	}), null, 'D3D11VA is an admitted decode device, never an encode relabel');
	assert.equal(nativeMediaV14HardwareEncodeDispatch({
		platform: 'linux', backend: 'nvenc', profileId: 'encode-png-sequence',
	}), null, 'image sequences stay CPU-exact when no real hardware encoder exists');
});

test('one hardware failure produces one exact native CPU retry', () => {
	const initial = Object.freeze({
		profileId: 'encode-hevc-main10-hdr10' as const,
		backend: 'nvenc', planFingerprint: FINGERPRINT,
		semanticPlan: Object.freeze({ sampleStart: 48_000, sampleDuration: 96_000 }),
	});
	const retry = createNativeMediaV14CpuRetry(initial);
	assert.deepEqual(retry, {
		profileId: initial.profileId,
		backend: 'native-cpu',
		planFingerprint: FINGERPRINT,
		semanticPlan: initial.semanticPlan,
		degradedBackend: 'nvenc',
		attempt: 2,
	});
	assert.equal(retry.semanticPlan, initial.semanticPlan);
	assert.throws(() => createNativeMediaV14CpuRetry({ ...retry, backend: 'native-cpu' }), /hardware attempt/u);
});

test('the native implementation binds devices, hardware frames, and exclusive sequence publication', async () => {
	const [encoder, sequence, engine] = await Promise.all([
		readFile(new URL('../native/framescaper-media-host/src/ffmpeg_hardware_encode.cpp', import.meta.url), 'utf8'),
		readFile(new URL('../native/framescaper-media-host/src/ffmpeg_professional_sequence_encode.cpp', import.meta.url), 'utf8'),
		readFile(new URL('../native/framescaper-media-host/src/ffmpeg_media_engine.cpp', import.meta.url), 'utf8'),
	]);
	assert.match(encoder, /av_hwdevice_ctx_create/u);
	assert.match(encoder, /av_hwframe_ctx_alloc/u);
	assert.match(encoder, /av_hwframe_transfer_data/u);
	assert.match(encoder, /avcodec_find_encoder_by_name/u);
	assert.match(encoder, /hardware-encoder-unavailable/u);
	assert.doesNotMatch(encoder, /return\s+cpu/u);
	assert.match(sequence, /wbxN|"wbx"/u);
	assert.match(sequence, /rename/u);
	assert.match(sequence, /remove_all/u);
	assert.match(engine, /execute_professional/u);
});

function tuple(profileId: Parameters<typeof nativeMediaV14EncodeDispatch>[0]) {
	const row = nativeMediaV14EncodeDispatch(profileId);
	return [row.muxer, row.encoder, row.pixelFormat, row.codecProfile,
		row.preservesHdrMetadata, row.supportsAlpha];
}
