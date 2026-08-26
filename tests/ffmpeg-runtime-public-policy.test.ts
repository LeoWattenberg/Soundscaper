/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import viteConfig from '../vite.config.mjs';
import policy from '../config/ffmpeg-runtime-publication-policy.json';
import {
	builtFfmpegRuntimeReleaseBaseUrl,
	ffmpegRuntimeReleaseBaseUrl,
	FFMPEG_RUNTIME_POINTER_URL,
	preferredFfmpegRuntimeFallbackBaseUrl,
} from '../src/common/offline/ffmpeg-runtime-public-policy.ts';

test('runtime URLs share one policy and production builds pin the full manifest digest', async () => {
	const manifestBytes = await readFile('config/ffmpeg-runtime-manifest.json');
	const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
	assert.equal(
		JSON.parse(String(viteConfig.define?.__FFMPEG_RUNTIME_MANIFEST_SHA256__)),
		manifestSha256,
	);
	assert.equal(
		FFMPEG_RUNTIME_POINTER_URL,
		'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/latest.json',
	);
	assert.deepEqual(policy.pages, {
		origin: 'https://soundscaper.org',
	});
	assert.deepEqual(policy.runtimeFiles, [
		{ name: 'ffmpeg-core.js', contentType: 'text/javascript; charset=utf-8' },
		{ name: 'ffmpeg-core.wasm', contentType: 'application/wasm' },
	]);
	assert.equal(policy.cloudflare.pagesRuleRef, 'soundscaper-pages-browser-origin-v1');
	assert.equal(
		ffmpegRuntimeReleaseBaseUrl(manifestSha256),
		`https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${manifestSha256}`,
	);
	assert.equal(builtFfmpegRuntimeReleaseBaseUrl(), null, 'the raw Node test has no build-time release injection');
});

test('content-addressed release URL construction rejects partial or mutable identifiers', () => {
	for (const value of ['latest', 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(64)}/nested`]) {
		assert.throws(() => ffmpegRuntimeReleaseBaseUrl(value), /release ID is invalid/u);
	}
});

test('a production-defined manifest release always replaces the legacy direct fallback', async () => {
	const releaseId = 'b'.repeat(64);
	const production = ffmpegRuntimeReleaseBaseUrl(releaseId);
	assert.equal(
		preferredFfmpegRuntimeFallbackBaseUrl(
			'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10',
			production,
		),
		production,
	);
	const editorSource = await readFile('src/common/editor/ffmpeg.js', 'utf8');
	assert.doesNotMatch(editorSource, /assets\.soundscaper\.org\/runtime\/ffmpeg\/0\.12\.10/u);
});
