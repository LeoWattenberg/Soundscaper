/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	copyOpenFxTestFixture,
	OPENFX_TEST_FIXTURE_ENV,
	openFxTestFixtureArtifacts,
	prepareOpenFxTestFixture,
} from '../scripts/lib/node-test-openfx-fixture.ts';

function directories(context: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'openfx-shared-fixture-test-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, fixtureRoot: join(root, 'shared') };
}

test('OpenFX preparation is selected only for native consumers and keeps production variants separate', () => {
	assert.deepEqual(openFxTestFixtureArtifacts(['/tests/framescaper-openfx-host-source-manifest.test.js']), []);
	assert.deepEqual(openFxTestFixtureArtifacts(['/tests/framescaper-openfx-native-interact.test.js']), ['plugin', 'runtime']);
	assert.deepEqual(openFxTestFixtureArtifacts(['/tests/framescaper-openfx-gpu-source.test.js']), ['plugin', 'runtime']);
	const artifacts = openFxTestFixtureArtifacts(['/tests/framescaper-openfx-native-runtime.test.js']);
	assert.deepEqual(artifacts, ['plugin', 'runtime', 'scanner'], 'runtime-only flag variants remain lazy in their owning suite');
});

test('one fresh build supplies private executable copies without copying scratch or objects', async (context) => {
	const { root, fixtureRoot } = directories(context);
	let builds = 0;
	const plugin = join(root, 'conformance.so');
	const runtime = join(root, 'runtime');
	writeFileSync(plugin, 'plug-in');
	writeFileSync(runtime, 'runtime');
	chmodSync(runtime, 0o755);
	writeFileSync(join(root, 'unused.o'), 'object');
	await prepareOpenFxTestFixture({ repositoryRoot: root, fixtureRoot, artifacts: ['plugin', 'runtime'] }, () => {
		builds += 1;
		return { plugin, runtime, exactRetimeAvailable: true };
	});
	const environment = { [OPENFX_TEST_FIXTURE_ENV]: fixtureRoot };
	const left = copyOpenFxTestFixture({ repositoryRoot: root, directory: join(root, 'left'), environment });
	const right = copyOpenFxTestFixture({ repositoryRoot: root, directory: join(root, 'right'), environment });
	assert.ok(left && right);
	assert.equal(builds, 1);
	assert.equal(left.exactRetimeAvailable, true);
	assert.equal(readFileSync(left.artifacts.runtime!, 'utf8'), 'runtime');
	assert.equal(left.artifacts.plugin, join(root, 'left', 'plugin.so'));
	assert.equal(statSync(left.artifacts.runtime!).mode & 0o111, statSync(runtime).mode & 0o111);
	assert.notEqual(statSync(left.artifacts.runtime!).ino, statSync(right.artifacts.runtime!).ino);
	writeFileSync(left.artifacts.plugin!, 'changed');
	assert.equal(readFileSync(right.artifacts.plugin!, 'utf8'), 'plug-in');
	assert.deepEqual(Object.keys(right.artifacts).sort(), ['plugin', 'runtime']);
});

test('a missing compiler is recorded for each consuming suite to report its own skip', async (context) => {
	const { root, fixtureRoot } = directories(context);
	await prepareOpenFxTestFixture({ repositoryRoot: root, fixtureRoot, artifacts: ['plugin', 'runtime'] }, () => null);
	assert.equal(copyOpenFxTestFixture({
		repositoryRoot: root, directory: join(root, 'private'), environment: { [OPENFX_TEST_FIXTURE_ENV]: fixtureRoot },
	}), null);
});

test('direct runs and fixtures from another checkout fall back to their own fresh build', async (context) => {
	const { root, fixtureRoot } = directories(context);
	assert.equal(copyOpenFxTestFixture({ repositoryRoot: root, directory: join(root, 'direct'), environment: {} }), undefined);
	await prepareOpenFxTestFixture({ repositoryRoot: root, fixtureRoot, artifacts: ['plugin', 'runtime'] }, () => null);
	assert.equal(copyOpenFxTestFixture({
		repositoryRoot: join(root, 'other'), directory: join(root, 'other-copy'),
		environment: { [OPENFX_TEST_FIXTURE_ENV]: fixtureRoot },
	}), undefined);
});

test('corrupted fixture bytes fail before a consumer can execute them', async (context) => {
	const { root, fixtureRoot } = directories(context);
	const plugin = join(root, 'plugin');
	writeFileSync(plugin, 'authentic');
	await prepareOpenFxTestFixture({ repositoryRoot: root, fixtureRoot, artifacts: ['plugin'] }, () => ({
		plugin, exactRetimeAvailable: false,
	}));
	writeFileSync(join(fixtureRoot, 'plugin'), 'corrupted');
	assert.throws(() => copyOpenFxTestFixture({
		repositoryRoot: root, directory: join(root, 'private'), environment: { [OPENFX_TEST_FIXTURE_ENV]: fixtureRoot },
	}), /digest/u);
});

test('fixture preparation removes a partial publication after a build error', async (context) => {
	const { root, fixtureRoot } = directories(context);
	await assert.rejects(prepareOpenFxTestFixture({ repositoryRoot: root, fixtureRoot, artifacts: ['plugin'] }, () => {
		throw new Error('compiler failed');
	}), /compiler failed/u);
	assert.throws(() => statSync(fixtureRoot), { code: 'ENOENT' });
});
