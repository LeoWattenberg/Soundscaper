/* SPDX-License-Identifier: AGPL-3.0-only */

/** Target-native build-result assembly, verification, and ephemeral package staging. */

import { spawnSync } from 'node:child_process';
import {
	chmod, copyFile, mkdir, mkdtemp, open, rename, rm, writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
	absentPath,
	bindVerificationCheck,
	boundedText,
	buildResultDescriptors,
	canonicalDirectory,
	canonicalJson,
	canonicalRegularFile,
	deepFreeze,
	descriptorOnly,
	digestValue,
	verificationFor,
	expectedSoundscaperProfessionalNativeInventory as expectedInventory,
	executableBuildResultArtifact,
	MAXIMUM_RUNTIME_FILES,
	MAXIMUM_SELF_TEST_OUTPUT_BYTES,
	normalizeSelfTests,
	normalizeSourceAuthentication,
	portableRelative,
	regularFileInventory,
	resolveBuildResultPath,
	revision,
	sameJson,
	sha256,
	soundscaperProfessionalNativeBuildResultArtifactPaths,
	targetId,
	verifyBuildResultDirectory,
	verifyDescriptor,
} from './soundscaper-professional-native-build-result-contract.mjs';
import { assertSoundscaperProfessionalNativeBuildSourceRevision as assertBuildSourceRevision }
	from './soundscaper-professional-native-build-source.mjs';
import {
	validateSoundscaperProfessionalPackagedAppAuthority,
} from './soundscaper-professional-packaged-app-authority.mjs';
import {
	inspectSoundscaperProfessionalNativeDependencies,
	validateSoundscaperProfessionalNativeDependencyClosure,
} from './soundscaper-professional-native-dependency-inspection.mjs';
import {
	soundscaperProfessionalNativeToolchainIdentity,
	validateSoundscaperProfessionalNativeToolchainReceipt,
} from './soundscaper-professional-native-toolchain.mjs';
import {
	soundscaperProfessionalNativeProcessFailureMessage,
} from './soundscaper-professional-native-process-diagnostics.mjs';

export {
	requiredSoundscaperProfessionalNativeSelfTestIds,
	soundscaperProfessionalNativeSourceIdsForTarget,
} from './soundscaper-professional-native-build-result-contract.mjs';

const RECEIPT_NAME = 'build-result.json';
export const STAGED_BUILD_RESULT_RECEIPT_NAME =
	'soundscaper-professional-native-build-result.json';
const MANIFEST_PATH = 'config/soundscaper-professional-native-payload-manifest.json';
const PREBUILT_ROOT = 'native/soundscaper-professional-host/prebuilt';
const CLOSURE_CHECKS = Object.freeze([
	'ambient-dependency-refusal', 'recursive-inspection', 'rpath-refusal',
	'runtime-file-limit-refusal', 'symlink-refusal', 'undeclared-dependency-refusal',
]);
const PROFILE_PATHS = Object.freeze({
	'linux-x64': Object.freeze(['profiles/linux-v1.json', 'profiles/linux-broker-v1.json']),
	'linux-arm64': Object.freeze(['profiles/linux-v1.json', 'profiles/linux-broker-v1.json']),
	'mac-arm64': Object.freeze(['profiles/macos-v1.sb', 'profiles/macos-broker-v1.json']),
	'win-x64': Object.freeze(['profiles/windows-v1.json', 'profiles/windows-broker-v1.json']),
	'win-arm64': Object.freeze(['profiles/windows-v1.json', 'profiles/windows-broker-v1.json']),
});

/**
 * Assemble one immutable build result outside the repository. This function never
 * mutates the production manifest and publishes its output only after every
 * file, dependency, and self-test check has been verified.
 */
export async function createSoundscaperProfessionalNativeBuildResult(options) {
	const target = targetId(options?.target);
	const buildResultRoot = absentPath(options?.buildResultRoot, 'build-result root');
	const professionalInstallRoot = await canonicalDirectory(
		options?.professionalInstallRoot, 'professional install root',
	);
	const isolationInstallRoot = await canonicalDirectory(
		options?.isolationInstallRoot, 'isolation install root',
	);
	const runtimeRoot = options?.runtimeRoot === null || options?.runtimeRoot === undefined
		? null : await canonicalDirectory(options.runtimeRoot, 'runtime root');
	const osAudioCodecInstallRoot = target.startsWith('linux-')
		? null : await canonicalDirectory(options?.osAudioCodecInstallRoot,
			'OS audio codec install root');
	if (target.startsWith('linux-') && options?.osAudioCodecInstallRoot !== null
		&& options?.osAudioCodecInstallRoot !== undefined) {
		throw new TypeError('Linux build results cannot accept an OS audio codec install root.');
	}
	const sourceAuthentication = normalizeSourceAuthentication(options?.sourceAuthentication, target);
	const sourceRevision = revision(options?.sourceRevision);
	const packagedAppAuthority = validateSoundscaperProfessionalPackagedAppAuthority(
		options?.packagedAppAuthority,
	);
	if (packagedAppAuthority.target !== target
		|| packagedAppAuthority.sourceRevision !== sourceRevision) {
		throw new TypeError('The packaged Electron authority is target or source misbound.');
	}
	const buildPlanSha256 = digestValue(options?.buildPlanSha256, 'build plan SHA-256');
	const toolchainIdentity = boundedText(options?.toolchainIdentity, 3, 512, 'toolchain identity');
	const toolchainReceipt = validateSoundscaperProfessionalNativeToolchainReceipt(
		structuredClone(options?.toolchainReceipt),
	);
	if (toolchainIdentity !== soundscaperProfessionalNativeToolchainIdentity(toolchainReceipt)
		|| toolchainReceipt.target !== target) {
		throw new TypeError('The structured toolchain receipt is target or identity misbound.');
	}
	const macCodeSealResult = options?.macCodeSealResult ?? null;
	if (target !== 'mac-arm64' && macCodeSealResult !== null) {
		throw new TypeError('Only mac-arm64 build results can carry a code-seal result.');
	}
	if (!Array.isArray(options?.buildSelfTests)) {
		throw new TypeError('Build-result creation requires its pre-install self-test receipts.');
	}
	const buildSelfTests = structuredClone(options.buildSelfTests);
	const inspectDependencies = options?.inspectDependencies
		?? inspectSoundscaperProfessionalNativeDependencies;
	const runSelfTest = options?.runSelfTest ?? runNativeSelfTest;
	if (typeof inspectDependencies !== 'function' || typeof runSelfTest !== 'function') {
		throw new TypeError('Build-result creation requires dependency-inspection and self-test ports.');
	}

	const parent = await canonicalDirectory(dirname(buildResultRoot), 'build-result parent');
	const temporary = await mkdtemp(join(parent, '.soundscaper-professional-build-result-'));
	let published = false;
	try {
		const payloadRoot = join(temporary, 'payload');
		await mkdir(payloadRoot, { mode: 0o700 });
		const installed = installedPaths(target, professionalInstallRoot, isolationInstallRoot);
		const paths = soundscaperProfessionalNativeBuildResultArtifactPaths(target);
		const copied = {
			payload: await copyBuildResultFile(installed.payload,
				resolve(temporary, paths.payload), temporary, 0o755),
			osAudioCodec: osAudioCodecInstallRoot === null ? null
				: await copyBuildResultFile(resolve(osAudioCodecInstallRoot, 'soundscaper_os_audio_codec.node'),
					resolve(temporary, paths.osAudioCodec), temporary, 0o755),
			pluginPeer: await copyBuildResultFile(installed.pluginPeer,
				resolve(temporary, paths.pluginPeer), temporary, 0o755),
			deliveryFilesystem: await copyBuildResultFile(installed.deliveryFilesystem,
				resolve(temporary, paths.deliveryFilesystem),
				temporary, 0o755),
			launcher: await copyBuildResultFile(installed.launcher,
				resolve(temporary, paths.launcher), temporary, 0o755),
			sandboxProfile: await copyBuildResultFile(installed.sandboxProfile,
				join(payloadRoot, 'native-isolation-profile-v1.json'), temporary, 0o444),
			brokerPolicy: await copyBuildResultFile(installed.brokerPolicy,
				join(payloadRoot, 'native-isolation-broker-v1.json'), temporary, 0o444),
		};
		const runtimeClosure = runtimeRoot === null
			? [] : await copyRuntimeClosure(runtimeRoot, join(payloadRoot, 'runtime'), temporary);
		const dependencyInspections = await validateSoundscaperProfessionalNativeDependencyClosure({
			target,
			artifacts: [copied.payload, ...(copied.osAudioCodec === null ? [] : [copied.osAudioCodec]),
				copied.pluginPeer, copied.deliveryFilesystem, copied.launcher, ...runtimeClosure],
			runtimeArtifacts: runtimeClosure,
			root: temporary,
			inspectDependencies,
		});
		const installedSelfTests = await executeInstalledSelfTests({
			target, copied, root: temporary, runSelfTest,
		});
		const selfTests = normalizeSelfTests([
			...buildSelfTests, ...installedSelfTests,
		], target);
		const installedFiles = [
			descriptorOnly(copied.payload),
			...(copied.osAudioCodec === null ? [] : [descriptorOnly(copied.osAudioCodec)]),
				descriptorOnly(copied.pluginPeer),
				descriptorOnly(copied.deliveryFilesystem),
			descriptorOnly(copied.launcher), descriptorOnly(copied.sandboxProfile),
			descriptorOnly(copied.brokerPolicy), ...runtimeClosure.map(descriptorOnly),
		];
		const verificationChecks = [
			bindVerificationCheck('build', target, {
				status: 'passed', sourceRevision, buildPlanSha256,
				packagedAppAuthority,
					macCodeSeal: macCodeSealResult === null
						? null : structuredClone(macCodeSealResult),
				tests: selfTests.filter(({ id }) => id.endsWith('-ctest')),
			}),
			bindVerificationCheck('self-test', target, {
				status: 'passed',
				inventory: expectedInventory(target),
				tests: selfTests,
			}),
			bindVerificationCheck('toolchain', target, {
				identity: toolchainIdentity, receipt: toolchainReceipt,
			}),
			bindVerificationCheck('source-authentication', target, {
				authentication: sourceAuthentication,
			}),
			bindVerificationCheck('installed-files', target, { files: installedFiles }),
			bindVerificationCheck('dependency-closure', target, {
				status: 'closed', maximumRuntimeFiles: MAXIMUM_RUNTIME_FILES,
				inspections: dependencyInspections,
				checks: CLOSURE_CHECKS,
			}),
		];
		const receipt = deepFreeze({
			schemaVersion: 1,
			kind: 'soundscaper-professional-native-build-result',
			target,
			sourceRevision,
			buildPlanSha256,
			verificationChecks,
			payload: descriptorOnly(copied.payload),
			osAudioCodec: copied.osAudioCodec === null ? null : descriptorOnly(copied.osAudioCodec),
			pluginPeer: descriptorOnly(copied.pluginPeer),
			deliveryFilesystem: descriptorOnly(copied.deliveryFilesystem),
			isolation: {
				launcher: descriptorOnly(copied.launcher),
				sandboxProfile: descriptorOnly(copied.sandboxProfile),
				brokerPolicy: descriptorOnly(copied.brokerPolicy),
				entrypointPath: copied.pluginPeer.path,
				runtimeClosure: runtimeClosure.map(descriptorOnly),
			},
		});
		await writeFile(join(temporary, RECEIPT_NAME), canonicalJson(receipt), { flag: 'wx', mode: 0o444 });
		await verifySoundscaperProfessionalNativeBuildResult({ buildResultRoot: temporary });
		await rename(temporary, buildResultRoot);
		published = true;
		return deepFreeze({ buildResultRoot, receipt });
	} finally {
		if (!published) await rm(temporary, { recursive: true, force: true });
	}
}

export async function verifySoundscaperProfessionalNativeBuildResult({ buildResultRoot }) {
	return verifyBuildResultDirectory(buildResultRoot);
}

/** Stage a verified result no-overwrite; replace the manifest only after copying its closed files. */
export async function stageSoundscaperProfessionalNativeBuildResult(options) {
	const verified = await verifySoundscaperProfessionalNativeBuildResult({
		buildResultRoot: options?.buildResultRoot,
	});
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	assertBuildSourceRevision(repositoryRoot, verified.receipt.sourceRevision);
	return stageVerifiedBuildResult(verified, repositoryRoot);
}

async function stageVerifiedBuildResult(verified, repositoryRoot) {
	assertBuildSourceRevision(repositoryRoot, verified.receipt.sourceRevision);
	const manifestPath = resolve(repositoryRoot, MANIFEST_PATH);
	const originalBytes = await canonicalRegularFile(manifestPath, 'professional payload manifest');
	let manifest;
	try { manifest = JSON.parse(String(originalBytes)); }
	catch (error) { throw new Error('The professional payload manifest is not JSON.', { cause: error }); }
	const matches = manifest.targets?.filter(({ id }) => id === verified.receipt.target) ?? [];
	if (matches.length !== 1) throw new Error('The professional payload manifest has no exact build-result target.');
	const current = matches[0];
	const targetRelativeRoot = `${PREBUILT_ROOT}/${verified.receipt.target}`;
	const targetRoot = resolve(repositoryRoot, targetRelativeRoot);
	const buildResultDescriptor = {
		path: `${targetRelativeRoot}/${STAGED_BUILD_RESULT_RECEIPT_NAME}`,
		byteLength: verified.receiptBytes.byteLength,
		sha256: verified.receiptSha256,
	};
	if (current.status === 'built') {
		if (sameJson(current.buildResult, buildResultDescriptor)) {
			await verifyStagedBuildResultDirectory(targetRoot, verified);
			return deepFreeze({ status: 'already-staged', target: verified.receipt.target });
		}
		throw new Error('The professional native target is already staged from a different build result.');
	}
	if (current.status !== 'pending-external' || current.payload !== null
		|| current.osAudioCodec !== null || current.pluginPeer !== null
		|| current.deliveryFilesystem !== null || current.isolation !== null
		|| (current.buildResult !== undefined && current.buildResult !== null)) {
		throw new Error('Only one exact pending professional native target can be staged.');
	}
	await mkdir(dirname(targetRoot), { recursive: true, mode: 0o700 });
	let targetCreated = false;
	let manifestPublished = false;
	let temporaryManifest = null;
	try {
		await mkdir(targetRoot, { mode: 0o700 });
		targetCreated = true;
		for (const descriptor of buildResultDescriptors(verified.receipt)) {
			const relativePath = descriptor.path.slice('payload/'.length);
			const output = resolve(targetRoot, ...relativePath.split('/'));
			await mkdir(dirname(output), { recursive: true, mode: 0o700 });
			await copyFile(resolveBuildResultPath(verified.buildResultRoot, descriptor.path), output, 1);
			await chmod(output, executableBuildResultArtifact(verified.receipt, descriptor) ? 0o555 : 0o444);
		}
		await writeFile(resolve(targetRoot, STAGED_BUILD_RESULT_RECEIPT_NAME), verified.receiptBytes,
			{ flag: 'wx', mode: 0o444 });
		const stagedRow = stagedManifestRow(verified.receipt, targetRelativeRoot, buildResultDescriptor);
		const updated = structuredClone(manifest);
		updated.targets[updated.targets.findIndex(({ id }) => id === verified.receipt.target)] = stagedRow;
		const manifestBytes = canonicalJson(updated);
		const reopened = await canonicalRegularFile(manifestPath, 'professional payload manifest');
		if (!reopened.equals(originalBytes)) {
			throw new Error('The professional payload manifest changed while staging was prepared.');
		}
		temporaryManifest = `${manifestPath}.build-result-${process.pid}-${Date.now()}-${verified.receipt.target}`;
		await writeFile(temporaryManifest, manifestBytes, { flag: 'wx', mode: 0o644 });
		const handle = await open(temporaryManifest, 'r');
		try { await handle.sync(); } finally { await handle.close(); }
		assertBuildSourceRevision(repositoryRoot, verified.receipt.sourceRevision);
		await rename(temporaryManifest, manifestPath);
		temporaryManifest = null;
		manifestPublished = true;
		return deepFreeze({ status: 'staged', target: verified.receipt.target,
			manifestSha256: sha256(manifestBytes) });
	} finally {
		if (temporaryManifest !== null) await rm(temporaryManifest, { force: true });
		if (targetCreated && !manifestPublished) await rm(targetRoot, { recursive: true, force: true });
	}
}

function installedPaths(target, professionalRoot, isolationRoot) {
	const [profile, broker] = PROFILE_PATHS[target];
	return {
		payload: resolve(professionalRoot, 'soundscaper_professional.node'),
		pluginPeer: existingExecutable(professionalRoot, 'soundscaper_professional_peer', target),
		deliveryFilesystem: existingExecutable(professionalRoot, 'soundscaper_delivery_fs', target),
		launcher: existingExecutable(resolve(isolationRoot, 'bin'),
			'milestone5-native-isolation-launcher', target),
		sandboxProfile: resolve(isolationRoot, profile),
		brokerPolicy: resolve(isolationRoot, broker),
	};
}

function existingExecutable(root, name, target) {
	return resolve(root, `${name}${target.startsWith('win-') ? '.exe' : ''}`);
}

async function copyBuildResultFile(source, destination, buildResultRoot, mode) {
	const bytes = await canonicalRegularFile(source, `installed build-result input ${basename(source)}`);
	await writeFile(destination, bytes, { flag: 'wx', mode });
	return Object.freeze({
		path: portableRelative(buildResultRoot, destination),
		byteLength: bytes.byteLength,
		sha256: sha256(bytes),
		absolutePath: destination,
	});
}

async function copyRuntimeClosure(sourceRoot, destinationRoot, buildResultRoot) {
	const files = await regularFileInventory(sourceRoot);
	if (files.length > MAXIMUM_RUNTIME_FILES) {
		throw new RangeError('The professional runtime closure exceeds 128 files.');
	}
	const basenames = files.map((path) => basename(path).toLowerCase());
	if (new Set(basenames).size !== basenames.length) {
		throw new Error('The professional runtime closure contains duplicate library basenames.');
	}
	const copied = [];
	for (const relativePath of files) {
		const output = resolve(destinationRoot, ...relativePath.split('/'));
		await mkdir(dirname(output), { recursive: true, mode: 0o700 });
		copied.push(await copyBuildResultFile(resolve(sourceRoot, ...relativePath.split('/')),
			output, buildResultRoot, 0o444));
	}
	return Object.freeze(copied);
}

async function executeInstalledSelfTests({ target, copied, root, runSelfTest }) {
	const requests = [
		{
			id: 'm5f1-malformed-frame', command: resolveBuildResultPath(root, copied.pluginPeer.path),
			args: [], input: Buffer.from([0]), expectedStatus: 125,
		},
		{
			id: 'delivery-filesystem-protocol', command: process.execPath,
			args: [resolve(import.meta.dirname, '..', 'self-test-soundscaper-delivery-fs.mjs'),
				resolveBuildResultPath(root, copied.deliveryFilesystem.path), target],
			input: null, expectedStatus: 0,
		},
		{
			id: 'launcher-refusal', command: resolveBuildResultPath(root, copied.launcher.path),
			args: [], input: null, expectedStatus: 125,
		},
	];
	const receipts = [];
	for (const request of requests) {
		const result = await runSelfTest(Object.freeze({ ...request, args: Object.freeze(request.args) }));
		if (!result || result.status !== request.expectedStatus
			|| typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
			throw new Error(soundscaperProfessionalNativeProcessFailureMessage(
				`self-test ${request.id}`, result,
			));
		}
		const output = Buffer.from(`${result.stdout}\n${result.stderr}`);
		if (output.byteLength > MAXIMUM_SELF_TEST_OUTPUT_BYTES) {
			throw new RangeError(`Professional native self-test ${request.id} exceeded its output bound.`);
		}
		receipts.push(Object.freeze({
			id: request.id,
			status: 'passed',
			commandSha256: sha256(canonicalJson({ command: basename(request.command), args: request.args,
				expectedStatus: request.expectedStatus })),
			outputSha256: sha256(output),
		}));
	}
	return Object.freeze(receipts);
}

function runNativeSelfTest(request) {
	const result = spawnSync(request.command, request.args, {
		encoding: 'utf8',
		input: request.input,
		maxBuffer: MAXIMUM_SELF_TEST_OUTPUT_BYTES,
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function stagedManifestRow(receipt, targetRoot, buildResult) {
	const toolchain = verificationFor(receipt, 'toolchain');
	const sources = verificationFor(receipt, 'source-authentication');
	const staged = (descriptor) => ({
		path: `${targetRoot}/${descriptor.path.slice('payload/'.length)}`,
		byteLength: descriptor.byteLength,
		sha256: descriptor.sha256,
	});
	return {
		id: receipt.target,
		status: 'built',
		blockedBy: null,
		toolchainIdentity: toolchain.identity,
		sourceAuthentication: structuredClone(sources.authentication),
		buildResult,
		payload: staged(receipt.payload),
		osAudioCodec: receipt.osAudioCodec === null ? null : staged(receipt.osAudioCodec),
		pluginPeer: staged(receipt.pluginPeer),
		deliveryFilesystem: staged(receipt.deliveryFilesystem),
		isolation: {
			launcher: staged(receipt.isolation.launcher),
			sandboxProfile: staged(receipt.isolation.sandboxProfile),
			brokerPolicy: staged(receipt.isolation.brokerPolicy),
			entrypointPath: staged({ ...receipt.pluginPeer }).path,
			runtimeClosure: receipt.isolation.runtimeClosure.map(staged),
		},
	};
}

async function verifyStagedBuildResultDirectory(targetRoot, verified) {
	const receiptBytes = await canonicalRegularFile(
		resolve(targetRoot, STAGED_BUILD_RESULT_RECEIPT_NAME), 'staged build-result receipt',
	);
	if (!receiptBytes.equals(verified.receiptBytes)) {
		throw new Error('The staged professional build-result receipt changed.');
	}
	for (const descriptor of buildResultDescriptors(verified.receipt)) {
		const path = resolve(targetRoot, ...descriptor.path.slice('payload/'.length).split('/'));
		verifyDescriptor(await canonicalRegularFile(path, 'staged build-result artifact'), descriptor,
			'staged build-result artifact');
	}
}
