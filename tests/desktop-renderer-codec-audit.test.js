/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditDesktopRendererCodecComposition } from '../scripts/lib/desktop-renderer-codec-audit.mjs';

test('desktop renderer audit rejects every browser FFmpeg runtime seam', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-desktop-renderer-codecs-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'assets'));
	await writeFile(join(root, 'index.html'), '<script src="/assets/editor.js"></script>');
	await writeFile(join(root, 'assets/editor.js'), 'const provider = "desktop-main-process";');
	assert.deepEqual(await auditDesktopRendererCodecComposition({ root }), {
		status: 'desktop-codec-composition', inspectedFileCount: 2,
	});

	for (const token of [
		'browser-ffmpeg-runtime-A1.js',
		'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10',
		'ffmpeg-core.wasm',
		'soundscaper-ffmpeg-runtime-v1-',
	]) {
		await writeFile(join(root, 'assets/editor.js'), `const forbidden = ${JSON.stringify(token)};`);
		await assert.rejects(
			() => auditDesktopRendererCodecComposition({ root }),
			/browser FFmpeg runtime/iu,
		);
	}
});
