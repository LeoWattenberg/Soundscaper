/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { nativeTestFixtureRecipes, selectedNativeTestFixtures } from '../scripts/lib/node-native-test-fixture-recipes.ts';
import { NATIVE_TEST_FIXTURE_ENV, copyNativeTestFixture, prepareNativeTestFixtures } from '../scripts/lib/node-native-test-fixtures.ts';

function fixture(context: TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'native-test-sharing-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const repositoryRoot = join(root, 'repository');
	for (const recipe of Object.values(nativeTestFixtureRecipes(repositoryRoot, {}))) {
		for (const file of recipe.sources) {
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, `// ${file}\n`);
		}
	}
	const header = join(repositoryRoot, 'native/common/fixture.hpp');
	writeFileSync(header, '// header\n');
	return { root, repositoryRoot, header, fixtureRoot: join(root, 'prepared') };
}

const compilerIdentity = () => 'test compiler';

test('native fixture selection preserves closure variants and excludes unused compilers', () => {
	assert.deepEqual(selectedNativeTestFixtures([], {}, false), []);
	assert.deepEqual(selectedNativeTestFixtures(['framescaper-media-host-source-manifest.test.js', 'framescaper-media-host-legacy-plan-admission.test.js', 'framescaper-media-host-unified-vfr-parity.test.js'], {}, false), ['media-contract']);
	assert.deepEqual(selectedNativeTestFixtures(['framescaper-media-host-unified-validator-parity.test.js', 'framescaper-media-host-native-adapters.test.js'], {}, false), []);
	const environment = { FRAMESCAPER_BOOST_192_SOURCE_ROOT: '/pinned/boost' };
	assert.deepEqual(selectedNativeTestFixtures(['framescaper-media-host-source-manifest.test.js', 'framescaper-media-host-unified-vfr-parity.test.js', 'framescaper-media-host-unified-validator-parity.test.js'], environment, true), ['media-contract', 'media-contract-exact', 'media-validator']);
});

test('one fresh native preparation supplies private copies without repeating compilation', (context) => {
	const scope = fixture(context);
	const builds: string[] = [];
	prepareNativeTestFixtures({ ...scope, kinds: ['media-contract', 'media-contract'], environment: {} }, (recipe, output) => {
		builds.push(recipe.kind);
		writeFileSync(output, 'fresh executable', { mode: 0o755 });
	}, compilerIdentity);
	const environment = { [NATIVE_TEST_FIXTURE_ENV]: scope.fixtureRoot };
	const first = join(scope.root, 'first');
	const second = join(scope.root, 'second');
	assert.equal(copyNativeTestFixture({ repositoryRoot: scope.repositoryRoot, kind: 'media-contract', outputPath: first, environment }, compilerIdentity), true);
	writeFileSync(first, 'private mutation');
	assert.equal(copyNativeTestFixture({ repositoryRoot: scope.repositoryRoot, kind: 'media-contract', outputPath: second, environment }, compilerIdentity), true);
	assert.deepEqual(builds, ['media-contract']);
	assert.equal(readFileSync(second, 'utf8'), 'fresh executable');
	if (statSync(first).ino !== 0) assert.notEqual(statSync(first).ino, statSync(second).ino);
	const source = join(scope.fixtureRoot, `media-contract${process.platform === 'win32' ? '.exe' : ''}`);
	assert.equal(statSync(second).mode & 0o777, statSync(source).mode & 0o777);
});

test('native sharing refuses altered headers, flags, binaries and overwrites', (context) => {
	const scope = fixture(context);
	prepareNativeTestFixtures({ ...scope, kinds: ['media-contract'], environment: {} }, (_recipe, output) => writeFileSync(output, 'executable'), compilerIdentity);
	const environment = { [NATIVE_TEST_FIXTURE_ENV]: scope.fixtureRoot };
	const options = { repositoryRoot: scope.repositoryRoot, kind: 'media-contract' as const, outputPath: join(scope.root, 'output'), environment };
	writeFileSync(scope.header, 'changed header');
	assert.throws(() => copyNativeTestFixture(options, compilerIdentity), /source or compilation/u);
	writeFileSync(scope.header, '// header\n');
	assert.throws(() => copyNativeTestFixture(options, () => 'another compiler'), /source or compilation/u);
	writeFileSync(join(scope.fixtureRoot, `media-contract${process.platform === 'win32' ? '.exe' : ''}`), 'corrupt executable');
	assert.throws(() => copyNativeTestFixture(options, compilerIdentity), /digest/u);
	writeFileSync(join(scope.fixtureRoot, `media-contract${process.platform === 'win32' ? '.exe' : ''}`), 'executable');
	writeFileSync(options.outputPath, 'private output');
	assert.throws(() => copyNativeTestFixture(options, compilerIdentity), { code: 'EEXIST' });
	assert.equal(readFileSync(options.outputPath, 'utf8'), 'private output');
});

test('native sharing authenticates included Boost implementation files and include flags', (context) => {
	const scope = fixture(context);
	const closure = join(scope.root, 'boost');
	const otherClosure = join(scope.root, 'other-boost');
	for (const root of [closure, otherClosure]) {
		mkdirSync(root);
		writeFileSync(join(root, 'implementation.ipp'), 'pinned implementation');
	}
	const environment = { FRAMESCAPER_BOOST_192_SOURCE_ROOT: closure };
	prepareNativeTestFixtures({ ...scope, kinds: ['media-contract-exact'], environment }, (_recipe, output) => writeFileSync(output, 'executable'), compilerIdentity);
	const options = { repositoryRoot: scope.repositoryRoot, kind: 'media-contract-exact' as const, outputPath: join(scope.root, 'output'), environment: { ...environment, [NATIVE_TEST_FIXTURE_ENV]: scope.fixtureRoot } };
	assert.throws(() => copyNativeTestFixture({ ...options, environment: { ...options.environment, FRAMESCAPER_BOOST_192_SOURCE_ROOT: otherClosure } }, compilerIdentity), /source or compilation/u);
	writeFileSync(join(closure, 'implementation.ipp'), 'changed implementation');
	assert.throws(() => copyNativeTestFixture(options, compilerIdentity), /source or compilation/u);
});

test('direct native test runs have no persistent fixture and failed preparations clean partial artifacts', (context) => {
	const scope = fixture(context);
	assert.equal(copyNativeTestFixture({ repositoryRoot: scope.repositoryRoot, kind: 'media-contract', outputPath: '/unused', environment: {} }), false);
	assert.throws(() => prepareNativeTestFixtures({ ...scope, kinds: ['media-contract'], environment: {} }, (_recipe, output) => {
		writeFileSync(output, 'partial');
		throw new Error('compiler failed');
	}, compilerIdentity), /compiler failed/u);
	assert.throws(() => statSync(scope.fixtureRoot), { code: 'ENOENT' });
});
