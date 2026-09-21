/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	capturePackagedAppAsarAfterCollection,
	capturePackagedAppAsarBeforeLaunch,
	resolvePackagedAppAsarPath,
} from './browser/helpers/packaged-runtime-coverage.js';

test('packaged app.asar paths follow each Electron platform layout', () => {
	assert.equal(
		resolvePackagedAppAsarPath('/opt/Soundscaper/soundscaper', 'linux'),
		'/opt/Soundscaper/resources/app.asar',
	);
	assert.equal(
		resolvePackagedAppAsarPath(String.raw`C:\Program Files\Soundscaper\Soundscaper.exe`, 'win32'),
		String.raw`C:\Program Files\Soundscaper\resources\app.asar`,
	);
	assert.equal(
		resolvePackagedAppAsarPath(
			'/Applications/Soundscaper.app/Contents/MacOS/Soundscaper',
			'darwin',
		),
		'/Applications/Soundscaper.app/Contents/Resources/app.asar',
	);
});

test('packaged app.asar identity binds byte length and sha256 before launch', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-app-asar-'));
	context.after(() => rm(root, { force: true, recursive: true }));
	const executablePath = join(root, 'Soundscaper', 'soundscaper');
	const archivePath = resolvePackagedAppAsarPath(executablePath, 'linux');
	const bytes = Buffer.from('packaged application archive');
	await mkdir(dirname(archivePath), { recursive: true });
	await writeFile(archivePath, bytes);

	assert.deepEqual(await capturePackagedAppAsarBeforeLaunch({ executablePath, platform: 'linux' }), {
		path: archivePath,
		beforeLaunch: {
			byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		},
	});
});

test('packaged app.asar collection refuses an archive mutated after launch', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-app-asar-mutation-'));
	context.after(() => rm(root, { force: true, recursive: true }));
	const executablePath = join(root, 'Soundscaper', 'soundscaper');
	const archivePath = resolvePackagedAppAsarPath(executablePath, 'linux');
	await mkdir(dirname(archivePath), { recursive: true });
	await writeFile(archivePath, 'first');
	const beforeLaunch = await capturePackagedAppAsarBeforeLaunch({ executablePath, platform: 'linux' });
	await writeFile(archivePath, 'other');

	await assert.rejects(
		capturePackagedAppAsarAfterCollection(beforeLaunch),
		/app\.asar changed between launch and collection/iu,
	);
});
