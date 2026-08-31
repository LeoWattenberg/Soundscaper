/* SPDX-License-Identifier: AGPL-3.0-only */

/** Identity-free ad-hoc execution sealing for the exact macOS native closure. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const MAXIMUM_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;
const PEER_CANDIDATE_PATH = 'payload/soundscaper_professional_peer';
const PEER_ENTITLEMENTS_DESCRIPTOR = Object.freeze({
	path: 'native/soundscaper-professional-host/soundscaper-professional-peer-entitlements.mac.plist',
	byteLength: 259,
	sha256: '8387b5ab44a8a8cae94acb84289378e0725cdbee8304961c691d44c199181796',
});
const LIBRARY_VALIDATION_ENTITLEMENT = 'com.apple.security.cs.disable-library-validation';
const LIBRARY_VALIDATION_POLICY = 'peer-only-disable-library-validation-v1';
const AUTHENTICATED_PLANS = new WeakSet();

export function createSoundscaperProfessionalNativeMacCodeSealPlan(options) {
	if (options?.target !== 'mac-arm64') {
		throw new TypeError('Professional native mac code sealing supports only mac-arm64.');
	}
	const professionalRoot = canonicalDirectory(options?.professionalInstallRoot,
		'professional install root');
	const isolationRoot = canonicalDirectory(options?.isolationInstallRoot,
		'isolation install root');
	const codecRoot = canonicalDirectory(options?.osAudioCodecInstallRoot,
		'OS audio codec install root');
	const runtimeRoot = canonicalDirectory(options?.runtimeRoot, 'runtime closure root');
	const peerEntitlements = peerEntitlementsAuthority();
	const runtimeArtifacts = regularFileInventory(runtimeRoot).map((path) => ({
		absolutePath: resolve(runtimeRoot, ...path.split('/')),
		candidatePath: `payload/runtime/${path}`,
	}));
	const artifacts = [
		...runtimeArtifacts,
		{
			absolutePath: resolve(professionalRoot, 'soundscaper_professional.node'),
			candidatePath: 'payload/soundscaper_professional.node',
		},
		{
			absolutePath: resolve(codecRoot, 'soundscaper_os_audio_codec.node'),
			candidatePath: 'payload/soundscaper_os_audio_codec.node',
		},
		{
			absolutePath: resolve(professionalRoot, 'soundscaper_professional_peer'),
			candidatePath: 'payload/soundscaper_professional_peer',
		},
		{
			absolutePath: resolve(professionalRoot, 'soundscaper_delivery_fs'),
			candidatePath: 'payload/soundscaper_delivery_fs',
		},
		{
			absolutePath: resolve(isolationRoot, 'bin/milestone5-native-isolation-launcher'),
			candidatePath: 'payload/milestone5-native-isolation-launcher',
		},
	].map((artifact) => Object.freeze({
		...artifact,
		entitlements: artifact.candidatePath === PEER_CANDIDATE_PATH
			? peerEntitlements.descriptor : null,
		preSeal: descriptor(artifact.absolutePath, artifact.candidatePath),
	}));
	const commands = commandTemplates();
	const plan = deepFreeze({
		schemaVersion: 1,
		target: 'mac-arm64',
		method: 'codesign-ad-hoc',
		commands,
		peerEntitlements,
		artifacts,
	});
	AUTHENTICATED_PLANS.add(plan);
	return plan;
}

export async function executeSoundscaperProfessionalNativeMacCodeSealPlan(plan, options = {}) {
	if (!AUTHENTICATED_PLANS.has(plan)) {
		throw new TypeError('Professional native code sealing requires an authenticated plan.');
	}
	const run = options.run ?? spawnSync;
	assertPeerEntitlements(plan.peerEntitlements);
	const artifacts = [];
	for (const artifact of plan.artifacts) {
		const before = descriptor(artifact.absolutePath, artifact.candidatePath);
		if (!sameDescriptor(before, artifact.preSeal)) {
			throw new Error(`Professional native code-seal input ${artifact.candidatePath} changed after planning.`);
		}
		const peer = artifact.candidatePath === PEER_CANDIDATE_PATH;
		if ((peer && !sameDescriptor(artifact.entitlements, PEER_ENTITLEMENTS_DESCRIPTOR))
			|| (!peer && artifact.entitlements !== null)) {
			throw new Error('Professional native code-seal plan has target-inappropriate entitlements.');
		}
		runStep(run, materialize(
			peer ? plan.commands.peerSeal : plan.commands.seal,
			artifact.absolutePath,
			plan.peerEntitlements.absolutePath,
		), 'code sealing');
		runStep(run, materialize(plan.commands.verification,
			artifact.absolutePath), 'execution-seal verification');
		runStep(run, materialize(
			peer ? plan.commands.peerEntitlementVerification
				: plan.commands.nonPeerEntitlementVerification,
			artifact.absolutePath,
			plan.peerEntitlements.absolutePath,
		), peer ? 'peer entitlement verification' : 'non-peer entitlement verification');
		assertPeerEntitlements(plan.peerEntitlements);
		artifacts.push(Object.freeze({
			...descriptor(artifact.absolutePath, artifact.candidatePath),
			libraryValidation: Object.freeze({
				policy: LIBRARY_VALIDATION_POLICY,
				expectation: peer ? 'present' : 'absent',
				entitlements: peer ? PEER_ENTITLEMENTS_DESCRIPTOR : null,
			}),
		}));
	}
	const result = deepFreeze({
		schemaVersion: 1,
		status: 'execution-checked',
		target: plan.target,
		method: plan.method,
		artifacts,
	});
	validateSoundscaperProfessionalNativeMacCodeSealResult(result, {
		payload: result.artifacts.find(({ path }) => path === 'payload/soundscaper_professional.node'),
		osAudioCodec: result.artifacts.find(({ path }) => path === 'payload/soundscaper_os_audio_codec.node'),
		pluginPeer: result.artifacts.find(({ path }) => path === 'payload/soundscaper_professional_peer'),
		deliveryFilesystem: result.artifacts.find(({ path }) => path === 'payload/soundscaper_delivery_fs'),
		isolation: {
			launcher: result.artifacts.find(({ path }) =>
				path === 'payload/milestone5-native-isolation-launcher'),
			runtimeClosure: result.artifacts.filter(({ path }) => path.startsWith('payload/runtime/')),
		},
	});
	return result;
}

export function validateSoundscaperProfessionalNativeMacCodeSealResult(value, candidate) {
	closed(value, ['schemaVersion', 'status', 'target', 'method', 'artifacts'],
		'mac code-seal result');
	if (value.schemaVersion !== 1 || value.status !== 'execution-checked'
		|| value.target !== 'mac-arm64' || value.method !== 'codesign-ad-hoc') {
		throw new TypeError('The professional native mac code-seal result is invalid.');
	}
	const expected = [
		...(candidate?.isolation?.runtimeClosure ?? []).slice()
			.sort((left, right) => left.path.localeCompare(right.path)),
		candidate?.payload,
		candidate?.osAudioCodec,
		candidate?.pluginPeer,
		candidate?.deliveryFilesystem,
		candidate?.isolation?.launcher,
	];
	if (expected.some((entry) => !entry) || !Array.isArray(value.artifacts)
		|| value.artifacts.length !== expected.length) {
		throw new TypeError('The professional native mac code-seal result omits a Mach-O.');
	}
	for (const [index, artifact] of value.artifacts.entries()) {
		closed(artifact, ['path', 'byteLength', 'sha256', 'libraryValidation'],
			'mac code-seal artifact');
		closed(artifact.libraryValidation, [
			'policy', 'expectation', 'entitlements',
		], 'mac code-seal library-validation result');
		artifactDescriptor(artifact);
		const peer = artifact.path === PEER_CANDIDATE_PATH;
		const libraryValidation = artifact.libraryValidation;
		if (libraryValidation.policy !== LIBRARY_VALIDATION_POLICY
			|| libraryValidation.expectation !== (peer ? 'present' : 'absent')
			|| (peer ? !sameEntitlementsDescriptor(libraryValidation.entitlements)
				: libraryValidation.entitlements !== null)) {
			throw new TypeError('The professional native mac entitlement result is invalid.');
		}
		if (!sameDescriptor(artifact, expected[index])) {
			throw new TypeError('The professional native mac code-seal result is payload-misbound.');
		}
	}
	return value;
}

function commandTemplates() {
	return deepFreeze({
		seal: {
			command: 'codesign',
			argv: ['--force', '--sign', '-', '$ARTIFACT'],
		},
		peerSeal: {
			command: 'codesign',
			argv: ['--force', '--entitlements', '$PEER_ENTITLEMENTS',
				'--sign', '-', '$ARTIFACT'],
		},
		verification: {
			command: 'codesign',
			argv: ['--verify', '--strict', '--verbose=2', '$ARTIFACT'],
		},
		peerEntitlementVerification: {
			command: 'codesign',
			argv: ['--verify', '--verbose=2', '--test-requirement',
				`=entitlement["${LIBRARY_VALIDATION_ENTITLEMENT}"] exists`,
				'$ARTIFACT'],
		},
		nonPeerEntitlementVerification: {
			command: 'codesign',
			argv: ['--verify', '--verbose=2', '--test-requirement',
				`=! entitlement["${LIBRARY_VALIDATION_ENTITLEMENT}"] exists`,
				'$ARTIFACT'],
		},
	});
}

function materialize(template, path, peerEntitlements = '') {
	return {
		command: template.command,
		argv: template.argv.map((value) => value === '$ARTIFACT' ? path
				: value === '$PEER_ENTITLEMENTS' ? peerEntitlements : value),
	};
}

function runStep(run, step, label) {
	const result = run(step.command, step.argv, {
		encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_OUTPUT_BYTES,
		env: { ...process.env, SOURCE_DATE_EPOCH: '0', TZ: 'UTC', LC_ALL: 'C' },
	});
	if (!result || result.error !== undefined || result.signal !== null || result.status !== 0
		|| typeof (result.stdout ?? '') !== 'string' || typeof (result.stderr ?? '') !== 'string') {
		throw new Error(`Professional native ${label} failed.`);
	}
	if (Buffer.byteLength(result.stdout ?? '') + Buffer.byteLength(result.stderr ?? '')
		> MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError(`Professional native ${label} output exceeded its bound.`);
	}
	return result;
}

function descriptor(path, candidatePath) {
	const metadata = lstatSync(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(path) !== path
		|| metadata.size < 1 || metadata.size > MAXIMUM_ARTIFACT_BYTES) {
		throw new Error(`${basename(path)} is not one bounded canonical Mach-O candidate file.`);
	}
	const bytes = readFileSync(path);
	if (bytes.byteLength !== metadata.size) throw new Error(`${basename(path)} changed while read.`);
	return Object.freeze({ path: candidatePath, byteLength: bytes.byteLength, sha256: sha256(bytes) });
}

function peerEntitlementsAuthority() {
	const absolutePath = resolve(import.meta.dirname, '..', '..',
		...PEER_ENTITLEMENTS_DESCRIPTOR.path.split('/'));
	const observed = descriptor(absolutePath, PEER_ENTITLEMENTS_DESCRIPTOR.path);
	if (!sameDescriptor(observed, PEER_ENTITLEMENTS_DESCRIPTOR)) {
		throw new Error('The professional peer entitlements differ from their pinned descriptor.');
	}
	return deepFreeze({ absolutePath, descriptor: PEER_ENTITLEMENTS_DESCRIPTOR });
}

function assertPeerEntitlements(value) {
	if (!value || typeof value !== 'object'
		|| !sameDescriptor(value.descriptor, PEER_ENTITLEMENTS_DESCRIPTOR)) {
		throw new Error('The professional peer entitlements authority is invalid.');
	}
	const observed = descriptor(value.absolutePath, PEER_ENTITLEMENTS_DESCRIPTOR.path);
	if (!sameDescriptor(observed, PEER_ENTITLEMENTS_DESCRIPTOR)) {
		throw new Error('The professional peer entitlements changed after planning.');
	}
}

function sameEntitlementsDescriptor(value) {
	try {
		closed(value, ['path', 'byteLength', 'sha256'], 'mac peer entitlements descriptor');
		return sameDescriptor(value, PEER_ENTITLEMENTS_DESCRIPTOR);
	} catch {
		return false;
	}
}

function artifactDescriptor(value) {
	if (typeof value.path !== 'string' || !value.path.startsWith('payload/')
		|| value.path.includes('\\') || value.path.split('/').includes('..')
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| value.byteLength > MAXIMUM_ARTIFACT_BYTES || !SHA256.test(String(value.sha256))) {
		throw new TypeError('The professional native mac code-seal artifact is invalid.');
	}
}

function regularFileInventory(root) {
	const output = [];
	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error('The mac runtime closure contains a symbolic link.');
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile()) output.push(relative(root, path).split(sep).join('/'));
			else throw new Error('The mac runtime closure contains an unsupported entry.');
		}
	};
	visit(root);
	return output.sort();
}

function canonicalDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be an absolute normalized path.`);
	const metadata = lstatSync(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(value) !== value) {
		throw new Error(`The ${label} must be one canonical directory.`);
	}
	return value;
}

function sameDescriptor(left, right) {
	return !!left && !!right && left.path === right.path && left.byteLength === right.byteLength
		&& left.sha256 === right.sha256;
}
function closed(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Reflect.ownKeys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`Professional native ${label} requires an exact record.`);
	}
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
