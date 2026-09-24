/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createPackage } from '@electron/asar';

import {
	capturePackagedAppAsarAfterCollection,
	capturePackagedAppAsarBeforeLaunch,
	resolvePackagedAppAsarPath,
} from './browser/helpers/packaged-runtime-coverage.js';

const execFileAsync = promisify(execFile);
const electronPath: unknown = createRequire(import.meta.url)('electron');

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

test('packaged app.asar identity reads raw bytes in an Electron-as-Node worker', async (context) => {
	if (typeof electronPath !== 'string') throw new TypeError('Installed Electron executable is unavailable.');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-electron-asar-'));
	context.after(() => rm(root, { force: true, recursive: true }));
	const source = join(root, 'source');
	const platform = process.platform;
	const executablePath = platform === 'darwin'
		? join(root, 'Soundscaper.app', 'Contents', 'MacOS', 'Soundscaper')
		: join(root, 'product', platform === 'win32' ? 'Soundscaper.exe' : 'soundscaper');
	const archivePath = resolvePackagedAppAsarPath(executablePath, platform);
	await mkdir(source, { recursive: true });
	await mkdir(dirname(archivePath), { recursive: true });
	await writeFile(join(source, 'package.json'), '{"name":"test","main":"main.js"}');
	await writeFile(join(source, 'main.js'), 'console.log("test");');
	await createPackage(source, archivePath);
	const expected = await capturePackagedAppAsarBeforeLaunch({ executablePath, platform });
	const script = `
		import { capturePackagedAppAsarBeforeLaunch } from ${JSON.stringify(new URL('./browser/helpers/packaged-runtime-coverage.js', import.meta.url).href)};
		const result = await capturePackagedAppAsarBeforeLaunch({ executablePath: process.argv[1], platform: process.platform });
		console.log(JSON.stringify(result));
	`;
	const { stdout } = await execFileAsync(electronPath, ['--input-type=module', '-e', script, executablePath], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
	});
	assert.deepEqual(JSON.parse(stdout), expected);
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
