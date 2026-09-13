/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	createNativeHelperAddonBuildResult,
	deriveNativeHelperAddonBuildPolicy,
	stageNativeHelperAddonBuildResult,
	verifyNativeHelperAddonBuildResult,
} from '../scripts/lib/native-helper-addon-build-result.mjs';
import {
	NATIVE_ADDON_PAYLOAD_MANIFEST_PATH,
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';
import {
	NATIVE_HELPER_ADDON_ROOT,
	NATIVE_HELPER_ADDON_TARGETS,
} from '../scripts/lib/native-helper-addon-build.mjs';
import {
	FIXTURE_PLUGIN_ROOT,
	FIXTURE_PLUGIN_SUFFIX,
	FIXTURE_PLUGIN_VARIANTS,
} from '../scripts/lib/native-fixture-plugins.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function createCheckoutFixture() {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-native-helper-checkout-'));
	mkdirSync(join(root, 'config'), { recursive: true });
	cpSync(join(repositoryRoot, NATIVE_HELPER_ADDON_ROOT), join(root, NATIVE_HELPER_ADDON_ROOT), {
		recursive: true,
	});
	cpSync(join(repositoryRoot, FIXTURE_PLUGIN_ROOT), join(root, FIXTURE_PLUGIN_ROOT), {
		recursive: true,
	});
	cpSync(join(repositoryRoot, 'vendor/pipewire-headers'), join(root, 'vendor/pipewire-headers'), {
		recursive: true,
	});
	cpSync(join(repositoryRoot, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH),
		join(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH));
	cpSync(join(repositoryRoot, 'config/milestone-5-native-source-acquisitions.json'),
		join(root, 'config/milestone-5-native-source-acquisitions.json'));
	git(root, ['init', '--quiet']);
	git(root, ['add', '.']);
	git(root, ['-c', 'user.name=Soundscaper tests', '-c', 'user.email=tests@soundscaper.invalid',
		'-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'fixture checkout']);
	return root;
}

async function createResult(repository, target = 'win-arm64', payload = Buffer.from('target-native addon'),
	sourceRevision = gitRevision(repository)) {
	const parent = mkdtempSync(join(tmpdir(), 'soundscaper-native-helper-result-'));
	const payloadPath = join(parent, 'soundscaper_helper.node');
	const fixtureRoot = join(parent, 'fixtures');
	const buildResultRoot = join(parent, 'result');
	writeFileSync(payloadPath, payload);
	mkdirSync(fixtureRoot);
	for (const variant of FIXTURE_PLUGIN_VARIANTS) {
		writeFileSync(join(fixtureRoot, `${variant.name}${FIXTURE_PLUGIN_SUFFIX}`),
			`target-native ${target} ${variant.name}\n`);
	}
	const policy = deriveNativeHelperAddonBuildPolicy({ repositoryRoot: repository, target });
	const result = await createNativeHelperAddonBuildResult({
		repositoryRoot: repository,
		target,
		buildResultRoot,
		payloadPath,
		fixtureRoot,
		sourceRevision,
		toolchainReceipt: {
			target,
			cmake: 'cmake version 4.1.1',
			generator: target.startsWith('win-') ? 'Visual Studio 18 2026' : 'Unix Makefiles',
			compilerId: target.startsWith('win-') ? 'MSVC' : 'GNU',
			compilerVersion: '19.50.35717.0',
			systemName: target.startsWith('win-') ? 'Windows'
				: target === 'mac-arm64' ? 'Darwin' : 'Linux',
			systemProcessor: target.endsWith('arm64') ? 'ARM64' : 'x86_64',
		},
		selfTest: {
			status: 'passed',
			runtime: policy.runtime,
			addonVersion: policy.addonVersion,
			napiVersion: policy.napiVersion,
			buildId: `${policy.addonVersion}+${target}`,
			backendCount: 3,
			renderedFrames: 64,
			fixtureCount: FIXTURE_PLUGIN_VARIANTS.length,
			inspectedFixtureCount: FIXTURE_PLUGIN_VARIANTS.length - 2,
			hostedFixtureCount: 3,
			renderSha256: digest(Buffer.from('target-native synthetic render')),
			outputSha256: digest(Buffer.from('native helper self-test passed\n')),
		},
	});
	return { parent, ...result };
}

test('the checked-in helper template names CI generation for every unmaterialized target', () => {
	const source = JSON.parse(readFileSync(join(repositoryRoot,
		'native/soundscaper-helper-addon/source-manifest.json'), 'utf8'));
	const shipped = JSON.parse(readFileSync(join(repositoryRoot,
		'config/native-addon-payload-manifest.json'), 'utf8'));
	for (const target of NATIVE_HELPER_ADDON_TARGETS) {
		const sourceTarget = source.targets[target.id];
		const fixtureTarget = source.fixturePlugins.targets[target.id];
		const shippedTarget = shipped.targets.find(({ id }) => id === target.id);
		assert.ok(['built', 'ci-generated'].includes(sourceTarget.status));
		assert.equal(fixtureTarget.status, sourceTarget.status);
		assert.equal(shippedTarget.status, sourceTarget.status);
		if (sourceTarget.status === 'ci-generated') {
			assert.equal(sourceTarget.blockedBy, null);
			assert.equal(sourceTarget.payload, null);
		}
	}
});

test('the same CI result contract stages addon and fixture bytes for every claimed target', async () => {
	for (const { id } of NATIVE_HELPER_ADDON_TARGETS) {
		const checkout = createCheckoutFixture();
		const candidate = await createResult(checkout, id, Buffer.from(`CI-built ${id} addon`));
		try {
			assert.equal((await stageNativeHelperAddonBuildResult({
				buildResultRoot: candidate.buildResultRoot, repositoryRoot: checkout,
			})).status, 'staged');
			const source = JSON.parse(readFileSync(join(checkout,
				'native/soundscaper-helper-addon/source-manifest.json'), 'utf8'));
			assert.equal(source.targets[id].status, 'built');
			assert.equal(source.fixturePlugins.targets[id].status, 'built');
			assert.equal(source.fixturePlugins.targets[id].files.length, FIXTURE_PLUGIN_VARIANTS.length);
		} finally {
			rmSync(candidate.parent, { recursive: true, force: true });
			rmSync(checkout, { recursive: true, force: true });
		}
	}
});

test('a target build result binds exact payload bytes to checkout build policy', async () => {
	const candidate = await createResult(repositoryRoot);
	try {
		const verified = await verifyNativeHelperAddonBuildResult({
			buildResultRoot: candidate.buildResultRoot,
		});
		assert.equal(verified.receipt.kind, 'soundscaper-native-helper-addon-build-result');
		assert.equal(verified.receipt.target, 'win-arm64');
		assert.equal(verified.receipt.sourceRevision, gitRevision(repositoryRoot));
		assert.equal(verified.receipt.payload.sha256, digest(Buffer.from('target-native addon')));
		assert.equal(verified.receipt.fixturePlugins.files.length, FIXTURE_PLUGIN_VARIANTS.length);
		assert.equal(verified.receipt.selfTest.status, 'passed');
		assert.equal(verified.receipt.selfTest.hostedFixtureCount, 3);
		const policy = deriveNativeHelperAddonBuildPolicy({ repositoryRoot, target: 'win-arm64' });
		assert.equal(verified.receipt.buildPolicy.sha256, policy.sha256);
		assert.equal(policy.source.vendoredHeaders.fileCount, 197);
		assert.match(policy.source.vendoredHeaders.sha256, /^[a-f\d]{64}$/u);
		assert.deepEqual(policy.source.fixturePlugins.sourceFiles,
			JSON.parse(readFileSync(join(repositoryRoot,
				'native/soundscaper-helper-addon/source-manifest.json'), 'utf8')).fixturePlugins.sourceFiles);
	} finally {
		rmSync(candidate.parent, { recursive: true, force: true });
	}
});

test('tampered build-result payloads, fixture plug-ins, and receipts fail closed', async () => {
	for (const name of ['payload', 'fixture', 'receipt']) {
		const candidate = await createResult(repositoryRoot);
		try {
			if (name === 'payload') {
				const path = join(candidate.buildResultRoot, 'payload/soundscaper_helper.node');
				chmodSync(path, 0o600);
				writeFileSync(path, 'swapped');
			} else if (name === 'fixture') {
				const path = join(candidate.buildResultRoot, 'fixtures/clean-effect.scapefx');
				chmodSync(path, 0o600);
				writeFileSync(path, 'swapped fixture');
			} else {
				const path = join(candidate.buildResultRoot, 'build-result.json');
				const receipt = JSON.parse(readFileSync(path, 'utf8'));
				receipt.target = 'linux-x64';
				chmodSync(path, 0o600);
				writeFileSync(path, `${JSON.stringify(receipt, null, '\t')}\n`);
			}
			await assert.rejects(
				() => verifyNativeHelperAddonBuildResult({ buildResultRoot: candidate.buildResultRoot }),
				name === 'payload' ? /payload (?:byte length|digest) mismatch/u
					: name === 'fixture' ? /fixture.*(?:byte length|digest) mismatch/u
						: /target.*runtime|build policy.*target/iu,
			);
		} finally {
			rmSync(candidate.parent, { recursive: true, force: true });
		}
	}
});

test('a verified CI result stages into an ephemeral checkout and becomes package authority', async () => {
	const checkout = createCheckoutFixture();
	const candidate = await createResult(checkout);
	try {
		const staged = await stageNativeHelperAddonBuildResult({
			buildResultRoot: candidate.buildResultRoot,
			repositoryRoot: checkout,
		});
		assert.deepEqual(staged, { status: 'staged', target: 'win-arm64' });
		assert.equal((await stageNativeHelperAddonBuildResult({
			buildResultRoot: candidate.buildResultRoot,
			repositoryRoot: checkout,
		})).status, 'already-staged');
		const source = JSON.parse(readFileSync(join(checkout,
			'native/soundscaper-helper-addon/source-manifest.json'), 'utf8'));
		assert.equal(source.targets['win-arm64'].status, 'built');
		assert.match(source.targets['win-arm64'].buildResult.name, /build-result\.json$/u);
		assert.equal(source.fixturePlugins.targets['win-arm64'].status, 'built');
		assert.equal(source.fixturePlugins.targets['win-arm64'].files.length,
			FIXTURE_PLUGIN_VARIANTS.length);
		assert.deepEqual(readFileNames(join(checkout, FIXTURE_PLUGIN_ROOT, 'prebuilt/win-arm64')),
			FIXTURE_PLUGIN_VARIANTS.map(({ name }) => `${name}${FIXTURE_PLUGIN_SUFFIX}`).sort());
		const release = await verifyNativeAddonPayloadManifest({
			repositoryRoot: checkout, target: 'win-arm64',
		});
		assert.equal(release.target.status, 'built');
		assert.equal(release.payload.sha256, digest(Buffer.from('target-native addon')));
		assert.equal(release.buildResult.receipt.target, 'win-arm64');
		const packageRoot = join(checkout, 'package-runtime');
		await stageVerifiedNativeAddonPayload({ release, outputRoot: packageRoot });
		assert.deepEqual(readFileNames(packageRoot), [
			'native-addon-payload-manifest.json',
			'native-helper-addon-build-result.json',
			'soundscaper_helper.node',
		]);
	} finally {
		rmSync(candidate.parent, { recursive: true, force: true });
		rmSync(checkout, { recursive: true, force: true });
	}
});

test('the Linux CI result atomically supersedes the checked-in bootstrap payload', async () => {
	const checkout = createCheckoutFixture();
	const candidate = await createResult(checkout, 'linux-x64', Buffer.from('CI-built Linux addon'));
	try {
		assert.equal((await stageNativeHelperAddonBuildResult({
			buildResultRoot: candidate.buildResultRoot, repositoryRoot: checkout,
		})).status, 'staged');
		const release = await verifyNativeAddonPayloadManifest({
			repositoryRoot: checkout, target: 'linux-x64',
		});
		assert.equal(release.payload.sha256, digest(Buffer.from('CI-built Linux addon')));
		assert.equal(release.buildResult.receipt.sourceRevision, gitRevision(checkout));
	} finally {
		rmSync(candidate.parent, { recursive: true, force: true });
		rmSync(checkout, { recursive: true, force: true });
	}
});

test('staging rejects a result from a different checkout revision even when build inputs match', async () => {
	const checkout = createCheckoutFixture();
	const candidate = await createResult(checkout);
	try {
		writeFileSync(join(checkout, 'unrelated.txt'), 'a revision-only change\n');
		git(checkout, ['add', 'unrelated.txt']);
		git(checkout, ['-c', 'user.name=Soundscaper tests', '-c', 'user.email=tests@soundscaper.invalid',
			'-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'advance checkout']);
		await assert.rejects(() => stageNativeHelperAddonBuildResult({
			buildResultRoot: candidate.buildResultRoot, repositoryRoot: checkout,
		}), /source revision does not match the staging checkout HEAD/u);
	} finally {
		rmSync(candidate.parent, { recursive: true, force: true });
		rmSync(checkout, { recursive: true, force: true });
	}
});

test('build policy derivation rejects source bytes outside the pinned inventory', () => {
	const checkout = createCheckoutFixture();
	try {
		writeFileSync(join(checkout, 'native/soundscaper-helper-addon/src/unpinned.c'),
			'int unpinned_helper_source(void) { return 1; }\n');
		assert.throws(() => deriveNativeHelperAddonBuildPolicy({
			repositoryRoot: checkout, target: 'win-arm64',
		}), /source inventory does not exactly match its pins/u);
	} finally {
		rmSync(checkout, { recursive: true, force: true });
	}
});

test('build policy derivation rejects a changed vendored PipeWire header closure', () => {
	const checkout = createCheckoutFixture();
	try {
		const header = join(checkout,
			'vendor/pipewire-headers/spa-0.2/spa/utils/defs.h');
		writeFileSync(header, `${readFileSync(header, 'utf8')}/* unpinned drift */\n`);
		assert.throws(() => deriveNativeHelperAddonBuildPolicy({
			repositoryRoot: checkout, target: 'linux-x64',
		}), /vendored PipeWire header closure does not match its pin/u);
	} finally {
		rmSync(checkout, { recursive: true, force: true });
	}
});

test('build policy derivation rejects unpinned fixture plug-in sources', () => {
	const checkout = createCheckoutFixture();
	try {
		writeFileSync(join(checkout, FIXTURE_PLUGIN_ROOT, 'src/unpinned.c'),
			'int unpinned_fixture_source(void) { return 1; }\n');
		assert.throws(() => deriveNativeHelperAddonBuildPolicy({
			repositoryRoot: checkout, target: 'win-arm64',
		}), /fixture plug-in source inventory does not exactly match its pins/u);
	} finally {
		rmSync(checkout, { recursive: true, force: true });
	}
});

function gitRevision(root) {
	return git(root, ['rev-parse', 'HEAD']).trim();
}

function git(root, args) {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return result.stdout;
}

function readFileNames(root) {
	return readdirSync(root).sort();
}

test('staging refuses a stale checkout or a different result over an existing target', async () => {
	const checkout = createCheckoutFixture();
	const stale = await createResult(checkout);
	try {
		const cmake = join(checkout, 'native/soundscaper-helper-addon/CMakeLists.txt');
		writeFileSync(cmake, `${readFileSync(cmake, 'utf8')}# drift\n`);
		await assert.rejects(() => stageNativeHelperAddonBuildResult({
			buildResultRoot: stale.buildResultRoot, repositoryRoot: checkout,
		}), /build result.*checkout build policy/u);
	} finally {
		rmSync(stale.parent, { recursive: true, force: true });
		rmSync(checkout, { recursive: true, force: true });
	}

	const occupied = createCheckoutFixture();
	const first = await createResult(occupied);
	try {
		await stageNativeHelperAddonBuildResult({
			buildResultRoot: first.buildResultRoot, repositoryRoot: occupied,
		});
		const second = await createResult(occupied, 'win-arm64', Buffer.from('different payload'));
		try {
			await assert.rejects(() => stageNativeHelperAddonBuildResult({
				buildResultRoot: second.buildResultRoot, repositoryRoot: occupied,
			}), /already staged from a different build result/u);
		} finally {
			rmSync(second.parent, { recursive: true, force: true });
		}
	} finally {
		rmSync(first.parent, { recursive: true, force: true });
		rmSync(occupied, { recursive: true, force: true });
	}
});
