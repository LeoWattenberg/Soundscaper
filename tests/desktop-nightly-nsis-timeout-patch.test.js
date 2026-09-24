/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const crossSpawn = require('cross-spawn');
const { spawnAndWriteWithOutput } = require('builder-util/out/util.js');
const nightlyConfig = require('../electron-builder.nightly-tests.config.cjs');
const patchPath = resolve('patches/npm/builder-util+26.15.3.patch');

test('the nightly test launcher gets a longer NSIS compile deadline without changing ordinary packaging', async () => {
	const patch = await readFile(patchPath, 'utf8');
	assert.match(patch, /node_modules\/builder-util\/out\/util\.js/u);
	assert.match(patch, /nightly-with-tests-/u);
	assert.match(nightlyConfig.artifactName, /-nightly-with-tests-/u);
	assert.deepEqual(nightlyConfig.win.target, ['portable']);

	const scheduled = [];
	const originalSpawn = crossSpawn.spawn;
	const originalSetTimeout = globalThis.setTimeout;
	crossSpawn.spawn = () => {
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.stdin = { end: () => queueMicrotask(() => child.emit('close', 0)) };
		child.kill = () => child.emit('close', null);
		return child;
	};
	globalThis.setTimeout = (callback, delay, ...args) => {
		scheduled.push(delay);
		return originalSetTimeout(callback, delay, ...args);
	};
	try {
		await spawnAndWriteWithOutput('C:\\tools\\makensis.exe', [
			'-XOutFile "Soundscaper-1.0.0-nightly-with-tests-win-x64.exe"',
		], 'script');
		assert.equal(scheduled.at(-1), 20 * 60 * 1000);

		await spawnAndWriteWithOutput('C:\\tools\\makensis.exe', [
			'-XOutFile "Soundscaper-1.0.0-win-x64.exe"',
		], 'script');
		assert.equal(scheduled.at(-1), 4 * 60 * 1000);

		await spawnAndWriteWithOutput('some-other-tool.exe', [
			'-XOutFile "Soundscaper-1.0.0-nightly-with-tests-win-x64.exe"',
		], 'script');
		assert.equal(scheduled.at(-1), 4 * 60 * 1000);
	} finally {
		crossSpawn.spawn = originalSpawn;
		globalThis.setTimeout = originalSetTimeout;
	}
});
