/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(
	new URL('../src/common/editor/vorbis/source-manifest.json', import.meta.url), 'utf8',
));

test('bundled Ogg Vorbis is an exact libvorbis 1.3.7 plus libogg 1.3.6 artifact', () => {
	assert.equal(manifest.vorbis.archiveSha256, 'b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b');
	assert.equal(manifest.vorbis.revision, '0657aee69dec8508a0011f47f3b69d7538e9d262');
	assert.equal(manifest.ogg.archiveSha256, '5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061');
	assert.equal(manifest.toolchain.dockerImageDigest, 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc');
	assert.equal(manifest.wasm.sha256, 'c03037c33f35dbf85e1e963058156399b995b2dedb5479f6eb3f3b30148eeee5');
	assert.deepEqual(manifest.buildFeatures, {
		files: false, maximumChannels: 2, maximumSampleRate: 192000, minimumSampleRate: 8000,
		qualityMaximum: 10, qualityMinimum: 0, simd: false, threads: false,
	});
});

test('bundled Ogg Vorbis build remains reproducible and excludes external media payloads', () => {
	const build = readFileSync(new URL('../scripts/build-vorbis-wasm.mjs', import.meta.url), 'utf8');
	const source = readFileSync(
		new URL('../src/common/editor/vorbis/native/soundscaper_vorbis.c', import.meta.url), 'utf8',
	);
	assert.match(build, /-sFILESYSTEM=0/u);
	assert.match(build, /-mno-simd128/u);
	assert.match(build, /-fno-fast-math/u);
	assert.doesNotMatch(source, /ffmpeg|avcodec|avformat/iu);
	assert.match(source, /ov_open_callbacks/u);
	assert.match(source, /vorbis_encode_init_vbr/u);
});
