/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { fingerprintFramescaperOpenFxHostToolchainReceipt } from
	'../native/framescaper-openfx-host/build/recipe-driver.mjs';
import {
	assertFramescaperOpenFxBinaryArchitecture,
} from '../scripts/lib/framescaper-openfx-binary-architecture.mjs';
import {
	createFramescaperOpenFxHostBuildResult,
	stageFramescaperOpenFxHostBuildResult,
	verifyFramescaperOpenFxHostBuildResult,
} from '../scripts/lib/framescaper-openfx-host-build-result.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const REVISION = '12'.repeat(20);

test('OpenFX distinguishes an ARM64EC host image from its native ARM64 isolation launcher', () => {
	assert.deepEqual(assertFramescaperOpenFxBinaryArchitecture(
		arm64EcImage(), 'win-arm64', 'openfx-host',
	), {
		schemaVersion: 1, target: 'win-arm64', format: 'pe32-plus',
		architecture: 'arm64ec', machine: 'IMAGE_FILE_MACHINE_ARM64EC',
	});
	assert.deepEqual(assertFramescaperOpenFxBinaryArchitecture(
		pe(0xaa64), 'win-arm64', 'isolation-launcher',
	), {
		schemaVersion: 1, target: 'win-arm64', format: 'pe32-plus',
		architecture: 'arm64', machine: 'IMAGE_FILE_MACHINE_ARM64',
	});
	assert.throws(() => assertFramescaperOpenFxBinaryArchitecture(
		pe(0x8664), 'win-arm64', 'openfx-host',
	), /ARM64EC|CHPE/iu);
});

test('a target-native OpenFX result carries exact artifacts, checks, and a stageable receipt', async (context) => {
	const fixture = buildFixture(context);
	const created = await createFramescaperOpenFxHostBuildResult(fixture.options);
	assert.equal(created.receipt.kind, 'framescaper-openfx-host-build-result');
	assert.deepEqual(created.receipt.selfTests.map(({ id }) => id), [
		'isolation-launcher-refusal', 'openfx-runtime-host-self-test', 'openfx-scanner-self-test',
	]);
	assert.deepEqual(created.receipt.architectures.map(({ architecture }) => architecture.machine), [
		'EM_X86_64', 'EM_X86_64', 'EM_X86_64', 'EM_X86_64',
	]);
	assert.deepEqual(await inventory(created.buildResultRoot), [
		'build-result.json',
		'payload/bin/framescaper-ofx-runtime-host',
		'payload/bin/framescaper-ofx-scanner',
		'payload/isolation/milestone5-native-isolation-broker.json',
		'payload/isolation/milestone5-native-isolation-launcher',
		'payload/isolation/milestone5-native-isolation-profile.json',
		'payload/lib/ld-linux-x86-64.so.2',
	]);

	const checkout = checkoutFixture(context);
	const staged = await stageFramescaperOpenFxHostBuildResult({
		buildResultRoot: created.buildResultRoot,
		repositoryRoot: checkout,
	}, { resolveRevision: () => REVISION });
	assert.equal(staged.status, 'staged');
	const source = json(join(checkout, 'native/framescaper-openfx-host/source-manifest.json'));
	const target = source.targets['linux-x64'];
	assert.equal(target.status, 'built');
	assert.equal(target.blockedBy, null);
	assert.match(target.buildResult.path, /framescaper-openfx-host-build-result\.json$/u);
	assert.deepEqual(readdirSync(join(checkout,
		'native/framescaper-openfx-host/prebuilt/linux-x64')).sort(), [
		'bin', 'framescaper-openfx-host-build-result.json', 'isolation', 'lib',
	]);
	const payload = json(join(checkout, 'config/framescaper-openfx-host-payload-manifest.json'));
	assert.equal(payload.targets[0].status, 'built');
	assert.deepEqual(payload.targets[0].payload.buildResult, target.buildResult);
});

test('result verification rejects artifact substitution and checkout revision drift', async (context) => {
	const fixture = buildFixture(context);
	const created = await createFramescaperOpenFxHostBuildResult(fixture.options);
	const scanner = join(created.buildResultRoot, 'payload/bin/framescaper-ofx-scanner');
	chmodSync(scanner, 0o755);
	writeFileSync(scanner, 'changed');
	await assert.rejects(
		() => verifyFramescaperOpenFxHostBuildResult({ buildResultRoot: created.buildResultRoot }),
		/artifact.*changed/iu,
	);

	const second = buildFixture(context, 'second');
	const valid = await createFramescaperOpenFxHostBuildResult(second.options);
	await assert.rejects(() => stageFramescaperOpenFxHostBuildResult({
		buildResultRoot: valid.buildResultRoot,
		repositoryRoot: checkoutFixture(context),
	}, { resolveRevision: () => '34'.repeat(20) }), /does not belong.*revision/iu);
});

test('result creation rejects merely hash-shaped source and toolchain claims', async (context) => {
	const sourceDrift = buildFixture(context, 'source-drift');
	sourceDrift.options.sourceAuthentication.openfx.commitSha = '34'.repeat(20);
	await assert.rejects(() => createFramescaperOpenFxHostBuildResult(sourceDrift.options),
		/source authentication.*exact/iu);

	const toolDrift = buildFixture(context, 'tool-drift');
	toolDrift.options.toolchainReceipt.executables.ninja.sha256 = '56'.repeat(32);
	await assert.rejects(() => createFramescaperOpenFxHostBuildResult(toolDrift.options),
		/toolchain.*identity/iu);
});

test('staging resolves and binds the checkout git HEAD itself', async (context) => {
	const checkout = checkoutFixture(context);
	git(checkout, ['init', '--quiet']);
	git(checkout, ['add', '.']);
	git(checkout, ['-c', 'user.name=Soundscaper CI', '-c', 'user.email=ci@invalid',
		'commit', '--quiet', '-m', 'fixture']);
	const head = git(checkout, ['rev-parse', 'HEAD']).stdout.trim();
	const wrong = buildFixture(context, 'wrong-head');
	const wrongResult = await createFramescaperOpenFxHostBuildResult(wrong.options);
	await assert.rejects(() => stageFramescaperOpenFxHostBuildResult({
		buildResultRoot: wrongResult.buildResultRoot, repositoryRoot: checkout,
	}), /does not belong.*revision/iu);

	const exact = buildFixture(context, 'exact-head');
	exact.options.sourceRevision = head;
	const exactResult = await createFramescaperOpenFxHostBuildResult(exact.options);
	assert.equal((await stageFramescaperOpenFxHostBuildResult({
		buildResultRoot: exactResult.buildResultRoot, repositoryRoot: checkout,
	})).status, 'staged');
});

function buildFixture(context, suffix = 'first') {
	const root = temporary(context, `framescaper-openfx-result-${suffix}-`);
	const hostInstallRoot = join(root, 'host-install');
	const isolationInstallRoot = join(root, 'isolation-install');
	for (const path of [
		join(hostInstallRoot, 'bin'), join(isolationInstallRoot, 'bin'),
		join(isolationInstallRoot, 'profiles'),
	]) mkdirSync(path, { recursive: true });
	const binary = elfX64();
	writeFileSync(join(hostInstallRoot, 'bin/framescaper-ofx-scanner'), binary);
	writeFileSync(join(hostInstallRoot, 'bin/framescaper-ofx-runtime-host'), binary);
	writeFileSync(join(isolationInstallRoot, 'bin/milestone5-native-isolation-launcher'), binary);
	writeFileSync(join(isolationInstallRoot, 'profiles/linux-v1.json'), '{"profile":1}\n');
	writeFileSync(join(isolationInstallRoot, 'profiles/linux-broker-v1.json'), '{"broker":1}\n');
	const loader = join(root, 'ld-linux-x86-64.so.2');
	writeFileSync(loader, binary);
	const toolchainBody = {
		schemaVersion: 1, targetId: 'linux-x64', hostRuntime: 'linux-x64',
		executables: {
			c: descriptor('/toolchain/cc'), cmake: descriptor('/toolchain/cmake'),
			cxx: descriptor('/toolchain/c++'), ninja: descriptor('/toolchain/ninja'),
		},
		environment: { PATH: '/toolchain' },
	};
	const toolchainReceipt = {
		...toolchainBody,
		identitySha256: fingerprintFramescaperOpenFxHostToolchainReceipt(toolchainBody),
	};
	const passed = (id) => ({
		id, status: 'passed', commandSha256: digest(Buffer.from(`${id}-command`)),
		outputSha256: digest(Buffer.from(`${id}-output`)),
	});
	return {
		options: {
			target: 'linux-x64', repositoryRoot: REPOSITORY_ROOT,
			hostInstallRoot, isolationInstallRoot, runtimeLibraryPaths: [loader],
			buildResultRoot: join(root, 'result'), sourceRevision: REVISION,
			buildRecipeSha256: '56'.repeat(32), toolchainReceipt,
			sourceAuthentication: {
				openfx: {
					schemaVersion: 1, component: 'openfx', version: '1.5.1',
					commitSha: 'ab779510b2655b4d11a7e01e5c521f9aa8c88976',
					archiveSha256: '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5',
					extractedTreeSha256: 'bd7c4e5850725a2ed985e7c5f1f531a33e1c2509057052b21a0062454c3a8efe',
					root: '/sources/openfx',
				},
				boost: {
					schemaVersion: 1, component: 'boost', version: '1.92.0',
					archiveSha256: '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c',
					headerClosureSha256: 'a2f5894e12bc386b7db96936aba5f5bef3910e52da634c7630c73f1fa63e913d',
					root: '/sources/boost',
				},
			},
			selfTests: [passed('isolation-launcher-refusal'),
				passed('openfx-runtime-host-self-test'), passed('openfx-scanner-self-test')],
		},
	};
}

function checkoutFixture(context) {
	const root = temporary(context, 'framescaper-openfx-checkout-');
	mkdirSync(join(root, 'native/framescaper-openfx-host'), { recursive: true });
	mkdirSync(join(root, 'config'), { recursive: true });
	cpSync(join(REPOSITORY_ROOT, 'native/framescaper-openfx-host/source-manifest.json'),
		join(root, 'native/framescaper-openfx-host/source-manifest.json'));
	cpSync(join(REPOSITORY_ROOT, 'config/framescaper-openfx-host-payload-manifest.json'),
		join(root, 'config/framescaper-openfx-host-payload-manifest.json'));
	return root;
}

function elfX64() {
	const bytes = Buffer.alloc(64);
	bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
	bytes.writeUInt16LE(62, 18);
	return bytes;
}

function pe(machine) {
	const bytes = Buffer.alloc(256);
	bytes.write('MZ', 0, 'ascii');
	bytes.writeUInt32LE(0x80, 0x3c);
	bytes.write('PE\0\0', 0x80, 'binary');
	bytes.writeUInt16LE(machine, 0x84);
	bytes.writeUInt16LE(0x20b, 0x98);
	return bytes;
}

function arm64EcImage() {
	const bytes = Buffer.alloc(0x800);
	const peOffset = 0x80;
	const optional = peOffset + 24;
	const section = optional + 240;
	const imageBase = 0x1_4000_0000n;
	bytes.write('MZ', 0, 'ascii');
	bytes.writeUInt32LE(peOffset, 0x3c);
	bytes.write('PE\0\0', peOffset, 'binary');
	bytes.writeUInt16LE(0x8664, peOffset + 4);
	bytes.writeUInt16LE(1, peOffset + 6);
	bytes.writeUInt16LE(240, peOffset + 20);
	bytes.writeUInt16LE(0x20b, optional);
	bytes.writeBigUInt64LE(imageBase, optional + 24);
	bytes.writeUInt32LE(16, optional + 108);
	bytes.writeUInt32LE(0x1000, optional + 112 + 10 * 8);
	bytes.writeUInt32LE(208, optional + 112 + 10 * 8 + 4);
	bytes.writeUInt32LE(0x400, section + 8);
	bytes.writeUInt32LE(0x1000, section + 12);
	bytes.writeUInt32LE(0x400, section + 16);
	bytes.writeUInt32LE(0x400, section + 20);
	bytes.writeUInt32LE(208, 0x400);
	bytes.writeBigUInt64LE(imageBase + 0x1100n, 0x400 + 200);
	bytes.writeUInt32LE(1, 0x500);
	bytes.writeUInt32LE(0x1200, 0x504);
	bytes.writeUInt32LE(1, 0x508);
	bytes.writeUInt32LE(1, 0x600);
	bytes.writeUInt32LE(0x40, 0x604);
	return bytes;
}

async function inventory(root) {
	const output = [];
	const { readdir } = await import('node:fs/promises');
	await visit(root, '');
	return output.sort();
	async function visit(directory, prefix) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await visit(join(directory, entry.name), path);
			else output.push(path);
		}
	}
}

function temporary(context, prefix) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function descriptor(path) { return { path, sha256: digest(Buffer.from(path)) }; }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function git(cwd, args) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
	assert.equal(result.status, 0, result.stderr);
	return result;
}
