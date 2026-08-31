/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const sourceRoot = join(root, 'native', 'framescaper-media-host', 'src');

test('the media host has a real OS-device decode path and one-frame CPU transfer', () => {
	const session = readFileSync(join(sourceRoot, 'ffmpeg_decode_session.cpp'), 'utf8');
	for (const api of [
		'av_hwdevice_ctx_create', 'avcodec_get_hw_config',
		'AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX', 'av_hwframe_transfer_data',
	]) assert.match(session, new RegExp(api, 'u'));
	for (const baseline of ['d3d11va', 'media-foundation', 'videotoolbox', 'vaapi']) {
		assert.match(session, new RegExp(`backend == "${baseline}"`, 'u'));
	}
	assert.match(session, /silently returned a software frame/iu);
	assert.match(session, /hardware-backend-(?:unavailable|failed)/u);
});

test('decode, proxy, and the closed V14 family dispatch hardware without a blanket refusal', () => {
	const engine = readFileSync(join(sourceRoot, 'ffmpeg_media_engine.cpp'), 'utf8');
	const simple = readFileSync(join(sourceRoot, 'ffmpeg_simple_render.cpp'), 'utf8');
	const sequence = readFileSync(join(sourceRoot, 'ffmpeg_professional_sequence_encode.cpp'), 'utf8');
	assert.doesNotMatch(engine, /if\s*\(job\.backend\s*!=\s*"native-cpu"\)\s*\{\s*return\s*\{78,\s*"\{\\"error\\":\\"backend-policy-unavailable/iu);
	assert.match(engine, /decode_to_frame_pack\(job\)/u);
	assert.match(engine, /create_proxy\(job\)/u);
	assert.match(engine, /simple_full_frame_clip[\s\S]*execute_simple_render_job\(job\)/u);
	assert.match(simple, /ffmpeg_decode_session::open\(job\.sources\.front\(\), job\.backend\)/u);
	assert.match(sequence, /operation_name\(job\.kind\)/u);
	assert.doesNotMatch(sequence, /\\"operation\\":\\"media-encode\\"/u);
});

test('legacy V20 and selected V28/V14 self-tests own separate exact codec inventories', () => {
	const selected = readFileSync(join(sourceRoot, 'ffmpeg_selected_v20_render.cpp'), 'utf8');
	assert.match(selected, /struct self_test_result final/u);
	assert.match(selected, /selected_v20_self_test_result/u);
	assert.match(selected, /selected_v28_v14_self_test_result/u);
	assert.doesNotMatch(selected, /readiness_receipt|selected_v20_readiness|selected_v28_v14_readiness/u);
	const legacy = /legacy_delivery_codec_set_available\(\)[\s\S]*?\n\}/u.exec(selected)?.[0] ?? '';
	for (const encoder of ['libx264', 'libvpx-vp9', 'aac', 'libopus']) {
		assert.match(legacy, new RegExp(`"${encoder}"`, 'u'));
	}
	const v14 = /v14_delivery_codec_set_available\(\)[\s\S]*?\n\}/u.exec(selected)?.[0] ?? '';
	assert.match(v14, /ffmpeg_professional_cpu_encoder_set_available\(\)/u);
	for (const encoder of ['aac', 'libopus', 'pcm_s16le', 'flac']) {
		assert.match(v14, new RegExp(`"${encoder}"`, 'u'));
	}
});
