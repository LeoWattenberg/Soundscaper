/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	capturePackagedExecutableResourcesAfterCollection,
	capturePackagedExecutableResourcesBeforeLaunch,
	collectPackagedExecutableResourceFiles,
	packagedExecutableResourceIdentity,
	resolvePackagedResourcesPath,
} from '../scripts/lib/packaged-executable-resource-identity.mjs';

test('packaged executable resources resolve every Electron platform layout', () => {
	assert.equal(
		resolvePackagedResourcesPath('/opt/Soundscaper/soundscaper', 'linux'),
		'/opt/Soundscaper/resources',
	);
	assert.equal(
		resolvePackagedResourcesPath('C:\\Program Files\\Soundscaper\\Soundscaper.exe', 'win32'),
		'C:\\Program Files\\Soundscaper\\resources',
	);
	assert.equal(
		resolvePackagedResourcesPath('/Applications/Soundscaper.app/Contents/MacOS/Soundscaper', 'darwin'),
		'/Applications/Soundscaper.app/Contents/Resources',
	);
});

test('packaged executable resource identity binds every external script before and after launch', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-executable-resources-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const executablePath = join(root, 'soundscaper');
	const resources = join(root, 'resources');
	await mkdir(join(resources, 'runtime/vendor'), { recursive: true });
	await mkdir(join(resources, 'renderer/assets'), { recursive: true });
	await writeFile(join(resources, 'runtime/vendor/index.cjs'), 'module.exports = true;\n');
	await writeFile(join(resources, 'renderer/assets/editor.js'), 'globalThis.editor = true;\n');
	await writeFile(join(resources, 'renderer/index.html'), '<main></main>\n');

	const files = await collectPackagedExecutableResourceFiles(resources);
	assert.deepEqual(files.map(({ path }) => path), [
		'renderer/assets/editor.js',
		'renderer/index.html',
		'runtime/vendor/index.cjs',
	]);
	const identity = packagedExecutableResourceIdentity(files);
	assert.equal(identity.fileCount, 3);
	assert.equal(identity.totalBytes, 63);
	assert.match(identity.sha256, /^[a-f\d]{64}$/u);

	const before = await capturePackagedExecutableResourcesBeforeLaunch({
		executablePath,
		platform: 'linux',
	});
	const complete = await capturePackagedExecutableResourcesAfterCollection(before);
	assert.deepEqual(complete.beforeLaunch, complete.afterCollection);

	await writeFile(join(resources, 'runtime/vendor/late.js'), 'void 0;\n');
	await assert.rejects(
		capturePackagedExecutableResourcesAfterCollection(before),
		/changed between launch and collection/u,
	);
});
