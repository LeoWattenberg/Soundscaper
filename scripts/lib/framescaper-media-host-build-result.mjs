/* SPDX-License-Identifier: AGPL-3.0-only */

/** Verified target-native media-host build results and checkout staging. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
	validateSoundscaperProfessionalNativeDependencyClosure,
	inspectSoundscaperProfessionalNativeDependencies,
} from './soundscaper-professional-native-dependency-inspection.mjs';
import {
	FRAMESCAPER_MEDIA_HOST_TARGETS,
} from './framescaper-media-host-build.mjs';

export const FRAMESCAPER_MEDIA_HOST_BUILD_RESULT_RECEIPT = 'build-result.json';
export const FRAMESCAPER_MEDIA_HOST_STAGED_BUILD_RESULT_RECEIPT =
	'framescaper-media-host-build-result.json';

const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const MAXIMUM_FILE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_RUNTIME_FILES = 32;
const PROFILE_PATHS = Object.freeze({
	'linux-x64': Object.freeze(['profiles/linux-v1.json', 'profiles/linux-broker-v1.json']),
	'linux-arm64': Object.freeze(['profiles/linux-v1.json', 'profiles/linux-broker-v1.json']),
	'mac-arm64': Object.freeze(['profiles/macos-v1.sb', 'profiles/macos-broker-v1.json']),
	'win-x64': Object.freeze(['profiles/windows-v1.json', 'profiles/windows-broker-v1.json']),
	'win-arm64': Object.freeze(['profiles/windows-v1.json', 'profiles/windows-broker-v1.json']),
});
export const FRAMESCAPER_MEDIA_HOST_SOURCE_IDENTITY = deepFreeze({
	ffmpeg: Object.freeze({
		version: '9.0.1',
		url: 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',
		archiveByteLength: 12_036_420,
		archiveSha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
		extractedTreeSha256: 'dc709cc7d80424f45aab44ac94e59f7c8669fe18b877e9e5f1319006bfa622b4',
		license: 'GPL-2.0-or-later',
	}),
	boost: Object.freeze({
		version: '1.92.0',
		url: 'https://archives.boost.io/release/1.92.0/source/boost_1_92_0.tar.bz2',
		archiveByteLength: 199_030_664,
		archiveSha256: '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c',
		headerClosureSha256: 'a2f5894e12bc386b7db96936aba5f5bef3910e52da634c7630c73f1fa63e913d',
		license: 'BSL-1.0',
	}),
	x264: externalIdentity('stable-b35605ac', 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55',
		'https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz',
		1_040_327, 'cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9',
		'076152c7f1d5923ec47da253de0d13e9881c3818dc53b4c1dfb0ea8505e0c4ad',
		'GPL-2.0-or-later'),
	x265: externalIdentity('4.2', 'e444744c03978c1fb4e037168967020cf2648427',
		'https://bitbucket.org/multicoreware/x265_git/downloads/x265_4.2.tar.gz',
		1_833_442, '40b1ea0453e0309f0eba934e0ddf533f8f6295966679e8894e8f1c1c8d5e1210',
		'fd3b109e8d617713fba18dfcbbef8c9a5135ee4dfc7321dba2b71f3b444809bb',
		'GPL-2.0-or-later'),
	libvpx: externalIdentity('1.16.0', '1024874c5919305883187e2953de8fcb4c3d7fa6',
		'https://github.com/webmproject/libvpx/archive/refs/tags/v1.16.0.tar.gz',
		5_635_379, '7a479a3c66b9f5d5542a4c6a1b7d3768a983b1e5c14c60a9396edc9b649e015c',
		'459375253b653cc26d057e102b134fb4ac3664a8eab5a01de87176d950a92594',
		'BSD-3-Clause'),
	libopus: externalIdentity('1.6', 'a8b13e40d751c7b40833b94fc9437c5c3439da89',
		'https://downloads.xiph.org/releases/opus/opus-1.6.tar.gz',
		36_317_446, 'b7637334527201fdfd6dd6a02e67aceffb0e5e60155bbd89175647a80301c92c',
		'9c0e596e8baa8281d7728c8d27d3ae98624de30254bf9767f07b4d76a1a9869a',
		'BSD-3-Clause'),
	zlib: externalIdentity('1.3.1', '51b7f2abdade71cd9bb0e7a373ef2610ec6f9daf',
		'https://zlib.net/fossils/zlib-1.3.1.tar.gz',
		1_512_791, '9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23',
		'85dd44f5108708f967d0d5aba1205eb54c20347a4b8417c4d1b87921822acae9',
		'Zlib'),
});

export function framescaperMediaHostBuildResultArtifactPaths(targetValue) {
	const target = targetId(targetValue);
	const suffix = target.startsWith('win-') ? '.exe' : '';
	return Object.freeze({
		payload: `payload/framescaper-media-host${suffix}`,
		launcher: `payload/milestone5-native-isolation-launcher${suffix}`,
		profile: 'payload/native-isolation-profile-v1.json',
		broker: 'payload/native-isolation-broker-v1.json',
	});
}

export async function createFramescaperMediaHostBuildResult(options) {
	const target = targetId(options?.target);
	const buildResultRoot = absentAbsolutePath(options?.buildResultRoot, 'build-result root');
	await canonicalDirectory(dirname(buildResultRoot), 'build-result parent');
	const hostInstallRoot = await canonicalDirectory(options?.hostInstallRoot, 'host install root');
	const isolationInstallRoot = await canonicalDirectory(
		options?.isolationInstallRoot, 'isolation install root',
	);
	const runtimeRoot = options?.runtimeRoot === null || options?.runtimeRoot === undefined
		? null : await canonicalDirectory(options.runtimeRoot, 'runtime root');
	const sourceRevision = revision(options?.sourceRevision);
	const sourceManifestSha256 = digestValue(
		options?.sourceManifestSha256, 'source-manifest SHA-256',
	);
	const buildRecipeSha256 = digestValue(options?.buildRecipeSha256, 'build-recipe SHA-256');
	const toolchainIdentity = digestValue(options?.toolchainIdentity, 'toolchain identity');
	const thirdPartyNotices = noticeText(options?.thirdPartyNotices);
	const buildTests = validateBuildTests(options?.buildTests);
	const inspectDependencies = options?.inspectDependencies
		?? inspectSoundscaperProfessionalNativeDependencies;
	const runSelfTest = options?.runSelfTest ?? runProcess;
	if (typeof inspectDependencies !== 'function' || typeof runSelfTest !== 'function') {
		throw new TypeError('Media-host build-result verification ports must be callable.');
	}

	const temporary = await mkdtemp(resolve(dirname(buildResultRoot), '.framescaper-media-result-'));
	let published = false;
	try {
		const paths = framescaperMediaHostBuildResultArtifactPaths(target);
		await mkdir(resolve(temporary, 'payload'), { mode: 0o700 });
		const [profilePath, brokerPath] = PROFILE_PATHS[target];
		const copied = {
			payload: await copyArtifact(
				resolve(hostInstallRoot, 'bin', basename(paths.payload)),
				resolveResultPath(temporary, paths.payload), temporary, 0o755,
			),
			launcher: await copyArtifact(
				resolve(isolationInstallRoot, 'bin', basename(paths.launcher)),
				resolveResultPath(temporary, paths.launcher), temporary, 0o755,
			),
			profile: await copyArtifact(
				resolve(isolationInstallRoot, profilePath),
				resolveResultPath(temporary, paths.profile), temporary, 0o444,
			),
			broker: await copyArtifact(
				resolve(isolationInstallRoot, brokerPath),
				resolveResultPath(temporary, paths.broker), temporary, 0o444,
			),
		};
		const runtimeLibraries = runtimeRoot === null
			? [] : await copyRuntimeClosure(runtimeRoot, resolve(temporary, 'payload/runtime'), temporary);
		const dependencyInspections = await validateSoundscaperProfessionalNativeDependencyClosure({
			target,
			artifacts: [copied.payload, copied.launcher, ...runtimeLibraries],
			runtimeArtifacts: runtimeLibraries,
			root: temporary,
			inspectDependencies,
		});
		const installedTests = await runInstalledTests({ target, copied, runSelfTest });
		const receipt = deepFreeze({
			schemaVersion: 1,
			kind: 'framescaper-media-host-build-result',
			target,
			runtime: runtimeForTarget(target),
			sourceRevision,
			sourceManifestSha256,
			buildRecipeSha256,
			toolchainIdentity,
			sourceIdentity: structuredClone(FRAMESCAPER_MEDIA_HOST_SOURCE_IDENTITY),
			compliance: {
				thirdPartyNotices,
				thirdPartyNoticesSha256: sha256(Buffer.from(thirdPartyNotices)),
				correspondingSource: {
					repositoryUrl: 'https://github.com/LeoWattenberg/Soundscaper',
					sourceRevision,
					sourceIdentitySha256: sha256(canonicalJson(
						FRAMESCAPER_MEDIA_HOST_SOURCE_IDENTITY,
					)),
				},
			},
			tests: [...buildTests, ...installedTests],
			dependencyInspections,
			payload: descriptorOnly(copied.payload),
			isolation: {
				launcher: descriptorOnly(copied.launcher),
				profile: descriptorOnly(copied.profile),
				broker: descriptorOnly(copied.broker),
				runtimeLibraries: runtimeLibraries.map(descriptorOnly),
			},
		});
		await writeFile(resolve(temporary, FRAMESCAPER_MEDIA_HOST_BUILD_RESULT_RECEIPT),
			canonicalJson(receipt), { flag: 'wx', mode: 0o444 });
		await verifyFramescaperMediaHostBuildResult({ buildResultRoot: temporary });
		await rename(temporary, buildResultRoot);
		published = true;
		return deepFreeze({ buildResultRoot, receipt });
	} finally {
		if (!published) await rm(temporary, { recursive: true, force: true });
	}
}

export async function verifyFramescaperMediaHostBuildResult({ buildResultRoot: rootValue }) {
	const buildResultRoot = await canonicalDirectory(rootValue, 'build-result root');
	const receiptBytes = await canonicalFile(
		resolve(buildResultRoot, FRAMESCAPER_MEDIA_HOST_BUILD_RESULT_RECEIPT),
		'media-host build-result receipt',
	);
	let receipt;
	try { receipt = JSON.parse(String(receiptBytes)); }
	catch (error) { throw new Error('The media-host build-result receipt is not JSON.', { cause: error }); }
	if (!receiptBytes.equals(canonicalJson(receipt))) {
		throw new TypeError('The media-host build-result receipt is not canonical JSON.');
	}
	validateReceipt(receipt);
	for (const descriptor of resultDescriptors(receipt)) {
		const bytes = await canonicalFile(
			resolveResultPath(buildResultRoot, descriptor.path),
			`media-host build-result artifact ${descriptor.path}`,
		);
		verifyDescriptor(bytes, descriptor, descriptor.path);
	}
	const actual = await fileInventory(buildResultRoot);
	const expected = [FRAMESCAPER_MEDIA_HOST_BUILD_RESULT_RECEIPT,
		...resultDescriptors(receipt).map(({ path }) => path)].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error('The media-host build-result file inventory is not closed.');
	}
	return deepFreeze({
		buildResultRoot, receipt, receiptBytes,
		receiptSha256: sha256(receiptBytes),
	});
}

function validateReceipt(value) {
	closedRecord(value, [
		'schemaVersion', 'kind', 'target', 'runtime', 'sourceRevision',
		'sourceManifestSha256', 'buildRecipeSha256', 'toolchainIdentity', 'sourceIdentity',
		'compliance',
		'tests', 'dependencyInspections', 'payload', 'isolation',
	], 'media-host build-result receipt');
	const target = targetId(value.target);
	if (value.schemaVersion !== 1 || value.kind !== 'framescaper-media-host-build-result'
		|| value.runtime !== runtimeForTarget(target) || !REVISION.test(String(value.sourceRevision))) {
		throw new TypeError('The media-host build-result identity is invalid.');
	}
	for (const field of ['sourceManifestSha256', 'buildRecipeSha256', 'toolchainIdentity']) {
		digestValue(value[field], field);
	}
	if (JSON.stringify(value.sourceIdentity)
		!== JSON.stringify(FRAMESCAPER_MEDIA_HOST_SOURCE_IDENTITY)) {
		throw new TypeError('The media-host build-result source identity is invalid.');
	}
	validateCompliance(value.compliance, value.sourceRevision);
	validateTests(value.tests);
	if (!Array.isArray(value.dependencyInspections)
		|| value.dependencyInspections.length !== 2 + value.isolation?.runtimeLibraries?.length) {
		throw new TypeError('The media-host dependency-inspection receipt is incomplete.');
	}
	for (const inspection of value.dependencyInspections) {
		closedRecord(inspection, ['artifactPath', 'architecture', 'imports', 'rpaths'],
			'media-host dependency inspection');
		if (!Array.isArray(inspection.imports) || !Array.isArray(inspection.rpaths)
			|| inspection.architecture?.target !== target) {
			throw new TypeError('A media-host dependency inspection is invalid.');
		}
	}
	const paths = framescaperMediaHostBuildResultArtifactPaths(target);
	artifact(value.payload, paths.payload);
	closedRecord(value.isolation, ['launcher', 'profile', 'broker', 'runtimeLibraries'],
		'media-host build-result isolation');
	artifact(value.isolation.launcher, paths.launcher);
	artifact(value.isolation.profile, paths.profile);
	artifact(value.isolation.broker, paths.broker);
	if (!Array.isArray(value.isolation.runtimeLibraries)
		|| value.isolation.runtimeLibraries.length > MAXIMUM_RUNTIME_FILES) {
		throw new TypeError('The media-host runtime closure is invalid.');
	}
	for (const entry of value.isolation.runtimeLibraries) artifact(entry);
	const runtimePaths = value.isolation.runtimeLibraries.map(({ path }) => path);
	if (runtimePaths.some((path) => !path.startsWith('payload/runtime/'))
		|| new Set(runtimePaths).size !== runtimePaths.length
		|| JSON.stringify(runtimePaths) !== JSON.stringify([...runtimePaths].sort())) {
		throw new TypeError('The media-host runtime closure is not canonical.');
	}
	return value;
}

function validateBuildTests(value) {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new TypeError('The media-host build must report its CTest result.');
	}
	validateTest(value[0], 'framescaper-media-host-ctest');
	return deepFreeze(structuredClone(value));
}

function validateTests(value) {
	if (!Array.isArray(value) || value.length !== 4) {
		throw new TypeError('The media-host build-result test inventory is incomplete.');
	}
	for (const [index, id] of [
		'framescaper-media-host-ctest', 'framescaper-media-host-self-test',
		'framescaper-media-host-capabilities', 'isolation-launcher-refusal',
	].entries()) validateTest(value[index], id);
}

function validateTest(value, id) {
	closedRecord(value, ['id', 'status', 'commandSha256', 'outputSha256'], 'media-host test receipt');
	if (value.id !== id || value.status !== 'passed'
		|| !SHA256.test(String(value.commandSha256)) || !SHA256.test(String(value.outputSha256))) {
		throw new TypeError(`The media-host ${id} receipt is invalid.`);
	}
}

async function runInstalledTests({ target, copied, runSelfTest }) {
	const requests = [
		{ id: 'framescaper-media-host-self-test', command: copied.payload.absolutePath,
			args: ['--self-test'], status: 0, expect: /"professionalComponentSetPresent":true/u },
		{ id: 'framescaper-media-host-capabilities', command: copied.payload.absolutePath,
			args: ['--capabilities'], status: 0, expect: /"rawFfmpegArguments":false/u },
		{ id: 'isolation-launcher-refusal', command: copied.launcher.absolutePath,
			args: [], status: 125, expect: null },
	];
	const receipts = [];
	for (const request of requests) {
		const result = await runSelfTest({ target, ...request });
		if (!result || result.status !== request.status || !Buffer.isBuffer(result.output)
			|| result.output.byteLength > MAXIMUM_OUTPUT_BYTES
			|| (request.expect !== null && !request.expect.test(String(result.output)))) {
			throw new Error(`Installed media-host test ${request.id} failed.`);
		}
		receipts.push(testReceipt(request, result.output));
	}
	return receipts;
}

function runProcess(request) {
	const result = spawnSync(request.command, request.args, {
		encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_OUTPUT_BYTES,
		env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
	});
	return {
		status: result.status,
		output: Buffer.from(`${result.stdout ?? ''}\n${result.stderr ?? ''}`),
	};
}

export function framescaperMediaHostTestReceipt(id, command, args, output = Buffer.alloc(0)) {
	return testReceipt({ id, command, args }, output);
}

function testReceipt(request, output) {
	return Object.freeze({
		id: request.id,
		status: 'passed',
		commandSha256: sha256(canonicalJson({ command: request.command, args: request.args })),
		outputSha256: sha256(output),
	});
}

async function copyRuntimeClosure(root, outputRoot, buildResultRoot) {
	const inventory = await fileInventory(root);
	if (inventory.length > MAXIMUM_RUNTIME_FILES) {
		throw new RangeError('The media-host runtime closure exceeds 32 files.');
	}
	const names = inventory.map((path) => basename(path).toLowerCase());
	if (new Set(names).size !== names.length) {
		throw new Error('The media-host runtime closure has duplicate library basenames.');
	}
	const copied = [];
	for (const path of inventory) {
		const output = resolve(outputRoot, ...path.split('/'));
		await mkdir(dirname(output), { recursive: true, mode: 0o700 });
		copied.push(await copyArtifact(resolve(root, ...path.split('/')), output, buildResultRoot, 0o444));
	}
	return copied;
}

async function copyArtifact(source, destination, root, mode) {
	const bytes = await canonicalFile(source, `installed artifact ${basename(source)}`);
	await writeFile(destination, bytes, { flag: 'wx', mode });
	return Object.freeze({
		...descriptor(portableRelative(root, destination), bytes), absolutePath: destination,
	});
}

function resultDescriptors(receipt) {
	return [receipt.payload, receipt.isolation.launcher, receipt.isolation.profile,
		receipt.isolation.broker, ...receipt.isolation.runtimeLibraries];
}

function artifact(value, exactPath = null) {
	closedRecord(value, ['path', 'byteLength', 'sha256'], 'media-host build-result artifact');
	if (!safeRelative(value.path) || (exactPath !== null && value.path !== exactPath)
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| value.byteLength > MAXIMUM_FILE_BYTES || !SHA256.test(String(value.sha256))) {
		throw new TypeError('A media-host build-result artifact is invalid.');
	}
}

async function canonicalFile(path, label) {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path
		|| before.size < 1 || before.size > MAXIMUM_FILE_BYTES) {
		throw new Error(`The ${label} is not one bounded canonical file.`);
	}
	const bytes = await readFile(path);
	const after = await lstat(path);
	if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) {
		throw new Error(`The ${label} changed while being read.`);
	}
	return bytes;
}

async function canonicalDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| await realpath(value) !== value) throw new TypeError(`The ${label} must be canonical.`);
	const metadata = await lstat(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new TypeError(`The ${label} must be one canonical directory.`);
	}
	return value;
}

async function fileInventory(root) {
	const files = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error('A media-host result cannot contain symlinks.');
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) files.push(portableRelative(root, path));
			else throw new Error('A media-host result cannot contain special files.');
		}
	}
	await visit(root);
	return files.sort();
}

function resolveResultPath(root, path) {
	if (!safeRelative(path)) throw new TypeError('A media-host result path is invalid.');
	const result = resolve(root, ...path.split('/'));
	if (result === root || !result.startsWith(`${root}${sep}`)) {
		throw new TypeError('A media-host result path escaped its root.');
	}
	return result;
}

function portableRelative(root, path) {
	const value = relative(root, path).split(sep).join('/');
	if (!safeRelative(value)) throw new TypeError('A media-host file escaped its root.');
	return value;
}

function safeRelative(value) {
	return typeof value === 'string' && value !== '' && !isAbsolute(value)
		&& !value.includes('\\') && !value.includes('\0')
		&& value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function descriptor(path, bytes) {
	return Object.freeze({ path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
}
function descriptorOnly(value) {
	return Object.freeze({ path: value.path, byteLength: value.byteLength, sha256: value.sha256 });
}
function verifyDescriptor(bytes, value, label) {
	if (bytes.byteLength !== value.byteLength || sha256(bytes) !== value.sha256) {
		throw new Error(`The ${label} failed exact digest authentication.`);
	}
}
function runtimeForTarget(target) {
	return FRAMESCAPER_MEDIA_HOST_TARGETS.find(({ id }) => id === target).runtime;
}
function targetId(value) {
	if (!FRAMESCAPER_MEDIA_HOST_TARGETS.some(({ id }) => id === value)) {
		throw new TypeError(`Unsupported media-host target ${String(value)}.`);
	}
	return value;
}
function revision(value) {
	if (typeof value !== 'string' || !REVISION.test(value)) {
		throw new TypeError('The media-host source revision is invalid.');
	}
	return value;
}
function digestValue(value, label) {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}
function noticeText(value) {
	if (typeof value !== 'string' || value.length < 100 || value.length > 64 * 1024
		|| value.includes('\0')
		|| !['FFmpeg', 'Boost', 'x264', 'x265', 'libvpx', 'Opus', 'zlib'].every(
			(name) => value.includes(name),
		)) throw new TypeError('The media-host third-party notices are incomplete.');
	return value;
}
function validateCompliance(value, sourceRevision) {
	closedRecord(value, [
		'thirdPartyNotices', 'thirdPartyNoticesSha256', 'correspondingSource',
	], 'media-host compliance receipt');
	const notices = noticeText(value.thirdPartyNotices);
	if (value.thirdPartyNoticesSha256 !== sha256(Buffer.from(notices))) {
		throw new TypeError('The media-host third-party notice digest is invalid.');
	}
	closedRecord(value.correspondingSource, [
		'repositoryUrl', 'sourceRevision', 'sourceIdentitySha256',
	], 'media-host corresponding-source receipt');
	if (value.correspondingSource.repositoryUrl
		!== 'https://github.com/LeoWattenberg/Soundscaper'
		|| value.correspondingSource.sourceRevision !== sourceRevision
		|| value.correspondingSource.sourceIdentitySha256
		!== sha256(canonicalJson(FRAMESCAPER_MEDIA_HOST_SOURCE_IDENTITY))) {
		throw new TypeError('The media-host corresponding-source receipt is invalid.');
	}
}
function externalIdentity(
	version, revision, url, archiveByteLength, archiveSha256, extractedTreeSha256, license,
) {
	return Object.freeze({
		version, revision, url, archiveByteLength, archiveSha256, extractedTreeSha256, license,
	});
}
function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`The ${label} must be one exact record.`);
	}
	return value;
}
function absentAbsolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be absolute and normalized.`);
	}
	return value;
}
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function deepFreeze(value) {
	if (ArrayBuffer.isView(value)) return value;
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
