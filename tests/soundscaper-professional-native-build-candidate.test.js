/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, win32 } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperProfessionalNativeCandidate,
	promoteSoundscaperProfessionalNativeCandidate,
	requiredSoundscaperProfessionalNativeSelfTestIds,
	soundscaperProfessionalNativeSourceIdsForTarget,
	verifySoundscaperProfessionalNativeCandidate,
} from '../scripts/lib/soundscaper-professional-native-build-candidate.mjs';
import {
	assertAuthenticatedSoundscaperProfessionalNativeSelfTestPlan,
	createAuthenticatedSoundscaperProfessionalNativeSelfTestPlan,
	isExternalPathRelation,
	requiredPipelineSoundscaperProfessionalNativeSelfTestIds,
	verifyAuthenticatedSoundscaperProfessionalNativeSelfTestPlan,
} from '../scripts/lib/soundscaper-professional-native-self-test-plan.mjs';
import {
	createSoundscaperProfessionalNativeMacSigningPlan,
	executeSoundscaperProfessionalNativeMacSigningPlan,
} from '../scripts/lib/soundscaper-professional-native-macos-signing.mjs';
import {
	soundscaperProfessionalNativePipelineSelfTestReceipts,
} from '../scripts/lib/soundscaper-professional-native-candidate-pipeline.mjs';
import {
	createSoundscaperProfessionalNativeToolchainReceipt,
	soundscaperProfessionalNativeToolchainIdentity,
} from '../scripts/lib/soundscaper-professional-native-toolchain.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_REVISION = '12'.repeat(20); const BUILD_PLAN_SHA256 = '34'.repeat(32);

test('self-test authority recognizes a normalized path on another Windows volume as external', () => {
	const repositoryRoot = 'D:\\a\\Soundscaper\\Soundscaper';
	const isExternal = (value) => {
		const relation = win32.relative(repositoryRoot, value);
		return isExternalPathRelation(relation, win32.sep, win32.isAbsolute(relation));
	};
	assert.equal(isExternal('C:\\Users\\runneradmin\\AppData\\Local\\soundscaper-native'), true);
	assert.equal(isExternal(repositoryRoot), false);
	assert.equal(isExternal(win32.join(repositoryRoot, 'payload')), false);
	assert.equal(isExternal('D:\\a\\Soundscaper\\sibling'), true);
});

test('Soundscaper candidate source scope excludes every Framescaper codec input', () => {
	assert.deepEqual(soundscaperProfessionalNativeSourceIdsForTarget('mac-arm64'), [
		'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk',
	]);
	assert.deepEqual(soundscaperProfessionalNativeSourceIdsForTarget('win-arm64'), [
		'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk',
	]);
	assert.deepEqual(soundscaperProfessionalNativeSourceIdsForTarget('linux-x64'), [
		'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'lv2',
	]);
	assert.throws(() => soundscaperProfessionalNativeSourceIdsForTarget('mac-x64'), /target/u);
});

test('the packaged Electron smoke binds a separate exact addon-inventory receipt', () => {
	const request = {
		id: 'packaged-electron-utility-process-smoke',
		command: '/target/electron',
		args: ['--scenario=packaged-electron-utility-process-smoke'],
		expectedStatus: 0,
	};
	const result = { output: Buffer.from('{"status":"passed"}\n') };
	const receipts = soundscaperProfessionalNativePipelineSelfTestReceipts(request, result);
	assert.deepEqual(receipts.map(({ id }) => id), [
		'packaged-electron-utility-process-smoke',
		'addon-exact-backend-format-inventory',
	]);
	assert.equal(receipts[0].outputSha256, receipts[1].outputSha256);
	assert.notEqual(receipts[0].commandSha256, receipts[1].commandSha256);
});
test('self-test commands are closed, clean-HEAD authorities and refuse a changed implementation', async (context) => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-pro-self-test-authority-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const authoritySources = [
		['scripts/self-test-soundscaper-professional-native-runtime.mjs', '#!/usr/bin/env node\nprocess.exitCode = 0;\n'],
		['scripts/self-test-soundscaper-delivery-fs.mjs', '#!/usr/bin/env node\nprocess.exitCode = 0;\n'],
		['scripts/lib/soundscaper-professional-packaged-app-authority.mjs', 'export const authority = true;\n'],
		['scripts/lib/soundscaper-native-test-runtime.mjs', 'export const runtime = true;\n'],
		['scripts/lib/soundscaper-professional-native-containment-probes.mjs', 'export const containment = true;\n'],
		['desktop/soundscaper-professional-linux-system-libraries.ts', 'export const libraries = true;\n'],
		['desktop/soundscaper-professional-linux-system-runtime.ts', 'export const runtime = true;\n'],
	];
	await Promise.all(['scripts/lib', 'desktop'].map((path) =>
		mkdir(join(repositoryRoot, path), { recursive: true })));
	await Promise.all(authoritySources.map(([path, source]) =>
		writeFile(join(repositoryRoot, path), source)));
	const driverPath = join(repositoryRoot, authoritySources[0][0]);
	execFileSync('git', ['init', '-q'], { cwd: repositoryRoot });
	execFileSync('git', ['add', '.'], { cwd: repositoryRoot });
	execFileSync('git', ['-c', 'user.name=Soundscaper Tests', '-c', 'user.email=test@soundscaper.invalid',
		'commit', '-qm', 'fixture'], { cwd: repositoryRoot });
	const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: repositoryRoot, encoding: 'utf8',
	}).trim();
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-pro-self-test-output-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const packagedAppRoot = join(outputRoot, 'packaged-app');
	await packagedAppFixture(packagedAppRoot, sourceRevision);
	const plan = createAuthenticatedSoundscaperProfessionalNativeSelfTestPlan({
		repositoryRoot, sourceRevision, target: 'linux-x64',
		professionalInstallRoot: join(outputRoot, 'professional'),
		isolationInstallRoot: join(outputRoot, 'isolation'),
		runtimeRoot: join(outputRoot, 'runtime'),
		packagedAppRoot,
	});
	assert.equal(assertAuthenticatedSoundscaperProfessionalNativeSelfTestPlan(plan), plan);
	assert.deepEqual(plan.commands.map(({ id }) => id).sort(),
		requiredPipelineSoundscaperProfessionalNativeSelfTestIds('linux-x64'));
	assert(plan.commands.every(({ command, args }) => command === process.execPath
		&& args[1] === driverPath && args.includes('--target=linux-x64')
		&& args.some((value) => value.startsWith('--packaged-app-authority-sha256='))));
	assert.equal(plan.authority.packagedApp.sourceRevision, sourceRevision);
	assert.deepEqual(plan.authority.files.map(({ path }) => path), [
		'scripts/self-test-soundscaper-professional-native-runtime.mjs',
		'scripts/self-test-soundscaper-delivery-fs.mjs',
		'scripts/lib/soundscaper-professional-packaged-app-authority.mjs',
		'scripts/lib/soundscaper-native-test-runtime.mjs',
		'scripts/lib/soundscaper-professional-native-containment-probes.mjs',
		'desktop/soundscaper-professional-linux-system-libraries.ts', 'desktop/soundscaper-professional-linux-system-runtime.ts',
	]);
	assert.throws(() => assertAuthenticatedSoundscaperProfessionalNativeSelfTestPlan({ ...plan }),
		/authenticated self-test plan/iu);
	await writeFile(driverPath, '#!/usr/bin/env node\nprocess.exitCode = 0; // changed\n');
	assert.throws(() => verifyAuthenticatedSoundscaperProfessionalNativeSelfTestPlan(plan),
		/changed.*clean HEAD|working tree/iu);
	assert.throws(() => createAuthenticatedSoundscaperProfessionalNativeSelfTestPlan({
		repositoryRoot, sourceRevision, target: 'linux-x64',
		professionalInstallRoot: join(outputRoot, 'professional'),
		isolationInstallRoot: join(outputRoot, 'isolation'),
		runtimeRoot: join(outputRoot, 'runtime'),
		packagedAppRoot,
	}), /clean.*HEAD|working tree/iu);
});

test('a candidate binds installed payloads, closed dependencies, and passing self-tests', async (context) => {
	const fixture = await candidateFixture(context);
	const selfTests = [];
	const inspected = [];
	const candidate = await createSoundscaperProfessionalNativeCandidate({
		...fixture.options,
		inspectDependencies: async ({ path }) => {
			inspected.push(path);
			return dependencyInspection(path, path.endsWith('soundscaper_professional_peer')
				? ['libowned.so', 'libc.so.6'] : ['libc.so.6']);
		},
		runSelfTest: async (request) => {
			selfTests.push({ id: request.id, expectedStatus: request.expectedStatus });
			return { status: request.expectedStatus, stdout: `${request.id} passed\n`, stderr: '' };
		},
	});
	assert.deepEqual(selfTests, [
		{ id: 'm5f1-malformed-frame', expectedStatus: 125 },
		{ id: 'delivery-filesystem-protocol', expectedStatus: 0 },
		{ id: 'launcher-refusal', expectedStatus: 125 },
	]);
	assert.equal(candidate.receipt.kind, 'soundscaper-professional-native-candidate');
	assert.equal(candidate.receipt.target, 'linux-x64');
	assert.equal(candidate.receipt.productionReadiness, null);
	assert.deepEqual(candidate.receipt.isolation.runtimeClosure.map(({ path }) => path), [
		'payload/runtime/libowned.so',
	]);
	assert(inspected.some((path) => path.endsWith('payload/runtime/libowned.so')),
		'the dependency closure must recursively inspect bundled libraries');
	assert.deepEqual(candidate.receipt.evidenceReceipts.map(({ kind }) => kind), [
		'build', 'self-test', 'toolchain', 'source-authentication',
		'installed-files', 'dependency-closure',
	]);
	const selfTestEvidence = candidate.receipt.evidenceReceipts
		.find(({ kind }) => kind === 'self-test').evidence;
	const buildEvidence = candidate.receipt.evidenceReceipts
		.find(({ kind }) => kind === 'build').evidence;
	const dependencyEvidence = candidate.receipt.evidenceReceipts
		.find(({ kind }) => kind === 'dependency-closure').evidence;
	assert.equal(buildEvidence.packagedAppAuthority.sourceRevision, SOURCE_REVISION);
	assert.equal(buildEvidence.packagedAppAuthority.target, 'linux-x64');
	assert.equal(selfTestEvidence.tests.every(({ status }) => status === 'passed'), true);
	assert.deepEqual(selfTestEvidence.tests.map(({ id }) => id).sort(),
		requiredSoundscaperProfessionalNativeSelfTestIds('linux-x64'));
	assert.deepEqual(dependencyEvidence.checks, [
		'ambient-dependency-refusal', 'recursive-inspection', 'rpath-refusal',
		'runtime-file-limit-refusal', 'symlink-refusal', 'undeclared-dependency-refusal',
	]);
	assert.deepEqual((await verifySoundscaperProfessionalNativeCandidate({
		candidateRoot: fixture.candidateRoot,
	})).receipt, candidate.receipt);
});

test('closure admission rejects symlinks, ambient paths, bad RPATHs, and more than 128 files', async (context) => {
	const ambient = await candidateFixture(context);
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...ambient.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path,
			path.endsWith('soundscaper_professional_peer') ? ['/opt/private/libowned.so'] : []),
		runSelfTest: passingSelfTest,
	}), /ambient runtime dependency/iu);
	const rpath = await candidateFixture(context);
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...rpath.options,
		inspectDependencies: async ({ path }) => ({
			architecture: architectureReceipt('linux-x64'),
			imports: [], rpaths: path.endsWith('soundscaper_professional_peer') ? ['/tmp/runtime'] : [],
		}),
		runSelfTest: passingSelfTest,
	}), /unreviewed native RPATH/iu);
	const linked = await candidateFixture(context);
	await symlink(join(linked.options.runtimeRoot, 'libowned.so'),
		join(linked.options.runtimeRoot, 'linked.so'));
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...linked.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, []),
		runSelfTest: passingSelfTest,
	}), /symbolic links/iu);
	const oversized = await candidateFixture(context);
	await Promise.all(Array.from({ length: 128 }, (_, index) =>
		writeFile(join(oversized.options.runtimeRoot, `extra-${String(index).padStart(3, '0')}.so`), 'x')));
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...oversized.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, []),
		runSelfTest: passingSelfTest,
	}), /exceeds 128 files/iu);
});

test('candidate creation refuses an undeclared imported library without publishing output', async (context) => {
	const fixture = await candidateFixture(context);
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...fixture.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path,
			path.endsWith('soundscaper_professional_peer') ? ['libmissing.so'] : []),
		runSelfTest: async ({ expectedStatus }) => ({ status: expectedStatus, stdout: '', stderr: '' }),
	}), /undeclared runtime dependency.*libmissing\.so/iu);
	await assert.rejects(() => readFile(join(fixture.candidateRoot, 'candidate.json')), /ENOENT/u);
});

test('candidate creation refuses a wrong-architecture binary without publishing output', async (context) => {
	const fixture = await candidateFixture(context);
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...fixture.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, [], 'linux-arm64'),
		runSelfTest: passingSelfTest,
	}), /architecture receipt.*does not match linux-x64/iu);
	await assert.rejects(() => readFile(join(fixture.candidateRoot, 'candidate.json')), /ENOENT/u);
});

test('verification and promotion reject every missing or tampered evidence-receipt category', async (context) => {
	const fixture = await candidateFixture(context);
	await createSoundscaperProfessionalNativeCandidate({
		...fixture.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, []),
		runSelfTest: passingSelfTest,
	});
	const path = join(fixture.candidateRoot, 'candidate.json');
	const original = JSON.parse(await readFile(path, 'utf8'));
	await chmod(path, 0o600);
	for (const kind of original.evidenceReceipts.map(({ kind }) => kind)) {
		const tampered = structuredClone(original);
		tampered.evidenceReceipts.find((entry) => entry.kind === kind).evidence.tampered = true;
		await writeFile(path, canonicalJson(tampered));
		await assert.rejects(() => verifySoundscaperProfessionalNativeCandidate({
			candidateRoot: fixture.candidateRoot,
		}), new RegExp(kind, 'iu'));
	}
	const missing = structuredClone(original);
	missing.evidenceReceipts.pop();
	await writeFile(path, canonicalJson(missing));
	await assert.rejects(() => promoteSoundscaperProfessionalNativeCandidate({
		candidateRoot: fixture.candidateRoot,
	}), /evidence receipt inventory is incomplete/iu);
});

test('promotion is no-overwrite, idempotent for one exact candidate, and leaves readiness external', async (context) => {
	const repository = await promotionRepository(context, 'soundscaper-pro-promotion-');
	const stale = await candidateFixture(context);
	await createSoundscaperProfessionalNativeCandidate({
		...stale.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, []),
		runSelfTest: passingSelfTest,
	});
	await assert.rejects(() => promoteSoundscaperProfessionalNativeCandidate({
		candidateRoot: stale.candidateRoot, repositoryRoot: repository.root,
	}), /candidate source revision.*checked-out|checked-out.*candidate source revision/iu);
	const fixture = await candidateFixture(context, 'linux-x64', repository.sourceRevision);
	await createSoundscaperProfessionalNativeCandidate({
		...fixture.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, []),
		runSelfTest: async ({ expectedStatus }) => ({ status: expectedStatus, stdout: 'passed', stderr: '' }),
	});
	const promoted = await promoteSoundscaperProfessionalNativeCandidate({
		candidateRoot: fixture.candidateRoot, repositoryRoot: repository.root,
	});
	assert.equal(promoted.status, 'promoted');
	const manifest = JSON.parse(await readFile(
		join(repository.root, 'config/soundscaper-professional-native-payload-manifest.json'), 'utf8',
	));
	const row = manifest.targets.find(({ id }) => id === 'linux-x64');
	assert.equal(row.status, 'built');
	assert.equal(row.blockedBy, null);
	assert.equal(row.productionReadiness, null);
	assert.match(row.payload.path, /prebuilt\/linux-x64\/soundscaper_professional\.node$/u);
	assert.match(row.deliveryFilesystem.path,
		/prebuilt\/linux-x64\/soundscaper_delivery_fs$/u);
	assert.match(row.buildCandidate.path, /prebuilt\/linux-x64\/soundscaper-professional-native-candidate\.json$/u);
	assert.equal((await promoteSoundscaperProfessionalNativeCandidate({
		candidateRoot: fixture.candidateRoot, repositoryRoot: repository.root,
	})).status, 'already-promoted');
	await writeFile(join(fixture.candidateRoot, 'payload/soundscaper_professional.node'), 'changed');
	await assert.rejects(() => promoteSoundscaperProfessionalNativeCandidate({
		candidateRoot: fixture.candidateRoot, repositoryRoot: repository.root,
	}), /digest|changed|authenticate/iu);
});

test('standalone concurrent target promotions serialize without losing either manifest row', async (context) => {
	const repository = await promotionRepository(context, 'soundscaper-pro-concurrent-promotion-');
	const linux = await candidateFixture(context, 'linux-x64', repository.sourceRevision);
	const mac = await candidateFixture(context, 'mac-arm64', repository.sourceRevision);
	for (const fixture of [linux, mac]) await createSoundscaperProfessionalNativeCandidate({
		...fixture.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, [], fixture.options.target),
		runSelfTest: passingSelfTest,
	});
	const promoted = await Promise.all([linux, mac].map((fixture) =>
		promoteSoundscaperProfessionalNativeCandidate({
			candidateRoot: fixture.candidateRoot, repositoryRoot: repository.root,
		})));
	assert.deepEqual(promoted.map(({ status }) => status), ['promoted', 'promoted']);
	const manifest = JSON.parse(await readFile(join(repository.root,
		'config/soundscaper-professional-native-payload-manifest.json'), 'utf8'));
	assert.equal(manifest.targets.find(({ id }) => id === 'linux-x64').status, 'built');
	assert.equal(manifest.targets.find(({ id }) => id === 'mac-arm64').status, 'built');
	await assert.rejects(() => readFile(join(repository.root,
		'config/.soundscaper-professional-native-promotion.lock/owner.json')), /ENOENT/u);
});

test('mac candidates require, receipt-bind, and promote the OS audio codec addon while Linux is exactly null', async (context) => {
	const linux = await candidateFixture(context);
	const linuxCandidate = await createSoundscaperProfessionalNativeCandidate({
		...linux.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, [], 'linux-x64'),
		runSelfTest: passingSelfTest,
	});
	assert.equal(linuxCandidate.receipt.osAudioCodec, null);
	const repository = await promotionRepository(context, 'soundscaper-pro-mac-promotion-');
	const mac = await candidateFixture(context, 'mac-arm64', repository.sourceRevision);
	const codecPath = join(mac.options.osAudioCodecInstallRoot, 'soundscaper_os_audio_codec.node');
	await rm(codecPath);
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...mac.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, [], 'mac-arm64'),
		runSelfTest: passingSelfTest,
	}), /OS audio codec|installed candidate input|ENOENT/iu);
	await writeFile(codecPath, 'os-codec');
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...mac.options, macSigningEvidence: null,
		inspectDependencies: async ({ path }) => dependencyInspection(path, [], 'mac-arm64'),
		runSelfTest: passingSelfTest,
	}), /mac signing evidence/iu);
	const tamperedSigning = structuredClone(mac.options.macSigningEvidence);
	tamperedSigning.artifacts[0].sha256 = 'f'.repeat(64);
	await assert.rejects(() => createSoundscaperProfessionalNativeCandidate({
		...mac.options, macSigningEvidence: tamperedSigning,
		inspectDependencies: async ({ path }) => dependencyInspection(path, [], 'mac-arm64'),
		runSelfTest: passingSelfTest,
	}), /mac signing evidence.*payload-misbound/iu);
	const candidate = await createSoundscaperProfessionalNativeCandidate({ ...mac.options,
		inspectDependencies: async ({ path }) => dependencyInspection(path, [], 'mac-arm64'),
		runSelfTest: passingSelfTest,
	});
	assert.equal(candidate.receipt.osAudioCodec.path, 'payload/soundscaper_os_audio_codec.node');
	const signing = candidate.receipt.evidenceReceipts.find(({ kind }) => kind === 'build').evidence.macSigning;
	assert(signing.schemaVersion === 2 && signing.status === 'signatures-verified');
	assert.deepEqual(signing, mac.options.macSigningEvidence);
	for (const artifact of signing.artifacts) {
		const peer = artifact.path === 'payload/soundscaper_professional_peer';
		assert.equal(artifact.libraryValidation.expectation, peer ? 'present' : 'absent');
		assert.equal(artifact.libraryValidation.entitlements?.path ?? null, peer
			? 'native/soundscaper-professional-host/soundscaper-professional-peer-entitlements.mac.plist' : null);
	}
	assert(candidate.receipt.evidenceReceipts.find(({ kind }) => kind === 'installed-files').evidence.files.some(({ path }) => path === candidate.receipt.osAudioCodec.path));
	await promoteSoundscaperProfessionalNativeCandidate({ candidateRoot: mac.candidateRoot, repositoryRoot: repository.root });
	const manifest = JSON.parse(await readFile(join(repository.root, 'config/soundscaper-professional-native-payload-manifest.json'), 'utf8'));
	const row = manifest.targets.find(({ id }) => id === 'mac-arm64');
	assert.match(row.osAudioCodec.path, /prebuilt\/mac-arm64\/soundscaper_os_audio_codec\.node$/u);
	assert.equal(await readFile(join(repository.root, row.osAudioCodec.path), 'utf8'), 'os-codec');
});

async function promotionRepository(context, prefix) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'config'), { recursive: true });
	await writeFile(join(root, 'config/soundscaper-professional-native-payload-manifest.json'),
		await readFile(join(ROOT, 'config/soundscaper-professional-native-payload-manifest.json')));
	execFileSync('git', ['init', '-q'], { cwd: root });
	execFileSync('git', ['add', '.'], { cwd: root });
	execFileSync('git', [
		'-c', 'user.name=Soundscaper Tests', '-c', 'user.email=test@soundscaper.invalid',
		'commit', '-qm', 'promotion fixture',
	], { cwd: root });
	return Object.freeze({
		root,
		sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
	});
}

async function candidateFixture(context, target = 'linux-x64', sourceRevision = SOURCE_REVISION) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-pro-candidate-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const professionalInstallRoot = join(root, 'professional-install');
	const isolationInstallRoot = join(root, 'isolation-install');
	const runtimeRoot = join(root, 'runtime');
	const osAudioCodecInstallRoot = join(root, 'os-codec-install');
	const candidateRoot = join(root, 'candidate');
	const windows = target.startsWith('win-');
	const [profile, broker] = target.startsWith('linux-')
		? ['linux-v1.json', 'linux-broker-v1.json']
		: target === 'mac-arm64'
			? ['macos-v1.sb', 'macos-broker-v1.json']
			: ['windows-v1.json', 'windows-broker-v1.json'];
	for (const [path, contents] of [
		[join(professionalInstallRoot, 'soundscaper_professional.node'), 'addon'],
		[join(professionalInstallRoot, `soundscaper_professional_peer${windows ? '.exe' : ''}`), 'peer'],
		[join(professionalInstallRoot, `soundscaper_delivery_fs${windows ? '.exe' : ''}`), 'delivery-fs'],
		[join(isolationInstallRoot,
			`bin/milestone5-native-isolation-launcher${windows ? '.exe' : ''}`), 'launcher'],
		[join(isolationInstallRoot, 'profiles', profile), '{"profile":"fixture"}\n'],
		[join(isolationInstallRoot, 'profiles', broker), '{"broker":"fixture"}\n'],
		[join(runtimeRoot, 'libowned.so'), 'runtime'],
		...(!target.startsWith('linux-')
			? [[join(osAudioCodecInstallRoot, 'soundscaper_os_audio_codec.node'), 'os-codec']] : []),
	]) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, contents);
	}
	const macSigningEvidence = target === 'mac-arm64'
		? await executeSoundscaperProfessionalNativeMacSigningPlan(
			createSoundscaperProfessionalNativeMacSigningPlan({
				target, signingIdentity: '-', professionalInstallRoot, isolationInstallRoot,
				osAudioCodecInstallRoot, runtimeRoot,
			}), {
				run: () => ({ status: 0, signal: null, stdout: '', stderr: '' }),
			},
		) : null;
	const toolchainReceipt = fixtureToolchainReceipt(target);
	return {
		candidateRoot,
		options: {
			candidateRoot,
			professionalInstallRoot,
			isolationInstallRoot,
			runtimeRoot,
			target,
			...(!target.startsWith('linux-') ? { osAudioCodecInstallRoot } : {}),
			sourceRevision,
			buildPlanSha256: BUILD_PLAN_SHA256,
			toolchainIdentity: soundscaperProfessionalNativeToolchainIdentity(toolchainReceipt),
			toolchainReceipt,
			packagedAppAuthority: packagedAppAuthority(target, sourceRevision),
			sourceAuthentication: sourceAuthentication(target),
			buildSelfTests: buildSelfTests(target),
			macSigningEvidence,
		},
	};
}

function fixtureToolchainReceipt(target) {
	const [platform, architecture] = target.split('-');
	const systemName = platform === 'linux' ? 'Linux' : platform === 'mac' ? 'Darwin' : 'Windows';
	const systemProcessor = architecture === 'x64' ? 'x86_64' : 'arm64';
	const generator = platform === 'win' ? 'Visual Studio 17 2022' : 'Ninja';
	const generatorPlatform = platform === 'win' ? architecture === 'x64' ? 'x64' : 'ARM64' : '';
	const identity = {
		cmakeVersion: '4.2.1', generator, generatorPlatform, systemName, systemProcessor,
		osxArchitectures: platform === 'mac' ? 'arm64' : '',
		cCompiler: { id: platform === 'win' ? 'MSVC' : 'Clang', version: '19.44.1' },
		cxxCompiler: { id: platform === 'win' ? 'MSVC' : 'Clang', version: '19.44.1' },
	};
	return createSoundscaperProfessionalNativeToolchainReceipt({
		target, professional: identity, isolation: structuredClone(identity),
		osAudioCodec: platform === 'linux' ? null : {
			cmake: '4.2.1', cxxCompilerId: platform === 'win' ? 'MSVC' : 'Clang',
			cxxCompilerVersion: '19.44.1', generator, systemName, systemProcessor,
		},
	});
}

function buildSelfTests(target) {
	const candidateExecuted = new Set([
		'm5f1-malformed-frame', 'launcher-refusal',
		'delivery-filesystem-protocol',
		'closure-recursive-inspection', 'closure-symlink-refusal',
		'closure-ambient-dependency-refusal', 'closure-rpath-refusal',
		'closure-undeclared-dependency-refusal', 'closure-runtime-file-limit-refusal',
	]);
	return requiredSoundscaperProfessionalNativeSelfTestIds(target)
		.filter((id) => !candidateExecuted.has(id))
		.map((id) => ({
			id, status: 'passed', commandSha256: sha256(`command:${id}`),
			outputSha256: sha256(`output:${id}`),
		}));
}

function dependencyInspection(path, imports, target = 'linux-x64') {
	return {
		architecture: architectureReceipt(target),
		imports,
		rpaths: path.includes('soundscaper_professional_peer')
			? [target === 'mac-arm64' ? '@loader_path/runtime' : '$ORIGIN/runtime'] : [],
	};
}

function architectureReceipt(target) {
	const [platform, architecture] = target.split('-');
	return {
		schemaVersion: 1, target, architecture,
		format: platform === 'linux' ? 'elf64-le'
			: platform === 'win' ? 'pe32-plus' : 'mach-o-64-le',
		machine: platform === 'linux'
			? architecture === 'x64' ? 'EM_X86_64' : 'EM_AARCH64'
			: platform === 'win'
				? architecture === 'x64' ? 'IMAGE_FILE_MACHINE_AMD64' : 'IMAGE_FILE_MACHINE_ARM64'
				: 'CPU_TYPE_ARM64',
	};
}

function passingSelfTest({ expectedStatus }) { return { status: expectedStatus, stdout: 'passed', stderr: '' }; }

function sourceAuthentication(target) {
	return {
		schemaVersion: 1,
		status: 'authenticated',
		sources: soundscaperProfessionalNativeSourceIdsForTarget(target).map((id, index) => ({
			id,
			authenticationStatus: 'authenticated',
			archiveEvidence: { byteLength: index + 1, sha256: `${index}`.repeat(64) },
			extractedTreeEvidence: {
				algorithm: 'framescaper-portable-source-tree-sha256-v1',
				fileCount: index + 1,
				sha256: `${index + 1}`.repeat(64),
			},
		})),
	};
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
	return `${JSON.stringify(value, null, '\t')}\n`;
}

function packagedAppAuthority(target, sourceRevision = SOURCE_REVISION) {
	return {
		schemaVersion: 1,
		kind: 'soundscaper-professional-packaged-electron-authority',
		target,
		sourceRevision,
		contentManifest: {
			path: 'package/resources/milestone-5-package-content.json',
			byteLength: 1,
			sha256: '5'.repeat(64),
			closureSha256: '6'.repeat(64),
		},
		executable: { path: 'package/Soundscaper', byteLength: 1, sha256: '7'.repeat(64) },
		rootFileCount: 2,
		rootTotalBytes: 2,
		rootClosureSha256: '8'.repeat(64),
	};
}

async function packagedAppFixture(root, sourceRevision) {
	const resources = join(root, 'linux-unpacked/resources');
	await mkdir(resources, { recursive: true });
	await writeFile(join(root, 'linux-unpacked/soundscaper'), 'executable');
	const resource = Buffer.from('resource');
	await writeFile(join(resources, 'app.asar'), resource);
	const files = [{ path: 'app.asar', byteLength: resource.byteLength, sha256: sha256(resource) }];
	await writeFile(join(resources, 'milestone-5-package-content.json'), `${JSON.stringify({
		schemaVersion: 1, status: 'installed-resource-closure-audited',
		productId: 'soundscaper', targetId: 'linux-x64', applicationVersion: '1.0.0-rc.1',
		sourceRevision,
		runtimeManifest: {
			byteLength: 1, sha256: '1'.repeat(64),
			value: { schemaVersion: 1, productId: 'soundscaper', sourceRevision,
				target: { platform: 'linux', arch: 'x64' } },
		},
		files, fileCount: 1, totalBytes: resource.byteLength,
		closureSha256: sha256(Buffer.from(JSON.stringify(files), 'utf8')),
	}, null, 2)}\n`);
}
