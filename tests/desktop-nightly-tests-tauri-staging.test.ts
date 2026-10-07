/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, readFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { prepareDesktopNightlyTests } from '../scripts/desktop-nightly-tests-prepare.mjs';
import { NIGHTLY_TEST_PAYLOAD_INPUTS, stageDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import { validateDesktopNightlyTestsTauriPrototype } from '../scripts/lib/desktop-nightly-tests-tauri-staging.mjs';
import { createFixture, writeFixtureFile } from './helpers/nightly-tests-staging-fixture.js';

const revision = 'a'.repeat(40);
const target = { platform: 'linux', arch: 'x64' };
const executableBytes = 'fake native executable\n';

async function tauriFixture(context: TestContext, platform = 'linux', arch = 'x64') {
	const fixture = await createFixture(context);
	const tauriPrototypeRoot = join(fixture.repositoryRoot, '.tauri-prototype/artifact');
	const executable = `soundscaper-tauri-prototype${platform === 'win' ? '.exe' : ''}`;
	for (const [path, body] of [
		[executable, executableBytes], ['LICENSE', 'AGPL notice\n'], ['THIRD_PARTY_LICENSES.md', 'Browser notices\n'],
		['README.md', 'Prototype documentation\n'], ['SOURCE_REVISION', `${revision}\n`],
		['SOURCE_URL', `https://github.com/LeoWattenberg/Soundscaper/tree/${revision}\n`],
		['TARGET.json', JSON.stringify({ platform, arch, rustTarget: 'x86_64-unknown-linux-gnu' })],
		['prototypes/tauri/host/Cargo.toml', 'Pinned manifest\n'], ['prototypes/tauri/host/Cargo.lock', 'Pinned lock\n'],
		['prototypes/tauri/host/rust-toolchain.toml', 'Pinned Rust\n'], ['LICENSES/GPL-3.0.txt', 'GPL notice\n'],
		['licenses/rust/inventory.json', JSON.stringify([{ name: 'fixture-crate', version: '1.0.0', license: 'MIT',
			repository: null, source: 'registry+fixture', files: ['LICENSE'] }])],
		['licenses/rust/fixture-crate-1.0.0/LICENSE', 'MIT crate notice\n'],
	]) await writeFixtureFile(tauriPrototypeRoot, path!, body);
	await chmod(join(tauriPrototypeRoot, executable), 0o755);
	return { ...fixture, tauriPrototypeRoot, executable };
}

test('nightly staging copies the optional native Tauri artifact and binds its executable and complete tree', async (context) => {
	const fixture = await tauriFixture(context);
	const result = await stageDesktopNightlyTests({ ...fixture, sourceRevision: revision, target });
	assert.deepEqual(result.manifest.tauriPrototype, {
		executable: 'tauri-prototype/soundscaper-tauri-prototype', sourceRevision: revision, target,
		byteLength: Buffer.byteLength(executableBytes), sha256: createHash('sha256').update(executableBytes).digest('hex'),
	});
	assert.equal(await readFile(join(fixture.outputRoot, 'tauri-prototype/soundscaper-tauri-prototype'), 'utf8'), executableBytes);
	assert.equal((await lstat(join(fixture.outputRoot, 'tauri-prototype/soundscaper-tauri-prototype'))).mode & 0o777, 0o755);
	for (const path of ['licenses/rust/fixture-crate-1.0.0/LICENSE', 'LICENSES/GPL-3.0.txt',
		'prototypes/tauri/host/Cargo.lock', 'SOURCE_REVISION', 'SOURCE_URL', 'TARGET.json']) {
		assert.equal(await readFile(join(fixture.outputRoot, 'tauri-prototype', path), 'utf8'),
			await readFile(join(fixture.tauriPrototypeRoot, path), 'utf8'));
	}
	const descriptor = result.manifest.payload.find((entry: { path: string }) => entry.path === 'tauri-prototype');
	assert.ok(descriptor);
	assert.ok(descriptor.byteLength > Buffer.byteLength(executableBytes));
	assert.ok(descriptor.fileCount > 1);
	assert.match(descriptor.sha256, /^[a-f0-9]{64}$/u);
	const firstHash: string = descriptor.sha256;
	await writeFixtureFile(fixture.tauriPrototypeRoot, 'licenses/rust/fixture-crate-1.0.0/LICENSE', 'Updated crate notice\n');
	const updated = await stageDesktopNightlyTests({ ...fixture, sourceRevision: revision, target });
	assert.notEqual(updated.manifest.payload.find((entry: { path: string }) => entry.path === 'tauri-prototype')?.sha256, firstHash);
});

test('nightly preparation forwards optional Tauri artifacts and leaves ordinary builds without a Tauri descriptor', async (context) => {
	const fixture = await tauriFixture(context);
	const prepared = await prepareDesktopNightlyTests({ ...fixture, sourceRevision: revision, target });
	assert.equal(prepared.manifest.tauriPrototype?.sourceRevision, revision);
	const { tauriPrototypeRoot: _artifactRoot, executable: _executable, ...ordinaryFixture } = fixture;
	const ordinary = await stageDesktopNightlyTests({ ...ordinaryFixture, sourceRevision: revision, target });
	assert.equal(Object.hasOwn(ordinary.manifest, 'tauriPrototype'), false);
	assert.equal(ordinary.manifest.payload.some((entry: { path: string }) => entry.path === 'tauri-prototype'), false);
});

test('Tauri artifact admission requires matching source revision and native platform/architecture', async (context) => {
	const fixture = await tauriFixture(context);
	for (const options of [
		{ sourceRevision: 'b'.repeat(40), target }, { sourceRevision: null, target },
		{ sourceRevision: revision, target: { platform: 'win', arch: 'x64' } },
		{ sourceRevision: revision, target: { platform: 'linux', arch: 'arm64' } },
	]) {
		await assert.rejects(validateDesktopNightlyTestsTauriPrototype({ artifactRoot: fixture.tauriPrototypeRoot, ...options }),
			/Tauri prototype.*(?:revision|target)/iu);
	}
	const windows = await tauriFixture(context, 'win');
	const admitted = await validateDesktopNightlyTestsTauriPrototype({ artifactRoot: windows.tauriPrototypeRoot,
		sourceRevision: revision, target: { platform: 'win', arch: 'x64' } });
	assert.equal(admitted.executable, 'soundscaper-tauri-prototype.exe');
});

test('Tauri admission fails before replacing an existing payload when executable, notices, or source pins are absent', async (context) => {
	for (const missing of ['soundscaper-tauri-prototype', 'LICENSE', 'licenses/rust/inventory.json',
		'licenses/rust/fixture-crate-1.0.0/LICENSE', 'prototypes/tauri/host/Cargo.lock', 'TARGET.json']) {
		const fixture = await tauriFixture(context);
		await writeFixtureFile(fixture.outputRoot, 'previous.txt', 'Keep previous payload\n');
		await rm(join(fixture.tauriPrototypeRoot, missing));
		await assert.rejects(stageDesktopNightlyTests({ ...fixture, sourceRevision: revision, target }), /(?:Tauri|Rust).*missing/iu);
		assert.equal(await readFile(join(fixture.outputRoot, 'previous.txt'), 'utf8'), 'Keep previous payload\n');
	}
	const empty = await tauriFixture(context);
	await writeFixtureFile(empty.tauriPrototypeRoot, empty.executable, '');
	await assert.rejects(stageDesktopNightlyTests({ ...empty, sourceRevision: revision, target }), /Tauri.*nonempty/iu);
});

test('Tauri admission refuses symbolic links and artifacts overlapping the destination', async (context) => {
	const fixture = await tauriFixture(context);
	await symlink(join(fixture.repositoryRoot, 'package.json'), join(fixture.tauriPrototypeRoot, 'unexpected-link'));
	await assert.rejects(validateDesktopNightlyTestsTauriPrototype({ artifactRoot: fixture.tauriPrototypeRoot,
		sourceRevision: revision, target }), /Tauri.*symbolic link/iu);
	await rm(join(fixture.tauriPrototypeRoot, 'unexpected-link'));
	for (const outputRoot of [fixture.tauriPrototypeRoot, dirname(fixture.tauriPrototypeRoot), join(fixture.tauriPrototypeRoot, 'nested')]) {
		await assert.rejects(validateDesktopNightlyTestsTauriPrototype({ artifactRoot: fixture.tauriPrototypeRoot,
			outputRoot, sourceRevision: revision, target }), /Tauri.*overlap/iu);
	}
});

test('nightly packaging carries the native artifact outside ASAR and stages both Tauri execution modules', () => {
	const require = createRequire(import.meta.url);
	const config: { files: string[]; extraResources: { from: string; to: string; filter?: string[] }[]; mac: { signIgnore: string } } =
		require('../electron-builder.nightly-tests.config.cjs');
	const runtimeModules = ['scripts/lib/desktop-nightly-tests-tauri.mjs', 'scripts/lib/desktop-smoke-child.mjs'];
	for (const source of runtimeModules) {
		assert.ok(config.files.includes(source));
		assert.ok(NIGHTLY_TEST_PAYLOAD_INPUTS.some((input) => input.source === source && input.destination === source));
	}
	const resources = config.extraResources.find(({ from }) => from === '.desktop-build/nightly-tests');
	assert.ok(resources?.filter?.includes('tauri-prototype/**/*'));
	assert.equal(resources?.to, 'nightly-tests');
	assert.match('/Contents/Resources/nightly-tests/tauri-prototype/soundscaper-tauri-prototype', new RegExp(config.mac.signIgnore));
	assert.match('/Contents/Resources/nightly-tests/products/soundscaper/app', new RegExp(config.mac.signIgnore));
});
