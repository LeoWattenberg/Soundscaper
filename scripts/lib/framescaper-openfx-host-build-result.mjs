/* SPDX-License-Identifier: AGPL-3.0-only */

/** Target-native OpenFX build-result assembly, verification, and package-checkout staging. */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
	assertFramescaperOpenFxBinaryArchitecture,
	validateFramescaperOpenFxBinaryArchitectureReceipt,
} from './framescaper-openfx-binary-architecture.mjs';
import {
	validateFramescaperOpenFxSelfTests,
	validateFramescaperOpenFxSourceEvidence,
	validateFramescaperOpenFxToolchainEvidence,
} from './framescaper-openfx-build-evidence.mjs';
import {
	FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST,
	FRAMESCAPER_OPENFX_SOURCE_MANIFEST,
	deriveFramescaperOpenFxPayloadManifest,
} from './framescaper-openfx-host-build.mjs';

export const FRAMESCAPER_OPENFX_BUILD_RESULT_RECEIPT = 'build-result.json';
export const FRAMESCAPER_OPENFX_STAGED_BUILD_RESULT = 'framescaper-openfx-host-build-result.json';

const PREBUILT_ROOT = 'native/framescaper-openfx-host/prebuilt';
const TARGETS = new Set(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const PROFILE_PATHS = Object.freeze({
	'linux-x64': ['profiles/linux-v1.json', 'profiles/linux-broker-v1.json'],
	'linux-arm64': ['profiles/linux-v1.json', 'profiles/linux-broker-v1.json'],
	'mac-arm64': ['profiles/macos-v1.sb', 'profiles/macos-broker-v1.json'],
	'win-x64': ['profiles/windows-v1.json', 'profiles/windows-broker-v1.json'],
	'win-arm64': ['profiles/windows-v1.json', 'profiles/windows-broker-v1.json'],
});
const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const MAXIMUM_FILE_BYTES = 512 * 1024 * 1024;

export async function createFramescaperOpenFxHostBuildResult(options) {
	const target = targetId(options?.target);
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	const hostInstallRoot = await canonicalDirectory(options?.hostInstallRoot, 'OpenFX install root');
	const isolationInstallRoot = await canonicalDirectory(
		options?.isolationInstallRoot, 'isolation install root',
	);
	const buildResultRoot = await absentPath(options?.buildResultRoot, 'build-result root');
	await canonicalDirectory(dirname(buildResultRoot), 'build-result parent');
	const sourceRevision = revision(options?.sourceRevision);
	const buildRecipeSha256 = digestValue(options?.buildRecipeSha256, 'build-recipe digest');
	const toolchain = validateFramescaperOpenFxToolchainEvidence(options?.toolchainReceipt, target);
	const sourceAuthentication = validateFramescaperOpenFxSourceEvidence(options?.sourceAuthentication);
	const selfTests = validateFramescaperOpenFxSelfTests(options?.selfTests);
	const sourceManifestBytes = await canonicalFile(resolve(
		repositoryRoot, FRAMESCAPER_OPENFX_SOURCE_MANIFEST,
	), 'OpenFX source manifest');
	const suffix = target.startsWith('win-') ? '.exe' : '';
	const [profile, broker] = PROFILE_PATHS[target];
	const inputs = {
		scanner: resolve(hostInstallRoot, 'bin', `framescaper-ofx-scanner${suffix}`),
		runtimeHost: resolve(hostInstallRoot, 'bin', `framescaper-ofx-runtime-host${suffix}`),
		launcher: resolve(isolationInstallRoot, 'bin', `milestone5-native-isolation-launcher${suffix}`),
		sandboxProfile: resolve(isolationInstallRoot, profile),
		brokerPolicy: resolve(isolationInstallRoot, broker),
	};
	const runtimeLibraryPaths = await runtimeInputs(options?.runtimeLibraryPaths, target);
	const temporary = await mkdtemp(resolve(dirname(buildResultRoot), '.framescaper-openfx-result-'));
	let published = false;
	try {
		const artifactPaths = expectedArtifactPaths(target, runtimeLibraryPaths.map((path) => basename(path)));
		const copied = {
			scanner: await copyArtifact(inputs.scanner, resolve(temporary, artifactPaths.scanner), temporary, 0o555),
			runtimeHost: await copyArtifact(inputs.runtimeHost,
				resolve(temporary, artifactPaths.runtimeHost), temporary, 0o555),
			launcher: await copyArtifact(inputs.launcher, resolve(temporary, artifactPaths.launcher), temporary, 0o555),
			sandboxProfile: await copyArtifact(inputs.sandboxProfile,
				resolve(temporary, artifactPaths.sandboxProfile), temporary, 0o444),
			brokerPolicy: await copyArtifact(inputs.brokerPolicy,
				resolve(temporary, artifactPaths.brokerPolicy), temporary, 0o444),
			runtimeLibraries: [],
		};
		for (const [index, path] of runtimeLibraryPaths.entries()) {
			copied.runtimeLibraries.push(await copyArtifact(path,
				resolve(temporary, artifactPaths.runtimeLibraries[index]), temporary, 0o444));
		}
		const nativeArtifacts = [
			[copied.scanner, 'openfx-host'], [copied.runtimeHost, 'openfx-host'],
			[copied.launcher, 'isolation-launcher'],
			...copied.runtimeLibraries.map((artifact) => [artifact, 'runtime-library']),
		];
		const architectures = [];
		for (const [artifact, role] of nativeArtifacts) architectures.push({
			path: artifact.path,
			architecture: assertFramescaperOpenFxBinaryArchitecture(
				await readFile(resolve(temporary, ...artifact.path.split('/'))), target, role,
			),
		});
		const receipt = deepFreeze({
			schemaVersion: 1,
			kind: 'framescaper-openfx-host-build-result',
			target,
			sourceRevision,
			sourceManifestSha256: sha256(sourceManifestBytes),
			buildRecipeSha256,
			toolchain,
			sourceAuthentication,
			selfTests,
			architectures,
			artifacts: copied,
		});
		await writeFile(resolve(temporary, FRAMESCAPER_OPENFX_BUILD_RESULT_RECEIPT),
			canonicalJson(receipt), { flag: 'wx', mode: 0o444 });
		const verified = await verifyFramescaperOpenFxHostBuildResult({ buildResultRoot: temporary });
		await rename(temporary, buildResultRoot);
		published = true;
		return deepFreeze({ ...verified, buildResultRoot });
	} finally {
		if (!published) await rm(temporary, { recursive: true, force: true });
	}
}

export async function verifyFramescaperOpenFxHostBuildResult(options) {
	const buildResultRoot = await canonicalDirectory(options?.buildResultRoot, 'build-result root');
	const inventory = await regularFileInventory(buildResultRoot);
	const receiptBytes = await canonicalFile(resolve(
		buildResultRoot, FRAMESCAPER_OPENFX_BUILD_RESULT_RECEIPT,
	), 'OpenFX build-result receipt');
	const receipt = parseJson(receiptBytes, 'OpenFX build-result receipt');
	validateReceipt(receipt);
	const descriptors = artifactDescriptors(receipt);
	const expectedInventory = [FRAMESCAPER_OPENFX_BUILD_RESULT_RECEIPT,
		...descriptors.map(({ path }) => path)].sort(compare);
	if (JSON.stringify(inventory) !== JSON.stringify(expectedInventory)) {
		throw new Error('The OpenFX build-result file inventory is not exact.');
	}
	for (const descriptor of descriptors) {
		const bytes = await canonicalFile(resolve(buildResultRoot, ...descriptor.path.split('/')),
			`OpenFX build-result artifact ${descriptor.path}`);
		verifyDescriptor(bytes, descriptor, descriptor.path);
	}
	for (const [index, entry] of receipt.architectures.entries()) {
		const descriptor = descriptors.find(({ path }) => path === entry.path);
		if (!descriptor) throw new TypeError('An OpenFX architecture receipt names no artifact.');
		const bytes = await canonicalFile(resolve(buildResultRoot, ...entry.path.split('/')),
			`OpenFX architecture artifact ${entry.path}`);
		const actual = assertFramescaperOpenFxBinaryArchitecture(
			bytes, receipt.target, architectureRole(index),
		);
		if (JSON.stringify(actual) !== JSON.stringify(entry.architecture)) {
			throw new Error(`The OpenFX architecture receipt drifted for ${entry.path}.`);
		}
	}
	return deepFreeze({
		buildResultRoot, receipt, receiptBytes,
		receiptSha256: sha256(receiptBytes),
	});
}

export async function stageFramescaperOpenFxHostBuildResult(options, dependencies = {}) {
	const verified = await verifyFramescaperOpenFxHostBuildResult({
		buildResultRoot: options?.buildResultRoot,
	});
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	const resolveRevision = dependencies.resolveRevision ?? gitRevision;
	if (await resolveRevision(repositoryRoot) !== verified.receipt.sourceRevision) {
		throw new Error('The OpenFX build result does not belong to this checkout revision.');
	}
	const sourcePath = resolve(repositoryRoot, FRAMESCAPER_OPENFX_SOURCE_MANIFEST);
	const configPath = resolve(repositoryRoot, FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST);
	const sourceBytes = await canonicalFile(sourcePath, 'OpenFX source manifest');
	const configBytes = await canonicalFile(configPath, 'OpenFX payload manifest');
	if (sha256(sourceBytes) !== verified.receipt.sourceManifestSha256) {
		throw new Error('The OpenFX source manifest changed after the target build.');
	}
	const source = parseJson(sourceBytes, 'OpenFX source manifest');
	const current = source.targets?.[verified.receipt.target];
	if (!current || current.status !== 'ci-generated' || current.buildResult !== null
		|| current.scannerPayload !== null || current.runtimeHostPayload !== null
		|| current.isolationPayload !== null || current.toolchainIdentity !== null) {
		throw new Error('Only one exact ci-generated OpenFX target can be staged.');
	}
	const targetRelativeRoot = `${PREBUILT_ROOT}/${verified.receipt.target}`;
	const targetRoot = await absentPath(resolve(repositoryRoot, targetRelativeRoot), 'OpenFX staged target root');
	await mkdir(dirname(targetRoot), { recursive: true, mode: 0o700 });
	let targetCreated = false;
	let sourceTemporary = null;
	let configTemporary = null;
	let configPublished = false;
	let sourcePublished = false;
	let published = false;
	try {
		await mkdir(targetRoot, { mode: 0o700 });
		targetCreated = true;
		for (const descriptor of artifactDescriptors(verified.receipt)) {
			const relativePath = descriptor.path.slice('payload/'.length);
			const destination = resolve(targetRoot, ...relativePath.split('/'));
			await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
			await copyFile(resolve(verified.buildResultRoot, ...descriptor.path.split('/')), destination, 1);
			await chmod(destination, executableArtifact(verified.receipt, descriptor) ? 0o555 : 0o444);
		}
		const stagedReceiptPath = resolve(targetRoot, FRAMESCAPER_OPENFX_STAGED_BUILD_RESULT);
		await writeFile(stagedReceiptPath, verified.receiptBytes, { flag: 'wx', mode: 0o444 });
		const staged = (descriptor) => ({
			path: `${targetRelativeRoot}/${descriptor.path.slice('payload/'.length)}`,
			byteLength: descriptor.byteLength,
			sha256: descriptor.sha256,
		});
		const updated = structuredClone(source);
		updated.targets[verified.receipt.target] = {
			runtime: current.runtime,
			status: 'built',
			blockedBy: null,
			toolchainIdentity: verified.receipt.toolchain.identitySha256,
			buildResult: {
				path: `${targetRelativeRoot}/${FRAMESCAPER_OPENFX_STAGED_BUILD_RESULT}`,
				byteLength: verified.receiptBytes.byteLength,
				sha256: verified.receiptSha256,
			},
			scannerPayload: staged(verified.receipt.artifacts.scanner),
			runtimeHostPayload: staged(verified.receipt.artifacts.runtimeHost),
			isolationPayload: {
				launcherPayload: staged(verified.receipt.artifacts.launcher),
				sandboxProfilePayload: staged(verified.receipt.artifacts.sandboxProfile),
				brokerPolicyPayload: staged(verified.receipt.artifacts.brokerPolicy),
				runtimeLibraryPayloads: verified.receipt.artifacts.runtimeLibraries.map(staged),
			},
		};
		const updatedSourceBytes = canonicalJson(updated);
		const updatedConfigBytes = canonicalJson(deriveFramescaperOpenFxPayloadManifest(updated));
		sourceTemporary = `${sourcePath}.openfx-result-${process.pid}`;
		configTemporary = `${configPath}.openfx-result-${process.pid}`;
		await writeFile(sourceTemporary, updatedSourceBytes, { flag: 'wx', mode: 0o644 });
		await writeFile(configTemporary, updatedConfigBytes, { flag: 'wx', mode: 0o644 });
		if (!(await canonicalFile(sourcePath, 'OpenFX source manifest')).equals(sourceBytes)
			|| await resolveRevision(repositoryRoot) !== verified.receipt.sourceRevision) {
			throw new Error('The checkout changed while the OpenFX build result was staged.');
		}
		await rename(configTemporary, configPath);
		configTemporary = null;
		configPublished = true;
		await rename(sourceTemporary, sourcePath);
		sourceTemporary = null;
		sourcePublished = true;
		published = true;
		return deepFreeze({ status: 'staged', target: verified.receipt.target,
			manifestSha256: sha256(updatedConfigBytes) });
	} finally {
		if (sourceTemporary !== null) await rm(sourceTemporary, { force: true });
		if (configTemporary !== null) await rm(configTemporary, { force: true });
		if (!published && sourcePublished) await restoreFile(sourcePath, sourceBytes);
		if (!published && configPublished) await restoreFile(configPath, configBytes);
		if (targetCreated && !published) await rm(targetRoot, { recursive: true, force: true });
	}
}

async function restoreFile(path, bytes) {
	const temporary = `${path}.restore-${process.pid}-${Date.now()}`;
	await writeFile(temporary, bytes, { flag: 'wx', mode: 0o644 });
	await rename(temporary, path);
}

function validateReceipt(value) {
	closedRecord(value, ['schemaVersion', 'kind', 'target', 'sourceRevision',
		'sourceManifestSha256', 'buildRecipeSha256', 'toolchain', 'sourceAuthentication',
		'selfTests', 'architectures', 'artifacts'], 'OpenFX build-result receipt');
	const target = targetId(value.target);
	if (value.schemaVersion !== 1 || value.kind !== 'framescaper-openfx-host-build-result'
		|| !REVISION.test(String(value.sourceRevision))
		|| !SHA256.test(String(value.sourceManifestSha256))
		|| !SHA256.test(String(value.buildRecipeSha256))) {
		throw new TypeError('The OpenFX build-result identity is invalid.');
	}
	validateFramescaperOpenFxToolchainEvidence(value.toolchain, target);
	validateFramescaperOpenFxSourceEvidence(value.sourceAuthentication);
	validateFramescaperOpenFxSelfTests(value.selfTests);
	const names = value.artifacts?.runtimeLibraries?.map(({ path }) => basename(String(path))) ?? [];
	const paths = expectedArtifactPaths(target, names);
	closedRecord(value.artifacts, ['scanner', 'runtimeHost', 'launcher', 'sandboxProfile',
		'brokerPolicy', 'runtimeLibraries'], 'OpenFX build-result artifacts');
	for (const field of ['scanner', 'runtimeHost', 'launcher', 'sandboxProfile', 'brokerPolicy']) {
		artifactDescriptor(value.artifacts[field], paths[field]);
	}
	if (!Array.isArray(value.artifacts.runtimeLibraries)
		|| value.artifacts.runtimeLibraries.length !== paths.runtimeLibraries.length) {
		throw new TypeError('The OpenFX runtime-library result is invalid.');
	}
	value.artifacts.runtimeLibraries.forEach((descriptor, index) => (
		artifactDescriptor(descriptor, paths.runtimeLibraries[index])
	));
	if (!Array.isArray(value.architectures)
		|| value.architectures.length !== 3 + value.artifacts.runtimeLibraries.length) {
		throw new TypeError('The OpenFX build-result architecture inventory is incomplete.');
	}
	const nativePaths = [paths.scanner, paths.runtimeHost, paths.launcher, ...paths.runtimeLibraries];
	for (const [index, entry] of value.architectures.entries()) {
		closedRecord(entry, ['path', 'architecture'], 'OpenFX architecture result');
		if (entry.path !== nativePaths[index]) throw new TypeError('OpenFX architecture order drifted.');
		validateFramescaperOpenFxBinaryArchitectureReceipt(
			entry.architecture, target, architectureRole(index),
		);
	}
	return value;
}

function expectedArtifactPaths(target, runtimeNames) {
	const suffix = target.startsWith('win-') ? '.exe' : '';
	if (!Array.isArray(runtimeNames) || runtimeNames.length > 32
		|| runtimeNames.some((name, index) => !/^[A-Za-z0-9._+-]+$/u.test(name)
			|| (index > 0 && runtimeNames[index - 1] >= name))) {
		throw new TypeError('The OpenFX runtime-library names must be uniquely sorted.');
	}
	const loader = target === 'linux-x64' ? 'ld-linux-x86-64.so.2'
		: target === 'linux-arm64' ? 'ld-linux-aarch64.so.1' : null;
	if ((loader === null && runtimeNames.length !== 0)
		|| (loader !== null && JSON.stringify(runtimeNames) !== JSON.stringify([loader]))) {
		throw new TypeError('The OpenFX target has the wrong runtime-library closure.');
	}
	return {
		scanner: `payload/bin/framescaper-ofx-scanner${suffix}`,
		runtimeHost: `payload/bin/framescaper-ofx-runtime-host${suffix}`,
		launcher: `payload/isolation/milestone5-native-isolation-launcher${suffix}`,
		sandboxProfile: 'payload/isolation/milestone5-native-isolation-profile.json',
		brokerPolicy: 'payload/isolation/milestone5-native-isolation-broker.json',
		runtimeLibraries: runtimeNames.map((name) => `payload/lib/${name}`),
	};
}

async function runtimeInputs(value, target) {
	if (!Array.isArray(value)) throw new TypeError('OpenFX runtime-library paths must be an array.');
	const paths = [];
	for (const path of value) paths.push((await canonicalPath(path, 'runtime library')));
	paths.sort((left, right) => compare(basename(left), basename(right)));
	expectedArtifactPaths(target, paths.map((path) => basename(path)));
	return paths;
}

async function copyArtifact(sourceValue, destination, root, mode) {
	const source = await canonicalPath(sourceValue, 'installed OpenFX artifact');
	const bytes = await canonicalFile(source, `installed OpenFX artifact ${basename(source)}`);
	await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	await writeFile(destination, bytes, { flag: 'wx', mode });
	return Object.freeze({
		path: portableRelative(root, destination), byteLength: bytes.byteLength, sha256: sha256(bytes),
	});
}

function artifactDescriptors(receipt) {
	return [receipt.artifacts.scanner, receipt.artifacts.runtimeHost, receipt.artifacts.launcher,
		receipt.artifacts.sandboxProfile, receipt.artifacts.brokerPolicy,
		...receipt.artifacts.runtimeLibraries];
}

function executableArtifact(receipt, descriptor) {
	return [receipt.artifacts.scanner.path, receipt.artifacts.runtimeHost.path,
		receipt.artifacts.launcher.path].includes(descriptor.path);
}

function architectureRole(index) {
	return index < 2 ? 'openfx-host' : index === 2 ? 'isolation-launcher' : 'runtime-library';
}

function artifactDescriptor(value, expectedPath) {
	closedRecord(value, ['path', 'byteLength', 'sha256'], 'OpenFX artifact descriptor');
	if (value.path !== expectedPath || !Number.isSafeInteger(value.byteLength)
		|| value.byteLength < 1 || value.byteLength > MAXIMUM_FILE_BYTES
		|| !SHA256.test(String(value.sha256))) {
		throw new TypeError('An OpenFX build-result artifact descriptor is invalid.');
	}
	return value;
}

async function regularFileInventory(root) {
	const output = [];
	await visit(root, '');
	return output.sort(compare);
	async function visit(directory, prefix) {
		const { readdir } = await import('node:fs/promises');
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isSymbolicLink()) throw new Error(`The OpenFX build result contains symbolic path ${path}.`);
			if (entry.isDirectory()) await visit(resolve(directory, entry.name), path);
			else if (entry.isFile()) output.push(path);
			else throw new Error(`The OpenFX build result contains irregular path ${path}.`);
		}
	}
}

async function gitRevision(repositoryRoot) {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], {
		cwd: repositoryRoot, encoding: 'utf8', shell: false,
	});
	if (result.status !== 0) throw new Error('The checkout revision could not be resolved.');
	return revision(result.stdout.trim());
}

async function canonicalDirectory(value, label) {
	const path = absolutePath(value, label);
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error(`The ${label} is not one canonical directory.`);
	}
	return path;
}

async function canonicalPath(value, label) {
	const path = absolutePath(value, label);
	if (await realpath(path) !== path) {
		const resolved = await realpath(path);
		const metadata = await lstat(resolved);
		if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`The ${label} is invalid.`);
		return resolved;
	}
	return path;
}

async function canonicalFile(path, label) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path
		|| metadata.size < 1 || metadata.size > MAXIMUM_FILE_BYTES) {
		throw new Error(`The ${label} is not one bounded canonical file.`);
	}
	const bytes = await readFile(path);
	if (bytes.byteLength !== metadata.size) throw new Error(`The ${label} changed while reading.`);
	return bytes;
}

async function absentPath(value, label) {
	const path = absolutePath(value, label);
	try { await lstat(path); }
	catch (error) {
		if (error?.code === 'ENOENT') return path;
		throw error;
	}
	throw new Error(`The ${label} already exists.`);
}

function portableRelative(root, path) {
	const value = relative(root, path);
	if (value === '' || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) {
		throw new Error('An OpenFX build-result artifact escaped its root.');
	}
	return value.replaceAll('\\', '/');
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be absolute and normalized.`);
	return value;
}

function verifyDescriptor(bytes, descriptor, label) {
	if (bytes.byteLength !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256) {
		throw new Error(`The OpenFX build-result artifact ${label} changed.`);
	}
}

function targetId(value) {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The OpenFX build-result target is unsupported.');
	}
	return value;
}

function revision(value) {
	if (typeof value !== 'string' || !REVISION.test(value)) {
		throw new TypeError('The OpenFX build-result source revision is invalid.');
	}
	return value;
}

function digestValue(value, label) {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`The ${label} has missing or unsupported fields.`);
	}
	return value;
}

function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`The ${label} is not JSON.`, { cause: error }); }
}

function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function compare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	if (ArrayBuffer.isView(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
