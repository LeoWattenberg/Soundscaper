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
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	MILESTONE_5_PACKAGE_ROOT,
	stageMilestone5PackageRoot,
} from '../scripts/stage-milestone-5-package-root.mjs';

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
	await assert.rejects(
		readFile(join(outputRoot, 'ffmpeg-corresponding-source.json'), 'utf8'),
		{ code: 'ENOENT' },
		'the web-runtime FFmpeg source manifest must not enter desktop release inputs',
	);
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

test('staging refuses an output root that would swallow the packaging output', async (context) => {
	const { packageRoot } = await packagingOutput(context);
	await assert.rejects(() => stageMilestone5PackageRoot({
		repositoryRoot: ROOT,
		packageRoot,
		outputRoot: dirname(packageRoot),
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}), /cannot contain the packaging output/u);
});

test('staging selects package names from the independent product release line', async (context) => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'm5-divergent-release-lines-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const releaseLines = JSON.parse(await readFile(join(ROOT, 'config/product-release-lines.json'), 'utf8'));
	releaseLines.products.framescaper.candidate.version = '0.9.0-rc.7';
	await mkdir(join(repositoryRoot, 'config'), { recursive: true });
	await writeFile(join(repositoryRoot, 'package.json'), JSON.stringify({
		name: 'soundscaper', version: releaseLines.products.soundscaper.candidate.version,
	}));
	await writeFile(
		join(repositoryRoot, 'config/product-release-lines.json'),
		`${JSON.stringify(releaseLines, null, 2)}\n`,
	);
	const packageRoot = join(repositoryRoot, 'release/desktop');
	const outputRoot = join(repositoryRoot, 'release/milestone-5-package');
	const releaseNames = [
		'Framescaper-0.9.0-rc.7-linux-x86_64.AppImage',
		'Framescaper-0.9.0-rc.7-linux-amd64.deb',
		'runtime-manifest-framescaper-linux-x64.json',
	];
	await mkdir(packageRoot, { recursive: true });
	for (const name of releaseNames) await writeFile(join(packageRoot, name), 'source');
	const result = await stageMilestone5PackageRoot({
		repositoryRoot, packageRoot, outputRoot, productId: 'framescaper', targetId: 'linux-x64',
	});
	assert.deepEqual([...result.staged], releaseNames);
});

test('the staged package root is invisible to git', () => {
	// The handoff authenticates its source revision against a clean worktree, so
	// a staged root git can see refuses the very release it was staged for — the
	// packaged macOS jobs died on "worktree and index must be clean" for exactly
	// that reason. Ignoring it is part of the contract, not housekeeping.
	const ignored = spawnSync('git', ['check-ignore', '--quiet', `${MILESTONE_5_PACKAGE_ROOT}/`], { cwd: ROOT });
	assert.equal(ignored.status, 0, `${MILESTONE_5_PACKAGE_ROOT}/ must be listed in .gitignore`);
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
	];
	await mkdir(packageRoot, { recursive: true });
	for (const name of releaseNames) await writeFile(join(packageRoot, name), 'source');
	// Everything packaging leaves beside the release files.
	await writeFile(join(packageRoot, 'ffmpeg-corresponding-source.json'), 'legacy web-runtime source evidence');
	await mkdir(join(packageRoot, 'linux-unpacked', 'resources'), { recursive: true });
	await mkdir(join(packageRoot, '.icon-set'), { recursive: true });
	await writeFile(join(packageRoot, 'builder-debug.yml'), 'debug');
	await writeFile(join(packageRoot, `Soundscaper-${version}-linux-x86_64.AppImage.blockmap`), 'map');
	await symlink(join(packageRoot, 'builder-debug.yml'), join(packageRoot, 'builder-debug-link.yml'));
	return { packageRoot, outputRoot: join(root, 'milestone-5-package'), releaseNames };
}
