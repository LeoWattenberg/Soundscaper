/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * electron-builder's output directory is a work area: beside the installers it
 * leaves its unpacked application tree, an icon-set directory, a debug log and
 * update metadata. The Milestone 5 audit is fail-closed on entries it did not
 * expect, so pointing it straight at that directory refused every packaged
 * build with "Desktop release input is not a regular file: .icon-set,
 * linux-unpacked". These checks pin the staging that hands the audit the
 * release inputs and nothing else.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { stageMilestone5PackageRoot } from '../scripts/stage-milestone-5-package-root.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('staging keeps the release inputs and drops everything packaging left behind', async (context) => {
	const { packageRoot, outputRoot, releaseNames } = await packagingOutput(context);
	const result = await stageMilestone5PackageRoot({
		repositoryRoot: ROOT, packageRoot, outputRoot, productId: 'soundscaper', targetId: 'linux-x64',
	});

	assert.deepEqual([...result.staged].sort(), [...releaseNames].sort());
	const staged = await readdir(outputRoot, { withFileTypes: true });
	assert.deepEqual(staged.map(({ name }) => name).sort(), [...releaseNames].sort());
	for (const entry of staged) {
		assert.equal(entry.isFile() && !entry.isSymbolicLink(), true, `${entry.name} must be a regular file`);
	}
	assert.equal(await readFile(join(outputRoot, 'ffmpeg-corresponding-source.json'), 'utf8'), 'source');
});

test('staging refuses a target whose packaging did not produce every release file', async (context) => {
	const { packageRoot, outputRoot, releaseNames } = await packagingOutput(context);
	await rm(join(packageRoot, releaseNames.find((name) => name.endsWith('.deb'))));
	await assert.rejects(() => stageMilestone5PackageRoot({
		repositoryRoot: ROOT, packageRoot, outputRoot, productId: 'soundscaper', targetId: 'linux-x64',
	}), /no single Linux x64 Debian package/u);

	const withoutManifest = await packagingOutput(context);
	await rm(join(withoutManifest.packageRoot, 'runtime-manifest-soundscaper-linux-x64.json'));
	await assert.rejects(() => stageMilestone5PackageRoot({
		repositoryRoot: ROOT,
		packageRoot: withoutManifest.packageRoot,
		outputRoot: withoutManifest.outputRoot,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}), /runtime-manifest-soundscaper-linux-x64\.json/u);
});

async function packagingOutput(context) {
	const root = await mkdtemp(join(tmpdir(), 'm5-package-root-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const packageRoot = join(root, 'desktop');
	const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
	const releaseNames = [
		`Soundscaper-${version}-linux-x86_64.AppImage`,
		`Soundscaper-${version}-linux-amd64.deb`,
		'runtime-manifest-soundscaper-linux-x64.json',
		'ffmpeg-corresponding-source.json',
	];
	await mkdir(packageRoot, { recursive: true });
	for (const name of releaseNames) await writeFile(join(packageRoot, name), 'source');
	// Everything packaging leaves beside the release files.
	await mkdir(join(packageRoot, 'linux-unpacked', 'resources'), { recursive: true });
	await mkdir(join(packageRoot, '.icon-set'), { recursive: true });
	await writeFile(join(packageRoot, 'builder-debug.yml'), 'debug');
	await writeFile(join(packageRoot, `Soundscaper-${version}-linux-x86_64.AppImage.blockmap`), 'map');
	await symlink(join(packageRoot, 'builder-debug.yml'), join(packageRoot, 'builder-debug-link.yml'));
	return { packageRoot, outputRoot: join(root, 'milestone-5-package'), releaseNames };
}
