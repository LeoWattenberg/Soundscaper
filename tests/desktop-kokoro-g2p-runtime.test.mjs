/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { createPackage } from '@electron/asar';
import { verifyPackagedKokoroG2pRuntime } from '../scripts/desktop-after-pack.mjs';
import { verifyStagedKokoroG2pRuntime } from '../scripts/desktop-before-pack.mjs';

import {
	describeDesktopKokoroG2pBundle,
	stageDesktopKokoroG2pRuntime,
	verifyDesktopKokoroG2pRuntime,
} from '../scripts/lib/desktop-kokoro-g2p-runtime.mjs';
import {
	kokoroG2pBuildPlan,
	materializeKokoroG2pSymlinks,
	normalizeKokoroG2pEmptyFiles,
} from '../scripts/kokoro-g2p/build.mjs';

const runFile = promisify(execFile);

test('the Kokoro G2P dependency lock matches its reviewed candidate pin', async () => {
	const [candidate, lock] = await Promise.all([
		readFile(new URL('../config/assistance-kokoro-g2p-build-candidate.json', import.meta.url), 'utf8')
			.then(JSON.parse),
		readFile(new URL('../scripts/kokoro-g2p/uv.lock', import.meta.url)),
	]);
	assert.equal(createHash('sha256').update(lock).digest('hex'), candidate.dependencyLock.sha256);
});

test('a Windows checkout preserves the digest-pinned Kokoro bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-kokoro-notice-checkout-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = 'scripts/kokoro-g2p/notices/espeak-ng-COPYING';
	const lockPath = 'scripts/kokoro-g2p/uv.lock';
	const [notice, candidate] = await Promise.all([
		readFile(new URL('../scripts/kokoro-g2p/notices/sources.json', import.meta.url), 'utf8')
			.then(JSON.parse).then(({ notices }) => notices.find((entry) => entry.path === 'espeak-ng-COPYING')),
		readFile(new URL('../config/assistance-kokoro-g2p-build-candidate.json', import.meta.url), 'utf8')
			.then(JSON.parse),
	]);
	assert(notice);
	await mkdir(dirname(join(root, path)), { recursive: true });
	await copyFile(new URL('../.gitattributes', import.meta.url), join(root, '.gitattributes'));
	await Promise.all([path, lockPath].map((name) => copyFile(new URL(`../${name}`, import.meta.url), join(root, name))));
	const git = async (args) => runFile('git', [
		'-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', '-c', 'core.attributesFile=', ...args,
	], { cwd: root, windowsHide: true });
	await git(['init', '--quiet']);
	await git(['add', '--', '.gitattributes', path, lockPath]);
	await Promise.all([path, lockPath].map((name) => rm(join(root, name))));
	await git(['checkout-index', '--force', '--', path, lockPath]);
	const [bytes, lock] = await Promise.all([path, lockPath].map((name) => readFile(join(root, name))));
	assert.equal(bytes.byteLength, notice.byteLength);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), notice.sha256);
	assert.equal(createHash('sha256').update(lock).digest('hex'), candidate.dependencyLock.sha256);
});

test('build plan requires a native runner or Windows ARM64 x64 emulation', () => {
	for (const [targetId, platform, arch, executable] of [
		['mac-arm64', 'darwin', 'arm64', 'kokoro-g2p'],
		['linux-x64', 'linux', 'x64', 'kokoro-g2p'],
		['linux-arm64', 'linux', 'arm64', 'kokoro-g2p'],
		['win-x64', 'win32', 'x64', 'kokoro-g2p.exe'],
	]) {
		const nativePlan = kokoroG2pBuildPlan({ targetId, platform, arch });
		assert.equal(nativePlan.executable, executable);
		assert.deepEqual(nativePlan.uv, {
			python: '3.12',
			syncArguments: ['sync', '--locked', '--no-dev'],
		});
	}
	for (const arch of ['arm64', 'x64']) {
		const emulatedPlan = kokoroG2pBuildPlan({ targetId: 'win-arm64', platform: 'win32', arch });
		assert.equal(emulatedPlan.pythonArchitecture, 'x64');
		assert.deepEqual(emulatedPlan.uv, {
			python: 'cpython-3.12-windows-x86_64-none',
			syncArguments: [
				'sync', '--locked', '--no-dev', '--python-platform', 'x86_64-pc-windows-msvc',
			],
		});
	}
	assert.throws(() => kokoroG2pBuildPlan({ targetId: 'linux-arm64', platform: 'linux', arch: 'x64' }), /native/u);
});

async function fixture(run) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-kokoro-g2p-'));
	try {
		const bundleRoot = join(root, 'bundle');
		const runtimeRoot = join(root, 'runtime');
		await mkdir(join(bundleRoot, 'data'), { recursive: true });
		await mkdir(join(bundleRoot, 'licenses', 'python', 'example'), { recursive: true });
		await writeFile(join(bundleRoot, 'kokoro-g2p'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
		await writeFile(join(bundleRoot, 'data', 'lexicon.txt'), 'bonjour\n');
		const license = Buffer.from('Example license\n');
		await writeFile(join(bundleRoot, 'licenses', 'python', 'example', 'LICENSE'), license);
		await writeFile(join(bundleRoot, 'python-license-inventory.json'), `${JSON.stringify({
			schemaVersion: 1,
			packages: [{ name: 'example', version: '1.0.0', notices: [{
				path: 'licenses/python/example/LICENSE', byteLength: license.length,
				sha256: createHash('sha256').update(license).digest('hex'),
			}] }],
		})}\n`);
		await run({ bundleRoot, runtimeRoot });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('stages and authenticates an exact target-specific offline G2P closure', async () => {
	await fixture(async ({ bundleRoot, runtimeRoot }) => {
		const result = await stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		});
		assert.equal(result.manifest.runtimePrefix, 'assistance/kokoro-g2p/0.9.4');
		assert.equal(result.manifest.executable, 'kokoro-g2p');
		assert.deepEqual(result.manifest.files.map(({ path }) => path), [
			'data/lexicon.txt', 'kokoro-g2p', 'licenses/python/example/LICENSE', 'python-license-inventory.json',
		]);
		assert.deepEqual(await describeDesktopKokoroG2pBundle({ targetId: 'linux-x64', bundleRoot }),
			result.manifest);
		await verifyDesktopKokoroG2pRuntime({
			manifest: result.manifest, targetId: 'linux-x64', runtimeRoot,
		});
		const targetRoot = join(runtimeRoot, 'assistance', 'kokoro-g2p', '0.9.4', 'linux-x64');
		await writeFile(join(targetRoot, 'data', 'lexicon.txt'), 'tampered\n');
		await assert.rejects(verifyDesktopKokoroG2pRuntime({
			manifest: result.manifest, targetId: 'linux-x64', runtimeRoot,
		}), /digest|length/u);
	});
});

test('describes a large G2P bundle within a restricted file descriptor limit', {
	skip: process.platform === 'win32',
}, async () => {
	await fixture(async ({ bundleRoot }) => {
		await Promise.all(Array.from({ length: 128 }, (_, index) => (
			writeFile(join(bundleRoot, 'data', `entry-${String(index).padStart(3, '0')}.txt`), `${index}\n`)
		)));
		const moduleHref = new URL('../scripts/lib/desktop-kokoro-g2p-runtime.mjs', import.meta.url).href;
		const program = `
			import { describeDesktopKokoroG2pBundle } from ${JSON.stringify(moduleHref)};
			const manifest = await describeDesktopKokoroG2pBundle({
				targetId: 'linux-x64', bundleRoot: process.argv[1],
			});
			process.stdout.write(String(manifest.files.length));
		`;
		const { stdout } = await runFile('bash', [
			join(import.meta.dirname, 'fixtures/limit-open-files.sh'),
			process.execPath, '--input-type=module', '--eval', program, bundleRoot,
		], { windowsHide: true });
		assert.equal(stdout, '132');
	});
});

test('rejects extra staged files and a target mismatch', async () => {
	await fixture(async ({ bundleRoot, runtimeRoot }) => {
		const { manifest } = await stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		});
		await assert.rejects(verifyDesktopKokoroG2pRuntime({
			manifest, targetId: 'linux-arm64', runtimeRoot,
		}), /target/u);
		const targetRoot = join(runtimeRoot, 'assistance', 'kokoro-g2p', '0.9.4', 'linux-x64');
		await writeFile(join(targetRoot, 'untracked.txt'), 'extra');
		await assert.rejects(verifyDesktopKokoroG2pRuntime({
			manifest, targetId: 'linux-x64', runtimeRoot,
		}), /inventory/u);
	});
});

test('refuses symlinks and missing executable in a build bundle', async () => {
	await fixture(async ({ bundleRoot, runtimeRoot }) => {
		await symlink(join(bundleRoot, 'data', 'lexicon.txt'), join(bundleRoot, 'data', 'linked.txt'));
		await assert.rejects(stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		}), /symbolic link/u);
		await rm(join(bundleRoot, 'data', 'linked.txt'));
		await rm(join(bundleRoot, 'kokoro-g2p'));
		await assert.rejects(stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		}), /executable/u);
	});
});

test('materializes only symlinks whose targets stay in the frozen bundle', async () => {
	await fixture(async ({ bundleRoot, runtimeRoot }) => {
		await symlink('lexicon.txt', join(bundleRoot, 'data', 'alias.txt'));
		const materialized = await materializeKokoroG2pSymlinks(bundleRoot);
		assert.equal(materialized.materializedLinks, 1);
		const { manifest } = await stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		});
		assert(manifest.files.some(({ path }) => path === 'data/alias.txt'));
		await symlink('/etc/hosts', join(bundleRoot, 'data', 'outside.txt'));
		await assert.rejects(materializeKokoroG2pSymlinks(bundleRoot), /escapes/u);
	});
});

test('normalizes only empty Python and package marker files', async () => {
	await fixture(async ({ bundleRoot, runtimeRoot }) => {
		await writeFile(join(bundleRoot, 'data', '__init__.py'), '');
		await writeFile(join(bundleRoot, 'data', 'py.typed'), '');
		const receipt = await normalizeKokoroG2pEmptyFiles(bundleRoot);
		assert.deepEqual(receipt.paths, ['data/__init__.py', 'data/py.typed']);
		assert.equal(await readFile(join(bundleRoot, 'data', '__init__.py'), 'utf8'), '\n');
		await stageDesktopKokoroG2pRuntime({ targetId: 'linux-x64', bundleRoot, runtimeRoot });
		await writeFile(join(bundleRoot, 'data', 'binary.bin'), '');
		await assert.rejects(normalizeKokoroG2pEmptyFiles(bundleRoot), /unexpected empty file/u);
	});
});

test('requires every installed Python package to carry a verified license notice', async () => {
	await fixture(async ({ bundleRoot, runtimeRoot }) => {
		const inventoryPath = join(bundleRoot, 'python-license-inventory.json');
		const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
		inventory.packages[0].notices = [];
		await writeFile(inventoryPath, `${JSON.stringify(inventory)}\n`);
		await assert.rejects(stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		}), /license notice.*example@1\.0\.0/u);
		inventory.packages[0].name = 'espeakng-loader';
		inventory.packages[0].version = '0.2.4';
		await writeFile(inventoryPath, `${JSON.stringify(inventory)}\n`);
		await mkdir(join(bundleRoot, 'licenses/upstream'), { recursive: true });
		await writeFile(join(bundleRoot, 'licenses/upstream/espeakng-loader-LICENSE'),
			await readFile(new URL('../scripts/kokoro-g2p/notices/espeakng-loader-LICENSE', import.meta.url)));
		await stageDesktopKokoroG2pRuntime({ targetId: 'linux-x64', bundleRoot, runtimeRoot });
		inventory.packages[0].version = '0.2.5';
		await writeFile(inventoryPath, `${JSON.stringify(inventory)}\n`);
		await assert.rejects(stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		}), /license notice.*espeakng-loader@0\.2\.5/u);
	});
});

test('rejects a license inventory whose declared wheel notice was modified', async () => {
	await fixture(async ({ bundleRoot, runtimeRoot }) => {
		await writeFile(join(bundleRoot, 'licenses/python/example/LICENSE'), 'changed notice\n');
		await assert.rejects(stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		}), /license notice.*digest|license notice.*length/u);
	});
});

test('rejects a noncanonical manifest path before reading files', async () => {
	await fixture(async ({ bundleRoot, runtimeRoot }) => {
		const { manifest } = await stageDesktopKokoroG2pRuntime({
			targetId: 'linux-x64', bundleRoot, runtimeRoot,
		});
		manifest.files[0].path = '../outside';
		await assert.rejects(verifyDesktopKokoroG2pRuntime({
			manifest, targetId: 'linux-x64', runtimeRoot,
		}), /path/u);
		assert.equal((await readFile(join(bundleRoot, 'data', 'lexicon.txt'), 'utf8')), 'bonjour\n');
	});
});

test('legacy stage skips G2P only while receipt, config, and runtime are all absent', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-g2p-stage-legacy-'));
	try {
		const stageManifestPath = join(root, '.desktop-build/stage-manifest.json');
		const options = { repositoryRoot: root, stageManifestPath, packagedTarget: 'linux-x64' };
		assert.equal(await verifyStagedKokoroG2pRuntime(options), null);
		await mkdir(join(root, '.desktop-build'), { recursive: true });
		await writeFile(stageManifestPath, `${JSON.stringify({
			productId: 'soundscaper', target: { platform: 'linux', arch: 'x64' },
		})}\n`);
		assert.equal(await verifyStagedKokoroG2pRuntime(options), null);
		await mkdir(join(root, '.desktop-build/runtime/assistance/kokoro-g2p'), { recursive: true });
		await assert.rejects(verifyStagedKokoroG2pRuntime(options), /Kokoro G2P.*receipt/iu);
		await rm(join(root, '.desktop-build/runtime'), { recursive: true });
		await mkdir(join(root, '.desktop-build/app/config'), { recursive: true });
		await writeFile(join(root, '.desktop-build/app/config/assistance-kokoro-g2p-runtime-manifest.json'), '{}');
		await assert.rejects(verifyStagedKokoroG2pRuntime(options), /Kokoro G2P.*receipt/iu);
		await rm(join(root, '.desktop-build/app'), { recursive: true });
		await writeFile(stageManifestPath, `${JSON.stringify({
			productId: 'soundscaper', target: { platform: 'linux', arch: 'x64' },
			kokoroG2pRuntime: null,
		})}\n`);
		await assert.rejects(verifyStagedKokoroG2pRuntime(options), /Kokoro G2P.*receipt/iu);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('legacy package skips G2P only while receipt, ASAR config, and runtime are all absent', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-g2p-package-legacy-'));
	try {
		const resources = join(root, 'resources');
		const stageManifestPath = join(root, 'stage-manifest.json');
		const context = { electronPlatformName: 'linux', arch: 1, appOutDir: root,
			packager: { getResourcesDir: () => resources } };
		const options = { stageManifestPath };
		await mkdir(resources, { recursive: true });
		await writeFile(stageManifestPath, '{}\n');
		assert.equal(await verifyPackagedKokoroG2pRuntime(context, options), null);
		await mkdir(join(resources, 'runtime/assistance/kokoro-g2p'), { recursive: true });
		await assert.rejects(verifyPackagedKokoroG2pRuntime(context, options), /Kokoro G2P.*receipt/iu);
		await rm(join(resources, 'runtime'), { recursive: true });
		const app = join(root, 'app');
		await mkdir(join(app, 'config'), { recursive: true });
		await writeFile(join(app, 'config/assistance-kokoro-g2p-runtime-manifest.json'), '{}');
		await createPackage(app, join(resources, 'app.asar'));
		await assert.rejects(verifyPackagedKokoroG2pRuntime(context, options), /Kokoro G2P.*receipt/iu);
		await writeFile(stageManifestPath, '{"kokoroG2pRuntime":null}\n');
		await assert.rejects(verifyPackagedKokoroG2pRuntime(context, options), /Kokoro G2P.*receipt/iu);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
