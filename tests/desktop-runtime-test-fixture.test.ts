/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	DESKTOP_RUNTIME_TEST_FIXTURE_ENV,
	compileDesktopRuntimeTestFixture,
	needsDesktopRuntimeTestFixture,
	prepareDesktopRuntimeTestFixture,
} from '../scripts/lib/node-test-desktop-runtime-fixture.ts';

const ROOT = resolve(import.meta.dirname, '..');
const COMPILATION_TESTS = [
	'desktop-project-library-packaging.test.js',
	'desktop-audio-codec-runtime-staging.test.js',
	'desktop-os-audio-codec-runtime-staging.test.js',
	'desktop-staged-typescript-guard.test.js',
	'desktop-native-helper-real-process.test.js',
];

async function temporaryRoot(context: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'scape-test-runtime-fixture-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test('only desktop compilation consumers request the shared fixture', () => {
	assert.equal(needsDesktopRuntimeTestFixture([]), false);
	assert.equal(needsDesktopRuntimeTestFixture(['tests/audio-editor-mixer.test.ts']), false);
	for (const name of COMPILATION_TESTS) {
		assert.equal(needsDesktopRuntimeTestFixture([join(ROOT, 'tests', name)]), true, name);
	}
});

test('one fresh compile supplies independent runtime copies to multiple tests', async (context) => {
	const root = await temporaryRoot(context);
	const fixtureRoot = join(root, 'shared');
	let compilations = 0;
	await prepareDesktopRuntimeTestFixture({ repositoryRoot: ROOT, fixtureRoot }, async ({ outputRoot }) => {
		compilations += 1;
		await mkdir(outputRoot, { recursive: true });
		await writeFile(join(outputRoot, 'runtime.js'), 'export const value = 1;');
		return { files: ['runtime.js'] };
	});
	const environment = { [DESKTOP_RUNTIME_TEST_FIXTURE_ENV]: fixtureRoot };
	const unexpectedCompile = async (): Promise<never> => {
		throw new Error('A prepared fixture must not compile again.');
	};
	const firstRoot = join(root, 'first');
	const secondRoot = join(root, 'second');
	const [first, second] = await Promise.all([
		compileDesktopRuntimeTestFixture({ repositoryRoot: ROOT, outputRoot: firstRoot }, {
			environment, compile: unexpectedCompile,
		}),
		compileDesktopRuntimeTestFixture({ repositoryRoot: ROOT, outputRoot: secondRoot }, {
			environment, compile: unexpectedCompile,
		}),
	]);
	assert.equal(compilations, 1);
	assert.deepEqual(first.files, ['runtime.js']);
	assert.deepEqual(second.files, ['runtime.js']);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.isFrozen(first.files), true);
	await writeFile(join(firstRoot, 'runtime.js'), 'changed by one test');
	assert.equal(await readFile(join(secondRoot, 'runtime.js'), 'utf8'), 'export const value = 1;');
	assert.equal(await readFile(join(fixtureRoot, 'runtime/runtime.js'), 'utf8'), 'export const value = 1;');
});

test('direct Node test invocations compile without a runner fixture', async () => {
	const options = { repositoryRoot: ROOT, outputRoot: '/unused-output' };
	const result = { files: ['direct-runtime.js'] };
	let compilations = 0;
	assert.equal(await compileDesktopRuntimeTestFixture(options, {
		environment: {},
		compile: async (observed) => {
			compilations += 1;
			assert.deepEqual(observed, options);
			return result;
		},
	}), result);
	assert.equal(compilations, 1);
});

test('fixtures from another repository cannot replace its compilation', async (context) => {
	const root = await temporaryRoot(context);
	const fixtureRoot = join(root, 'shared');
	await prepareDesktopRuntimeTestFixture({ repositoryRoot: ROOT, fixtureRoot }, async ({ outputRoot }) => {
		await mkdir(outputRoot, { recursive: true });
		return { files: [] };
	});
	let compilations = 0;
	const result = await compileDesktopRuntimeTestFixture({ repositoryRoot: root, outputRoot: join(root, 'other') }, {
		environment: { [DESKTOP_RUNTIME_TEST_FIXTURE_ENV]: fixtureRoot },
		compile: async () => {
			compilations += 1;
			return { files: ['other-runtime.js'] };
		},
	});
	assert.equal(compilations, 1);
	assert.deepEqual(result.files, ['other-runtime.js']);
});

test('a failed fixture compilation removes its partial runtime', async (context) => {
	const root = await temporaryRoot(context);
	const fixtureRoot = join(root, 'failed');
	await assert.rejects(prepareDesktopRuntimeTestFixture({ repositoryRoot: ROOT, fixtureRoot }, async ({ outputRoot }) => {
		await mkdir(outputRoot, { recursive: true });
		await writeFile(join(outputRoot, 'partial.js'), 'incomplete');
		throw new Error('Compiler rejected the source.');
	}), /Compiler rejected the source/u);
	await assert.rejects(access(fixtureRoot), { code: 'ENOENT' });
});

test('a corrupt runner fixture fails instead of hiding the preparation error', async (context) => {
	const root = await temporaryRoot(context);
	await writeFile(join(root, 'fixture.json'), JSON.stringify({ repositoryRoot: ROOT, files: [42] }));
	await assert.rejects(compileDesktopRuntimeTestFixture({ repositoryRoot: ROOT, outputRoot: join(root, 'output') }, {
		environment: { [DESKTOP_RUNTIME_TEST_FIXTURE_ENV]: root },
	}), /Invalid desktop runtime test fixture/u);
});

test('copying a fixture refuses to overwrite another test output', async (context) => {
	const root = await temporaryRoot(context);
	const fixtureRoot = join(root, 'shared');
	await prepareDesktopRuntimeTestFixture({ repositoryRoot: ROOT, fixtureRoot }, async ({ outputRoot }) => {
		await mkdir(outputRoot, { recursive: true });
		await writeFile(join(outputRoot, 'runtime.js'), 'fixture');
		return { files: ['runtime.js'] };
	});
	const outputRoot = join(root, 'output');
	await mkdir(outputRoot);
	await writeFile(join(outputRoot, 'runtime.js'), 'preserve');
	await assert.rejects(compileDesktopRuntimeTestFixture({ repositoryRoot: ROOT, outputRoot }, {
		environment: { [DESKTOP_RUNTIME_TEST_FIXTURE_ENV]: fixtureRoot },
	}), { code: 'ERR_FS_CP_EEXIST' });
	assert.equal(await readFile(join(outputRoot, 'runtime.js'), 'utf8'), 'preserve');
});

test('the fixture CLI records repository coverage without profiling the TypeScript compiler dependency', async (context) => {
	const root = await temporaryRoot(context);
	const repositoryRoot = join(root, 'repository');
	const compilerRoot = join(repositoryRoot, 'node_modules/typescript/bin');
	const fixtureRoot = join(root, 'fixture');
	const coverageRoot = join(root, 'coverage');
	await mkdir(compilerRoot, { recursive: true });
	await mkdir(coverageRoot);
	await writeFile(join(compilerRoot, 'tsc'), [
		"require('node:fs').writeFileSync('compiler-env.json', JSON.stringify({ coverage: process.env.NODE_V8_COVERAGE ?? null }));",
		'process.exit(7);',
	].join('\n'));
	const run = spawnSync(process.execPath, [
		join(ROOT, 'scripts/lib/node-test-desktop-runtime-fixture.ts'), repositoryRoot, fixtureRoot,
	], { env: { ...process.env, NODE_V8_COVERAGE: coverageRoot }, encoding: 'utf8' });
	assert.equal(run.status, 1, run.stderr);
	assert.match(run.stderr, /Desktop runtime compiler exited with code 7/u);
	assert.deepEqual(JSON.parse(await readFile(join(repositoryRoot, 'compiler-env.json'), 'utf8')), { coverage: null });
	await assert.rejects(access(fixtureRoot), { code: 'ENOENT' });
	const profiles = await readdir(coverageRoot);
	assert.equal(profiles.length, 1, 'only the repository fixture CLI should emit a profile');
	const profile = JSON.parse(await readFile(join(coverageRoot, profiles[0]!), 'utf8')) as {
		result: { url: string; functions: { functionName: string; ranges: { count: number }[] }[] }[];
	};
	const compilerScript = profile.result.find((script) => script.url.endsWith('/scripts/lib/desktop-project-library-runtime.mjs'));
	assert.ok(compilerScript, 'the repository compiler wrapper must remain covered');
	const compilation = compilerScript.functions.find((entry) => entry.functionName === 'compileDesktopProjectLibraryRuntime');
	assert.equal(compilation?.ranges[0]?.count, 1, 'the fixture compile must remain in the CLI coverage profile');
});
