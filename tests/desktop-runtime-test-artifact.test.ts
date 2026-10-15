/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { desktopRuntimeFixtureSourceIdentity, prepareDesktopRuntimeTestArtifact, validateDesktopRuntimeTestArtifact } from '../scripts/lib/node-test-desktop-runtime-artifact.ts';
import { compileDesktopRuntimeTestFixture, DESKTOP_RUNTIME_TEST_FIXTURE_ENV, prepareDesktopRuntimeTestFixture } from '../scripts/lib/node-test-desktop-runtime-fixture.ts';

test('fresh workflow artifacts authenticate source identity and output bytes before private runtime reuse', async t => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-runtime-artifact-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const fixtureRoot = join(root, 'shared');
	let identity = 'source-a';
	let compilations = 0;
	await prepareDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot }, async ({ outputRoot }) => {
		compilations += 1;
		await mkdir(outputRoot, { recursive: true });
		await writeFile(join(outputRoot, 'runtime.js'), 'compiled source-a');
		return { files: ['runtime.js'] };
	}, () => identity);
	validateDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot }, () => identity);
	await compileDesktopRuntimeTestFixture({ repositoryRoot: root, outputRoot: join(root, 'private') }, { environment: { [DESKTOP_RUNTIME_TEST_FIXTURE_ENV]: fixtureRoot } });
	assert.equal(compilations, 1);
	identity = 'source-b';
	assert.throws(() => validateDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot }, () => identity), { name: 'DesktopRuntimeFixtureCompatibilityError' });
	identity = 'source-a';
	await writeFile(join(fixtureRoot, 'runtime/runtime.js'), 'damaged archive');
	assert.throws(() => validateDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot }, () => identity), /runtime bytes/u);
	identity = 'source-b';
	assert.throws(() => validateDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot }, () => identity), /runtime bytes/u,
		'corrupt bytes stay fatal even when source or host identity also differs');
});

test('source changes during preparation discard the compiled artifact', async t => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-artifact-dirty-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let identity = 'before';
	await assert.rejects(prepareDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot: join(root, 'shared') }, async ({ outputRoot }) => {
		await mkdir(outputRoot, { recursive: true });
		identity = 'after';
		return { files: [] };
	}, () => identity), /changed while compiling/u);
});

test('desktop artifact source identity binds revision, dirty source bytes, build recipe, compiler and payload inputs', async t => {
	const { root, inputs } = await sourceFixture(t);
	const original = desktopRuntimeFixtureSourceIdentity(root);
	assert.equal(desktopRuntimeFixtureSourceIdentity(root), original);
	for (const file of inputs) {
		await writeFile(join(root, file), 'changed');
		assert.notEqual(desktopRuntimeFixtureSourceIdentity(root), original, file);
		await writeFile(join(root, file), 'original');
	}
	const previousOverride = process.env.ESBUILD_BINARY_PATH;
	try {
		process.env.ESBUILD_BINARY_PATH = join(root, 'override-compiler');
		await writeFile(process.env.ESBUILD_BINARY_PATH, 'external compiler');
		const external = desktopRuntimeFixtureSourceIdentity(root);
		assert.notEqual(external, original);
		await writeFile(process.env.ESBUILD_BINARY_PATH, 'replaced external compiler');
		assert.notEqual(desktopRuntimeFixtureSourceIdentity(root), external);
	} finally {
		if (previousOverride === undefined) delete process.env.ESBUILD_BINARY_PATH;
		else process.env.ESBUILD_BINARY_PATH = previousOverride;
	}
	assert.equal(spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'new revision'], { cwd: root }).status, 0);
	assert.notEqual(desktopRuntimeFixtureSourceIdentity(root), original);
});

test('different runner images decline unchanged artifacts while one fresh compile serves isolated private consumers', async t => {
	const { root } = await sourceFixture(t);
	const borrowed = join(root, 'downloaded');
	const owned = join(root, 'owned');
	const previousImage = process.env.ImageVersion;
	const compile = async ({ outputRoot }: { outputRoot: string }) => {
		await mkdir(outputRoot, { recursive: true });
		await writeFile(join(outputRoot, 'runtime.js'), 'original runtime');
		return { files: ['runtime.js'] };
	};
	try {
		process.env.ImageVersion = '20261012.334.1';
		await prepareDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot: borrowed }, compile);
		process.env.ImageVersion = '20261004.327.1';
		assert.throws(() => validateDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot: borrowed }), { name: 'DesktopRuntimeFixtureCompatibilityError' });
		let freshCompilations = 0;
		await prepareDesktopRuntimeTestFixture({ repositoryRoot: root, fixtureRoot: owned }, async options => {
			freshCompilations += 1;
			return compile(options);
		});
		for (const outputRoot of ['private-one', 'private-two']) {
			await compileDesktopRuntimeTestFixture({ repositoryRoot: root, outputRoot: join(root, outputRoot) }, {
				environment: { [DESKTOP_RUNTIME_TEST_FIXTURE_ENV]: owned },
				compile: () => { throw new Error('Private consumers must reuse the one fresh compile.'); },
			});
		}
		assert.equal(freshCompilations, 1);
		await writeFile(join(root, 'private-one/runtime.js'), 'private mutation');
		for (const directory of [borrowed, owned]) assert.equal(await readFile(join(directory, 'runtime/runtime.js'), 'utf8'), 'original runtime');
		assert.equal(await readFile(join(root, 'private-two/runtime.js'), 'utf8'), 'original runtime');
	} finally {
		if (previousImage === undefined) delete process.env.ImageVersion;
		else process.env.ImageVersion = previousImage;
	}
});

async function sourceFixture(t: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'desktop-artifact-identity-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const directory of ['src/common/editor', 'desktop', 'scripts/lib', 'config', 'node_modules/typescript/lib', 'node_modules/esbuild/bin', 'node_modules/@esbuild/linux-x64/bin']) await mkdir(join(root, directory), { recursive: true });
	const inputs = ['src/common/editor/source.ts', 'desktop/host.ts', 'scripts/lib/recipe.mjs', 'config/pins.json', 'package-lock.json', 'tsconfig.desktop-runtime.json', 'node_modules/typescript/lib/compiler.js', 'node_modules/esbuild/bin/compiler', 'node_modules/@esbuild/linux-x64/bin/esbuild'];
	for (const file of inputs) await writeFile(join(root, file), 'original');
	for (const command of [['init', '--quiet'], ['add', 'src', 'desktop', 'scripts', 'config', 'package-lock.json', 'tsconfig.desktop-runtime.json'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']]) {
		assert.equal(spawnSync('git', command, { cwd: root }).status, 0);
	}
	return { root, inputs };
}
