/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed candidate/receipt contract shared by assembly and promotion. */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
	validateSoundscaperProfessionalPackagedAppAuthority,
} from './soundscaper-professional-packaged-app-authority.mjs';
import {
	validateSoundscaperProfessionalNativeMacSigningEvidence,
} from './soundscaper-professional-native-macos-signing.mjs';
import {
	validateSoundscaperNativeBinaryArchitectureReceipt,
} from './soundscaper-native-binary-architecture.mjs';
import {
	soundscaperProfessionalNativeToolchainIdentity,
	validateSoundscaperProfessionalNativeToolchainReceipt,
} from './soundscaper-professional-native-toolchain.mjs';

export const SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
export const CANDIDATE_RECEIPT_NAME = 'candidate.json';
export const MAXIMUM_RUNTIME_FILES = 128;
export const MAXIMUM_SELF_TEST_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_FILE_BYTES = 512 * 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const BASE_SOURCE_IDS = Object.freeze([
	'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk',
]);
const COMMON_SELF_TEST_IDS = Object.freeze([
	'addon-exact-backend-format-inventory',
	'm5f1-handshake',
	'm5f1-malformed-frame',
	'fixture-scan',
	'fixture-instantiate',
	'fixture-deterministic-process',
	'fixture-latency',
	'fixture-state-round-trip',
	'fixture-close',
	'isolation-broker-filesystem-grant',
	'isolation-network-denial',
	'isolation-child-process-denial',
	'launcher-refusal',
	'packaged-electron-utility-process-smoke',
	'delivery-filesystem-protocol',
]);

export function soundscaperProfessionalNativeSourceIdsForTarget(targetValue) {
	const target = targetId(targetValue);
	return Object.freeze([
		...BASE_SOURCE_IDS,
		...(target.startsWith('win-') ? ['asio-sdk'] : []),
		...(target.startsWith('linux-') ? ['lv2'] : []),
	]);
}

export function requiredSoundscaperProfessionalNativeSelfTestIds(targetValue) {
	const target = targetId(targetValue);
	return Object.freeze([
		...COMMON_SELF_TEST_IDS,
		...(target === 'mac-arm64' ? ['isolation-rss-ceiling'] : []),
		...(['mac-arm64', 'win-x64', 'win-arm64'].includes(target)
			? ['os-audio-codec-ctest'] : []),
	].sort());
}

export function expectedSoundscaperProfessionalNativeInventory(targetValue) {
	const target = targetId(targetValue);
	return deepFreeze({
		backends: target === 'mac-arm64' ? ['coreaudio']
			: target.startsWith('win-') ? ['wasapi', 'asio'] : ['pipewire', 'alsa', 'jack'],
		addonPluginFormats: [],
		peerPluginFormats: target === 'mac-arm64' ? ['vst3', 'clap', 'au']
			: target.startsWith('linux-') ? ['vst3', 'clap', 'lv2'] : ['vst3', 'clap'],
	});
}

export function soundscaperProfessionalNativeCandidateArtifactPaths(targetValue) {
	const target = targetId(targetValue);
	const executableSuffix = target.startsWith('win-') ? '.exe' : '';
	return deepFreeze({
		payload: 'payload/soundscaper_professional.node',
		osAudioCodec: 'payload/soundscaper_os_audio_codec.node',
		pluginPeer: `payload/soundscaper_professional_peer${executableSuffix}`,
		deliveryFilesystem: `payload/soundscaper_delivery_fs${executableSuffix}`,
		launcher: `payload/milestone5-native-isolation-launcher${executableSuffix}`,
	});
}

export function bindEvidenceReceipt(kind, targetValue, evidence) {
	const target = targetId(targetValue);
	if (!['build', 'self-test', 'toolchain', 'source-authentication',
		'installed-files', 'dependency-closure'].includes(kind)) {
		throw new TypeError('The professional candidate evidence kind is invalid.');
	}
	const value = deepFreeze(structuredClone(evidence));
	return deepFreeze({
		kind, target, sha256: sha256(canonicalJson(value)), evidence: value,
	});
}

export function validateCandidateReceipt(value) {
	closedRecord(value, [
		'schemaVersion', 'kind', 'target', 'sourceRevision', 'buildPlanSha256',
		'evidenceReceipts', 'payload', 'osAudioCodec', 'pluginPeer', 'deliveryFilesystem',
		'isolation', 'productionReadiness',
	], 'candidate receipt');
	if (value.schemaVersion !== 1 || value.kind !== 'soundscaper-professional-native-candidate'
		|| value.target !== targetId(value.target) || !REVISION.test(String(value.sourceRevision))
		|| !SHA256.test(String(value.buildPlanSha256)) || value.productionReadiness !== null) {
		throw new TypeError('The professional native candidate receipt identity is invalid.');
	}
	const paths = soundscaperProfessionalNativeCandidateArtifactPaths(value.target);
	artifactDescriptor(value.payload, paths.payload);
	if (value.target.startsWith('linux-')) {
		if (value.osAudioCodec !== null) {
			throw new TypeError('Linux candidates cannot carry an operating-system codec addon.');
		}
	} else artifactDescriptor(value.osAudioCodec, paths.osAudioCodec);
	artifactDescriptor(value.pluginPeer, paths.pluginPeer);
	artifactDescriptor(value.deliveryFilesystem, paths.deliveryFilesystem);
	closedRecord(value.isolation, [
		'launcher', 'sandboxProfile', 'brokerPolicy', 'entrypointPath', 'runtimeClosure',
	], 'candidate isolation');
	artifactDescriptor(value.isolation.launcher, paths.launcher);
	artifactDescriptor(value.isolation.sandboxProfile, 'payload/native-isolation-profile-v1.json');
	artifactDescriptor(value.isolation.brokerPolicy, 'payload/native-isolation-broker-v1.json');
	if (value.isolation.entrypointPath !== value.pluginPeer.path
		|| !Array.isArray(value.isolation.runtimeClosure)
		|| value.isolation.runtimeClosure.length > MAXIMUM_RUNTIME_FILES) {
		throw new TypeError('The candidate isolation entrypoint or runtime closure is invalid.');
	}
	for (const entry of value.isolation.runtimeClosure) artifactDescriptor(entry);
	const runtimePaths = value.isolation.runtimeClosure.map(({ path }) => path);
	if (runtimePaths.some((path) => !path.startsWith('payload/runtime/'))
		|| new Set(runtimePaths).size !== runtimePaths.length) {
		throw new TypeError('The candidate runtime closure paths are invalid.');
	}
	validateEvidenceReceipts(value);
	return value;
}

function validateEvidenceReceipts(candidate) {
	const expectedKinds = [
		'build', 'self-test', 'toolchain', 'source-authentication',
		'installed-files', 'dependency-closure',
	];
	if (!Array.isArray(candidate.evidenceReceipts)
		|| candidate.evidenceReceipts.length !== expectedKinds.length
		|| JSON.stringify(candidate.evidenceReceipts.map(({ kind }) => kind).sort())
			!== JSON.stringify([...expectedKinds].sort())) {
		throw new TypeError('The candidate evidence receipt inventory is incomplete.');
	}
	for (const receipt of candidate.evidenceReceipts) {
		closedRecord(receipt, ['kind', 'target', 'sha256', 'evidence'], 'candidate evidence receipt');
		if (receipt.target !== candidate.target || !expectedKinds.includes(receipt.kind)
			|| !SHA256.test(String(receipt.sha256))
			|| receipt.sha256 !== sha256(canonicalJson(receipt.evidence))) {
			throw new TypeError(`The candidate ${String(receipt.kind)} evidence receipt is invalid.`);
		}
	}
	const build = evidenceFor(candidate, 'build');
	closedRecord(build, [
		'status', 'sourceRevision', 'buildPlanSha256', 'packagedAppAuthority', 'tests', 'macSigning',
	], 'build evidence');
	if (build.status !== 'passed' || build.sourceRevision !== candidate.sourceRevision
		|| build.buildPlanSha256 !== candidate.buildPlanSha256) {
		throw new TypeError('The candidate build evidence is misbound.');
	}
	const packagedApp = validateSoundscaperProfessionalPackagedAppAuthority(
		build.packagedAppAuthority,
	);
	if (packagedApp.target !== candidate.target
		|| packagedApp.sourceRevision !== candidate.sourceRevision) {
		throw new TypeError('The candidate packaged Electron authority is misbound.');
	}
	if (candidate.target === 'mac-arm64') {
		validateSoundscaperProfessionalNativeMacSigningEvidence(build.macSigning, candidate);
	} else if (build.macSigning !== null) {
		throw new TypeError('Only mac-arm64 candidates can carry mac signing evidence.');
	}
	const selfTest = evidenceFor(candidate, 'self-test');
	closedRecord(selfTest, ['status', 'inventory', 'tests'], 'self-test evidence');
	if (selfTest.status !== 'passed'
		|| JSON.stringify(selfTest.inventory) !== JSON.stringify(
			expectedSoundscaperProfessionalNativeInventory(candidate.target))) {
		throw new TypeError('The candidate self-test inventory evidence is invalid.');
	}
	normalizeSelfTests(selfTest.tests, candidate.target);
	const expectedBuildTestIds = candidate.target.startsWith('linux-')
		? [] : ['os-audio-codec-ctest'];
	if (!Array.isArray(build.tests)
		|| JSON.stringify(build.tests.map(({ id }) => id).sort())
			!== JSON.stringify(expectedBuildTestIds)
		|| build.tests.some((receipt) => !selfTest.tests.some((entry) => sameJson(entry, receipt)))) {
		throw new TypeError('The candidate build receipt omits its target-native CTest result.');
	}
	const toolchain = evidenceFor(candidate, 'toolchain');
	closedRecord(toolchain, ['identity', 'receipt'], 'toolchain evidence');
	boundedText(toolchain.identity, 3, 512, 'candidate toolchain identity');
	validateSoundscaperProfessionalNativeToolchainReceipt(toolchain.receipt);
	if (toolchain.receipt.target !== candidate.target
		|| soundscaperProfessionalNativeToolchainIdentity(toolchain.receipt) !== toolchain.identity) {
		throw new TypeError('The candidate structured toolchain evidence is misbound.');
	}
	const source = evidenceFor(candidate, 'source-authentication');
	closedRecord(source, ['authentication'], 'source evidence');
	normalizeSourceAuthentication(source.authentication, candidate.target);
	const installed = evidenceFor(candidate, 'installed-files');
	closedRecord(installed, ['files'], 'installed-file evidence');
	if (JSON.stringify(installed.files) !== JSON.stringify(candidateDescriptors(candidate))) {
		throw new TypeError('The candidate installed-file receipt does not bind its exact payload closure.');
	}
	const closure = evidenceFor(candidate, 'dependency-closure');
	closedRecord(closure, ['status', 'maximumRuntimeFiles', 'inspections', 'checks'], 'closure evidence');
	if (closure.status !== 'closed' || closure.maximumRuntimeFiles !== MAXIMUM_RUNTIME_FILES
		|| !Array.isArray(closure.inspections)
		|| JSON.stringify(closure.checks) !== JSON.stringify([
			'ambient-dependency-refusal', 'recursive-inspection', 'rpath-refusal',
			'runtime-file-limit-refusal', 'symlink-refusal', 'undeclared-dependency-refusal',
		])) {
		throw new TypeError('The candidate dependency-closure receipt is incomplete.');
	}
	const paths = closure.inspections.map(({ artifactPath }) => artifactPath);
	if (JSON.stringify(paths) !== JSON.stringify(candidateExecutableDescriptors(candidate)
		.map(({ path }) => path).sort())) {
		throw new TypeError('The candidate dependency-closure receipt omitted an executable or runtime file.');
	}
	for (const inspection of closure.inspections) {
		closedRecord(inspection, ['architecture', 'artifactPath', 'imports', 'rpaths'],
			'dependency inspection');
		validateSoundscaperNativeBinaryArchitectureReceipt(inspection.architecture, candidate.target);
		if (!Array.isArray(inspection.imports) || !Array.isArray(inspection.rpaths)
			|| inspection.imports.some((entry) => typeof entry !== 'string' || entry === '')
			|| inspection.rpaths.some((entry) => typeof entry !== 'string' || entry === '')) {
			throw new TypeError('A candidate dependency inspection is invalid.');
		}
	}
}

export function evidenceFor(candidate, kind) {
	const matches = candidate.evidenceReceipts?.filter((entry) => entry?.kind === kind) ?? [];
	if (matches.length !== 1) throw new TypeError(`The candidate has no exact ${kind} evidence receipt.`);
	return matches[0].evidence;
}

export function normalizeSourceAuthentication(value, target) {
	closedRecord(value, ['schemaVersion', 'status', 'sources'], 'source authentication');
	const ids = soundscaperProfessionalNativeSourceIdsForTarget(target);
	if (value.schemaVersion !== 1 || value.status !== 'authenticated'
		|| !Array.isArray(value.sources) || value.sources.length !== ids.length
		|| !ids.every((id) => value.sources.filter((source) => source?.id === id).length === 1)) {
		throw new TypeError('The candidate source authentication is incomplete.');
	}
	for (const source of value.sources) {
		if (source.authenticationStatus !== 'authenticated'
			|| !Number.isSafeInteger(source.archiveEvidence?.byteLength)
			|| source.archiveEvidence.byteLength < 1 || !SHA256.test(String(source.archiveEvidence?.sha256))
			|| source.extractedTreeEvidence?.algorithm !== 'framescaper-portable-source-tree-sha256-v1'
			|| !Number.isSafeInteger(source.extractedTreeEvidence.fileCount)
			|| source.extractedTreeEvidence.fileCount < 1
			|| !SHA256.test(String(source.extractedTreeEvidence.sha256))) {
			throw new TypeError(`The candidate source authentication for ${String(source.id)} is invalid.`);
		}
	}
	return deepFreeze(structuredClone(value));
}

export function normalizeSelfTests(value, target) {
	const required = requiredSoundscaperProfessionalNativeSelfTestIds(target);
	if (!Array.isArray(value) || value.length !== required.length) {
		throw new TypeError('The candidate self-test inventory is incomplete.');
	}
	const ids = [];
	for (const receipt of value) {
		closedRecord(receipt, ['id', 'status', 'commandSha256', 'outputSha256'], 'self-test receipt');
		if (typeof receipt.id !== 'string' || receipt.status !== 'passed'
			|| !SHA256.test(String(receipt.commandSha256)) || !SHA256.test(String(receipt.outputSha256))) {
			throw new TypeError('The candidate self-test inventory contains an invalid receipt.');
		}
		ids.push(receipt.id);
	}
	if (JSON.stringify(ids.sort()) !== JSON.stringify(required)) {
		throw new TypeError('The candidate self-test inventory is incomplete or target-inappropriate.');
	}
	return deepFreeze(structuredClone(value));
}

export function candidateDescriptors(receipt) {
	return [receipt.payload, ...(receipt.osAudioCodec === null ? [] : [receipt.osAudioCodec]),
		receipt.pluginPeer, receipt.deliveryFilesystem, receipt.isolation.launcher,
		receipt.isolation.sandboxProfile, receipt.isolation.brokerPolicy,
		...receipt.isolation.runtimeClosure];
}

export function candidateExecutableDescriptors(receipt) {
	return [receipt.payload, ...(receipt.osAudioCodec === null ? [] : [receipt.osAudioCodec]),
		receipt.pluginPeer, receipt.deliveryFilesystem, receipt.isolation.launcher,
		...receipt.isolation.runtimeClosure];
}

export function executableCandidateArtifact(receipt, descriptor) {
	return [receipt.payload.path, receipt.pluginPeer.path, receipt.deliveryFilesystem.path,
		receipt.isolation.launcher.path,
		...(receipt.osAudioCodec === null ? [] : [receipt.osAudioCodec.path]),
		receipt.isolation.entrypointPath].includes(descriptor.path);
}

export function artifactDescriptor(value, exactPath = null) {
	closedRecord(value, ['path', 'byteLength', 'sha256'], 'candidate artifact');
	if (typeof value.path !== 'string' || value.path === '' || value.path.includes('\\')
		|| value.path.startsWith('/') || value.path.split('/').includes('..')
		|| (exactPath !== null && value.path !== exactPath)
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| value.byteLength > MAXIMUM_FILE_BYTES || !SHA256.test(String(value.sha256))) {
		throw new TypeError('A professional native candidate artifact descriptor is invalid.');
	}
	return value;
}

export function descriptorOnly(value) {
	return Object.freeze({ path: value.path, byteLength: value.byteLength, sha256: value.sha256 });
}

export async function verifyCandidateDirectory(rootValue) {
	const candidateRoot = await canonicalDirectory(rootValue, 'candidate root');
	const receiptBytes = await canonicalRegularFile(resolve(candidateRoot, CANDIDATE_RECEIPT_NAME), 'candidate receipt');
	let receipt;
	try { receipt = JSON.parse(String(receiptBytes)); }
	catch (error) { throw new Error('The professional native candidate receipt is not JSON.', { cause: error }); }
	if (!receiptBytes.equals(canonicalJson(receipt))) {
		throw new TypeError('The professional native candidate receipt is not canonical JSON.');
	}
	validateCandidateReceipt(receipt);
	for (const descriptor of candidateDescriptors(receipt)) {
		const bytes = await canonicalRegularFile(resolveCandidatePath(candidateRoot, descriptor.path),
			`candidate artifact ${descriptor.path}`);
		verifyDescriptor(bytes, descriptor, `candidate artifact ${descriptor.path}`);
	}
	const actual = await regularFileInventory(candidateRoot);
	const expected = [CANDIDATE_RECEIPT_NAME,
		...candidateDescriptors(receipt).map(({ path }) => path)].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`The professional native candidate inventory is not closed: ${actual.join(', ')}.`);
	}
	return deepFreeze({ candidateRoot, receipt, receiptBytes, receiptSha256: sha256(receiptBytes) });
}

export async function canonicalRegularFile(path, label) {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path
		|| before.size < 1 || before.size > MAXIMUM_FILE_BYTES) {
		throw new Error(`The ${label} is not one bounded canonical regular file.`);
	}
	const bytes = await readFile(path);
	const after = await lstat(path);
	if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
		|| before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) {
		throw new Error(`The ${label} changed while it was read.`);
	}
	return bytes;
}

export async function regularFileInventory(root) {
	const files = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error('A professional native candidate cannot contain symbolic links.');
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) files.push(portableRelative(root, path));
			else throw new Error('A professional native candidate cannot contain special files.');
		}
	}
	await visit(root);
	return files.sort();
}

export function resolveCandidatePath(root, portablePath) {
	if (typeof portablePath !== 'string' || portablePath.startsWith('/')
		|| portablePath.includes('\\') || portablePath.split('/').includes('..')) {
		throw new TypeError('A professional candidate path is invalid.');
	}
	const path = resolve(root, ...portablePath.split('/'));
	if (path !== root && !path.startsWith(`${root}${sep}`)) {
		throw new TypeError('A professional candidate path escaped its root.');
	}
	return path;
}

export function portableRelative(root, path) {
	const value = relative(root, path).split(sep).join('/');
	if (value === '' || value.startsWith('../') || value.split('/').includes('..')) {
		throw new TypeError('A professional candidate file escaped its root.');
	}
	return value;
}

export function verifyDescriptor(bytes, descriptor, label) {
	if (bytes.byteLength !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256) {
		throw new Error(`The ${label} failed exact digest authentication.`);
	}
}

export async function canonicalDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be an absolute normalized path.`);
	}
	if (await realpath(value) !== value) throw new Error(`The ${label} is not canonical.`);
	const metadata = await lstat(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error(`The ${label} is not a canonical directory.`);
	}
	return value;
}

export function absentPath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be an absolute normalized path.`);
	}
	return value;
}

export function targetId(value) {
	if (typeof value !== 'string' || !SOUNDSCAPER_PROFESSIONAL_NATIVE_TARGETS.includes(value)) {
		throw new TypeError(`Unsupported Soundscaper professional native target ${String(value)}.`);
	}
	return value;
}

export function revision(value) {
	if (typeof value !== 'string' || !REVISION.test(value)) {
		throw new TypeError('The candidate source revision is invalid.');
	}
	return value;
}

export function digestValue(value, label) {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

export function boundedText(value, minimum, maximum, label) {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

export function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`The ${label} must be one exact record.`);
	}
	return value;
}

export function canonicalJson(value) {
	return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`);
}

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function deepFreeze(value) {
	if (ArrayBuffer.isView(value)) return value;
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
