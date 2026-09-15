/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateDesktopNightlyTestsSplash } from '../scripts/desktop-icons.mjs';

test('the Windows portable launcher gets an opaque 24-bit extraction splash', async context => {
	const root = await mkdtemp(join(tmpdir(), 'nightly-splash-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputPath = join(root, 'nightly-tests-splash.bmp');
	await generateDesktopNightlyTestsSplash({ outputPath });
	const bmp = await readFile(outputPath);
	assert.equal(bmp.toString('ascii', 0, 2), 'BM');
	assert.equal(bmp.readUInt32LE(2), bmp.length);
	assert.equal(bmp.readUInt32LE(10), 54);
	assert.equal(bmp.readInt32LE(18), 600);
	assert.equal(bmp.readInt32LE(22), 220);
	assert.equal(bmp.readUInt16LE(26), 1);
	assert.equal(bmp.readUInt16LE(28), 24);
	assert.equal(bmp.readUInt32LE(30), 0);
	assert.equal(bmp.length, 54 + 600 * 220 * 3);
	assert.ok(new Set(bmp.subarray(54)).size > 10, 'the splash must not be a blank rectangle');
	const source = await readFile(new URL('../scripts/desktop-icons.mjs', import.meta.url), 'utf8');
	assert.match(source, /Launcher started/u);
	assert.match(source, /Extracting the bundled test tools/u);
});
