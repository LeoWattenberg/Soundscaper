/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pre-signing authority for the exact macOS professional-native candidate closure. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const MAXIMUM_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;
const SIGNING_IDENTITIES = new WeakMap();

export function soundscaperProfessionalNativeMacSigningIdentity(value) {
	return signingIdentity(value).identity;
}

export function createSoundscaperProfessionalNativeMacSigningPlan(options) {
	if (options?.target !== 'mac-arm64') {
		throw new TypeError('Professional native mac signing supports only mac-arm64.');
	}
	const signing = signingIdentity(options?.signingIdentity);
	const professionalRoot = canonicalDirectory(options?.professionalInstallRoot,
		'professional install root');
	const isolationRoot = canonicalDirectory(options?.isolationInstallRoot,
		'isolation install root');
	const codecRoot = canonicalDirectory(options?.osAudioCodecInstallRoot,
		'OS audio codec install root');
	const runtimeRoot = canonicalDirectory(options?.runtimeRoot, 'runtime closure root');
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
		preSigning: descriptor(artifact.absolutePath, artifact.candidatePath),
	}));
	const commands = commandTemplates(signing.identity.mode);
	const plan = deepFreeze({
		schemaVersion: 1,
		target: 'mac-arm64',
		signing: signing.identity,
		commands,
		artifacts,
	});
	SIGNING_IDENTITIES.set(plan, signing.raw);
	return plan;
}

export async function executeSoundscaperProfessionalNativeMacSigningPlan(plan, options = {}) {
	const rawIdentity = SIGNING_IDENTITIES.get(plan);
	if (rawIdentity === undefined) {
		throw new TypeError('Professional native signing requires an authenticated signing plan.');
	}
	const run = options.run ?? spawnSync;
	const artifacts = [];
	for (const artifact of plan.artifacts) {
		const before = descriptor(artifact.absolutePath, artifact.candidatePath);
		if (!sameDescriptor(before, artifact.preSigning)) {
			throw new Error(`Professional native signing input ${artifact.candidatePath} changed after planning.`);
		}
		const signResult = runStep(run, materialize(plan.commands.sign, rawIdentity,
			artifact.absolutePath), 'signing');
		const verificationResult = runStep(run, materialize(plan.commands.verification, rawIdentity,
			artifact.absolutePath), 'signature verification');
		artifacts.push(Object.freeze({
			...descriptor(artifact.absolutePath, artifact.candidatePath),
			signOutputSha256: outputDigest(signResult),
			verificationOutputSha256: outputDigest(verificationResult),
		}));
	}
	const evidence = deepFreeze({
		schemaVersion: 1,
		status: 'signatures-verified',
		target: plan.target,
		signing: plan.signing,
		commands: plan.commands,
		artifacts,
	});
	validateSoundscaperProfessionalNativeMacSigningEvidence(evidence, {
		payload: evidence.artifacts.find(({ path }) => path === 'payload/soundscaper_professional.node'),
		osAudioCodec: evidence.artifacts.find(({ path }) => path === 'payload/soundscaper_os_audio_codec.node'),
		pluginPeer: evidence.artifacts.find(({ path }) => path === 'payload/soundscaper_professional_peer'),
		deliveryFilesystem: evidence.artifacts.find(({ path }) => path === 'payload/soundscaper_delivery_fs'),
		isolation: {
			launcher: evidence.artifacts.find(({ path }) =>
				path === 'payload/milestone5-native-isolation-launcher'),
			runtimeClosure: evidence.artifacts.filter(({ path }) => path.startsWith('payload/runtime/')),
		},
	});
	return evidence;
}

export function validateSoundscaperProfessionalNativeMacSigningEvidence(value, candidate) {
	closed(value, ['schemaVersion', 'status', 'target', 'signing', 'commands', 'artifacts'],
		'mac signing evidence');
	closed(value.signing, ['mode', 'identitySha256'], 'mac signing identity');
	closed(value.commands, ['sign', 'verification'], 'mac signing commands');
	if (value.schemaVersion !== 1 || value.status !== 'signatures-verified'
		|| value.target !== 'mac-arm64' || !['ad-hoc', 'developer-id'].includes(value.signing.mode)
		|| !SHA256.test(String(value.signing.identitySha256))) {
		throw new TypeError('The professional native mac signing evidence identity is invalid.');
	}
	const expectedCommands = commandTemplates(value.signing.mode);
	if (JSON.stringify(value.commands) !== JSON.stringify(expectedCommands)) {
		throw new TypeError('The professional native mac signing command evidence is invalid.');
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
		throw new TypeError('The professional native mac signing evidence omits an authenticated Mach-O.');
	}
	for (const [index, artifact] of value.artifacts.entries()) {
		closed(artifact, [
			'path', 'byteLength', 'sha256', 'signOutputSha256', 'verificationOutputSha256',
		], 'mac signing artifact');
		artifactEvidence(artifact);
		if (!sameDescriptor(artifact, expected[index])
			|| !SHA256.test(String(artifact.signOutputSha256))
			|| !SHA256.test(String(artifact.verificationOutputSha256))) {
			throw new TypeError('The professional native mac signing evidence is payload-misbound.');
		}
	}
	return value;
}

function signingIdentity(value) {
	if (value === '-') return deepFreeze({
		identity: { mode: 'ad-hoc', identitySha256: sha256(Buffer.from(value)) }, raw: value,
	});
	const prefix = 'Developer ID Application: ';
	if (typeof value !== 'string' || value !== value.normalize('NFC')
		|| !value.startsWith(prefix) || value.length <= prefix.length || value.length > 256
		|| Buffer.byteLength(value, 'utf8') > 512 || value !== value.trim() || /\p{Cc}/u.test(value)) {
		throw new TypeError('mac-arm64 requires - or one bounded Developer ID Application signing identity.');
	}
	return deepFreeze({
		identity: { mode: 'developer-id', identitySha256: sha256(Buffer.from(value)) }, raw: value,
	});
}

function commandTemplates(mode) {
	return deepFreeze({
		sign: {
			command: 'codesign',
			argv: mode === 'developer-id'
				? ['--force', '--timestamp', '--options', 'runtime', '--sign',
					'$SIGNING_IDENTITY', '$ARTIFACT']
				: ['--force', '--sign', '$SIGNING_IDENTITY', '$ARTIFACT'],
		},
		verification: {
			command: 'codesign',
			argv: ['--verify', '--strict', '--verbose=2', '$ARTIFACT'],
		},
	});
}

function materialize(template, identity, path) {
	return {
		command: template.command,
		argv: template.argv.map((value) => value === '$SIGNING_IDENTITY' ? identity
			: value === '$ARTIFACT' ? path : value),
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

function artifactEvidence(value) {
	if (typeof value.path !== 'string' || !value.path.startsWith('payload/')
		|| value.path.includes('\\') || value.path.split('/').includes('..')
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| value.byteLength > MAXIMUM_ARTIFACT_BYTES || !SHA256.test(String(value.sha256))) {
		throw new TypeError('The professional native mac signing artifact is invalid.');
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

function outputDigest(result) {
	return sha256(Buffer.from(`${result.stdout ?? ''}\0${result.stderr ?? ''}`));
}
function sameDescriptor(left, right) {
	return left.path === right.path && left.byteLength === right.byteLength && left.sha256 === right.sha256;
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
