/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	ELECTRON_ALTERNATE_FFMPEG_MANIFEST,
	normalizeElectronAlternateFfmpegManifest,
	verifyPackagedElectronAlternateFfmpeg,
} from '../scripts/lib/electron-alternate-ffmpeg.mjs';

const ARCH = Object.freeze({ x64: 1, arm64: 3 });

test('alternate Electron FFmpeg evidence covers exactly five targets and excludes macOS x64', () => {
	assert.equal(ELECTRON_ALTERNATE_FFMPEG_MANIFEST.electronVersion, '43.1.1');
	assert.equal(ELECTRON_ALTERNATE_FFMPEG_MANIFEST.profile,
		'electron-alternate-without-proprietary-codecs');
	assert.deepEqual(ELECTRON_ALTERNATE_FFMPEG_MANIFEST.targets.map(({ target }) => target), [
		'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
	]);
	for (const row of ELECTRON_ALTERNATE_FFMPEG_MANIFEST.targets) {
		assert.match(row.archiveSha256, /^[0-9a-f]{64}$/u);
		assert.match(row.sha256, /^[0-9a-f]{64}$/u);
		assert.ok(row.byteLength > 1_000_000);
	}
	assert.throws(() => normalizeElectronAlternateFfmpegManifest({
		...ELECTRON_ALTERNATE_FFMPEG_MANIFEST,
		targets: ELECTRON_ALTERNATE_FFMPEG_MANIFEST.targets.map((row, index) => index === 2
			? { ...row, target: 'mac-x64' }
			: row),
	}), /manifest|target/iu);
});

test('post-package verification binds the exact alternate library before signing', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-electron-ffmpeg-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const bytes = Buffer.from('fixture Electron alternate media library');
	const manifest = fixtureManifest('linux-x64', bytes);
	const path = join(root, 'libffmpeg.so');
	await writeFile(path, bytes);

	assert.deepEqual(await verifyPackagedElectronAlternateFfmpeg(
		packagingContext(root, 'linux', 'x64'), { manifest },
	), {
		status: 'verified-electron-alternate-ffmpeg',
		target: 'linux-x64',
		sha256: digest(bytes),
	});
	await writeFile(path, 'default or tampered library');
	await assert.rejects(
		() => verifyPackagedElectronAlternateFfmpeg(
			packagingContext(root, 'linux', 'x64'), { manifest },
		),
		/alternate FFmpeg linux-x64.*byte length|digest/iu,
	);
});

test('macOS verification resolves only the ARM64 Electron framework library', async () => {
	const bytes = Buffer.from('mac alternate library');
	const manifest = fixtureManifest('mac-arm64', bytes);
	const root = '/release/mac-arm64';
	let inspectedPath = '';
	const result = await verifyPackagedElectronAlternateFfmpeg(
		packagingContext(root, 'darwin', 'arm64'), {
			manifest,
			lstat: async (path) => {
				inspectedPath = path;
				return { isFile: () => true, isSymbolicLink: () => false, size: bytes.byteLength };
			},
			readFile: async (path) => {
				assert.equal(path, inspectedPath);
				return bytes;
			},
		},
	);
	assert.equal(result.target, 'mac-arm64');
	assert.equal(inspectedPath, join(
		root, 'Soundscaper.app', 'Contents', 'Frameworks',
		'Electron Framework.framework', 'Versions', 'A', 'Libraries', 'libffmpeg.dylib',
	));
	await assert.rejects(
		() => verifyPackagedElectronAlternateFfmpeg(
			packagingContext(root, 'darwin', 'x64'), { manifest },
		),
		/mac-x64|macOS x64|unsupported/iu,
	);
});

function fixtureManifest(target, bytes) {
	return {
		...ELECTRON_ALTERNATE_FFMPEG_MANIFEST,
		targets: ELECTRON_ALTERNATE_FFMPEG_MANIFEST.targets.map((row) => row.target === target
			? { ...row, byteLength: bytes.byteLength, sha256: digest(bytes) }
			: row),
	};
}

function packagingContext(appOutDir, electronPlatformName, architecture) {
	return {
		electronPlatformName,
		arch: ARCH[architecture],
		appOutDir,
		packager: { appInfo: { productFilename: 'Soundscaper' } },
	};
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
