/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkBuildChunks } from '../scripts/check-build-chunks.mjs';
import { auditBrowserBundleCodecComposition } from '../scripts/lib/browser-bundle-codec-audit.mjs';

test('browser bundle audit rejects every application-supplied FFmpeg seam', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-browser-codecs-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'assets'));
	await writeFile(join(root, 'index.html'), '<script src="/assets/editor.js"></script>');
	await writeFile(join(root, 'assets/editor.js'), 'const provider = "dedicated-browser-codecs";');

	assert.deepEqual(auditBrowserBundleCodecComposition({ root }), {
		status: 'browser-codec-composition', inspectedFileCount: 2,
	});

	for (const token of [
		'@ffmpeg/ffmpeg',
		'@ffmpeg/core',
		'ffmpeg-core.wasm',
		'ffmpeg-core-A1B2C3.js',
		'browser-ffmpeg-runtime',
		'createBrowserFfmpegRuntimeManager',
		'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10',
		'soundscaper-ffmpeg-runtime-v1-',
	]) {
		await writeFile(join(root, 'assets/editor.js'), `const forbidden = ${JSON.stringify(token)};`);
		assert.throws(
			() => auditBrowserBundleCodecComposition({ root }),
			/browser bundle retains an application-supplied FFmpeg seam/iu,
			token,
		);
	}
});

test('browser bundle audit inspects asset names without rejecting desktop FFmpeg terminology', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-browser-codecs-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'assets'));
	await writeFile(join(root, 'index.html'), '<script src="/assets/editor.js"></script>');
	await writeFile(
		join(root, 'assets/editor.js'),
		'const allowed = ["desktop-external-ffmpeg", "Electron libffmpeg.so"];',
	);
	await writeFile(join(root, 'assets/ffmpeg-core.wasm'), new Uint8Array([0, 97, 115, 109]));

	assert.throws(
		() => auditBrowserBundleCodecComposition({ root }),
		/browser bundle retains an application-supplied FFmpeg seam: assets\/ffmpeg-core\.wasm/iu,
	);
});

test('browser bundle audit admits only the dynamic trim-media FFmpeg closure', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-browser-codecs-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'assets'));
	await writeFile(join(root, 'index.html'), '<script src="/assets/editor.js"></script>');
	await writeFile(
		join(root, 'assets/editor.js'),
		'const loadTrim = () => import("./ffmpeg-A1.js");',
	);
	await writeFile(
		join(root, 'assets/ffmpeg-A1.js'),
		'import { createEditorFfmpeg } from "./editor-ffmpeg-runtime-B2.js"; export { createEditorFfmpeg };',
	);
	await writeFile(
		join(root, 'assets/editor-ffmpeg-runtime-B2.js'),
		'const core = "ffmpeg-core.wasm"; import("./browser-ffmpeg-runtime-C3.js"); '
			+ 'import "./ffmpeg-runtime-public-policy-D4.js"; import("./esm-E5.js");',
	);
	await writeFile(
		join(root, 'assets/browser-ffmpeg-runtime-C3.js'),
		'const manager = "createBrowserFfmpegRuntimeManager"; const core = "@ffmpeg/core";',
	);
	await writeFile(
		join(root, 'assets/ffmpeg-runtime-public-policy-D4.js'),
		'const origin = "https://assets.soundscaper.org/runtime/ffmpeg/0.12.10";',
	);
	await writeFile(
		join(root, 'assets/esm-E5.js'),
		'new Worker(new URL("./worker-F6.js", import.meta.url));',
	);
	await writeFile(join(root, 'assets/worker-F6.js'), 'const core = "@ffmpeg/core";');

	assert.deepEqual(auditBrowserBundleCodecComposition({ root }), {
		status: 'browser-codec-composition', inspectedFileCount: 8,
	});
	await writeFile(join(root, 'assets/editor.js'), 'import "./ffmpeg-A1.js";');
	assert.throws(
		() => auditBrowserBundleCodecComposition({ root }),
		/FFmpeg facade is statically reachable/iu,
	);
});

test('the production build gate runs the browser codec audit', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-browser-codecs-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	context.mock.method(console, 'log', () => {});
	await mkdir(join(root, 'assets'));
	await writeFile(join(root, 'assets/editor.js'), 'const provider = "dedicated-browser-codecs";');

	assert.doesNotThrow(() => checkBuildChunks(root));
	await writeFile(join(root, 'assets/editor.js'), 'import("@ffmpeg/ffmpeg");');
	assert.throws(
		() => checkBuildChunks(root),
		/browser bundle retains an application-supplied FFmpeg seam/iu,
	);
});
