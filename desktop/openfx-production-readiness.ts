/* SPDX-License-Identifier: AGPL-3.0-only */

/** Signed, reopened OS-launcher evidence for third-party OpenFX execution. */

import { createHash, verify } from 'node:crypto';
import { posix } from 'node:path';

export type OpenFxProductionTarget =
	| 'linux-x64' | 'linux-arm64' | 'mac-arm64' | 'win-x64' | 'win-arm64';

export interface OpenFxProductionReadinessReferenceV2 {
	readonly schemaVersion: 2;
	readonly status: 'reviewed';
	readonly target: OpenFxProductionTarget;
	readonly evidence: Readonly<{
		readonly path: string;
		readonly byteLength: number;
		readonly sha256: string;
	}>;
	readonly signature: Readonly<{
		readonly algorithm: 'ed25519';
		readonly reviewKeyId: string;
		readonly valueBase64: string;
	}>;
}

export interface OpenFxOsIsolationLauncherContractV1 {
	readonly schemaVersion: 1;
	readonly target: OpenFxProductionTarget;
	readonly launcherId: string;
	readonly launcherPayloadSha256: string;
	readonly sandboxProfileSha256: string;
	readonly brokerPolicySha256: string;
	readonly filesystem: 'broker-only';
	readonly network: 'denied';
	readonly childProcesses: 'denied';
	readonly dynamicCode: 'admitted-plugin-only';
}

export interface OpenFxRuntimeLibraryEvidenceV1 {
	readonly name: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface OpenFxProductionReadinessEvidenceV1 {
	readonly schemaVersion: 1;
	readonly kind: 'framescaper-openfx-production-readiness';
	readonly target: OpenFxProductionTarget;
	readonly scannerSha256: string;
	readonly runtimeHostSha256: string;
	readonly qualifiedGpuBackends: readonly OpenFxGpuBackend[];
	readonly runtimeLibraries: readonly OpenFxRuntimeLibraryEvidenceV1[];
	readonly launcher: OpenFxOsIsolationLauncherContractV1;
	readonly openfxVersion: '1.5.1';
	readonly osIsolationAttested: true;
	readonly hostilePluginDenialAttested: true;
	readonly realThirdPartyExecutionAttested: true;
	readonly reviewedAt: string;
	readonly reviewer: string;
}

export type OpenFxGpuBackend = 'opengl' | 'opencl' | 'cuda' | 'metal';

export interface OpenFxProductionReadinessPorts {
	readonly readEvidence: (path: string) => Promise<Buffer>;
	readonly resolveReviewPublicKey: (
		target: OpenFxProductionTarget, reviewKeyId: string,
	) => Promise<string | Buffer | null> | string | Buffer | null;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const LAUNCHERS = Object.freeze({
	'linux-x64': 'framescaper-linux-landlock-seccomp-namespaces-v1',
	'linux-arm64': 'framescaper-linux-landlock-seccomp-namespaces-v1',
	'mac-arm64': 'framescaper-macos-seatbelt-broker-v1',
	'win-x64': 'framescaper-windows-appcontainer-job-v1',
	'win-arm64': 'framescaper-windows-appcontainer-job-v1',
} as const satisfies Readonly<Record<OpenFxProductionTarget, string>>);
const GPU_BACKENDS = Object.freeze(['opengl', 'opencl', 'cuda', 'metal'] as const);
const TARGET_GPU_BACKENDS = Object.freeze({
	'linux-x64': Object.freeze(['opengl', 'opencl', 'cuda'] as const),
	'linux-arm64': Object.freeze(['opengl', 'opencl'] as const),
	'mac-arm64': Object.freeze(['opengl', 'opencl', 'metal'] as const),
	'win-x64': Object.freeze(['opengl', 'opencl', 'cuda'] as const),
	'win-arm64': Object.freeze(['opengl', 'opencl'] as const),
} satisfies Readonly<Record<OpenFxProductionTarget, readonly OpenFxGpuBackend[]>>);
const VERIFIED_READINESS = new WeakSet<object>();

export function openFxProductionReadinessReference(
	value: unknown,
	target: OpenFxProductionTarget,
): OpenFxProductionReadinessReferenceV2 {
	const row = closed(value, ['schemaVersion', 'status', 'target', 'evidence', 'signature']);
	const evidence = closed(row.evidence, ['path', 'byteLength', 'sha256']);
	const signature = closed(row.signature, ['algorithm', 'reviewKeyId', 'valueBase64']);
	const expectedPath = `config/framescaper-openfx-production-readiness/${target}.json`;
	if (row.schemaVersion !== 2 || row.status !== 'reviewed' || row.target !== target
		|| evidence.path !== expectedPath || posix.normalize(String(evidence.path)) !== evidence.path
		|| !Number.isSafeInteger(evidence.byteLength) || Number(evidence.byteLength) < 128
		|| Number(evidence.byteLength) > 1_048_576
		|| typeof evidence.sha256 !== 'string' || !SHA256.test(evidence.sha256)
		|| signature.algorithm !== 'ed25519'
		|| typeof signature.reviewKeyId !== 'string' || !KEY_ID.test(signature.reviewKeyId)
		|| typeof signature.valueBase64 !== 'string' || !BASE64.test(signature.valueBase64)
		|| Buffer.from(signature.valueBase64, 'base64').byteLength !== 64) {
		throw new TypeError('An OpenFX production-readiness reference is invalid.');
	}
	return Object.freeze({
		schemaVersion: 2, status: 'reviewed', target,
		evidence: Object.freeze({
			path: evidence.path, byteLength: Number(evidence.byteLength), sha256: evidence.sha256,
		}),
		signature: Object.freeze({
			algorithm: 'ed25519', reviewKeyId: signature.reviewKeyId,
			valueBase64: signature.valueBase64,
		}),
	});
}

export async function verifyOpenFxProductionReadiness(
	reference: OpenFxProductionReadinessReferenceV2,
	payload: Readonly<{
		readonly scannerSha256: string;
		readonly runtimeHostSha256: string;
		readonly isolation: Readonly<{
			readonly launcherSha256: string;
			readonly sandboxProfileSha256: string;
			readonly brokerPolicySha256: string;
			readonly runtimeLibraries: readonly OpenFxRuntimeLibraryEvidenceV1[];
		}>;
	}>,
	ports: OpenFxProductionReadinessPorts,
): Promise<OpenFxProductionReadinessEvidenceV1> {
	const first = await readExactEvidence(reference, ports);
	const bytes = await readExactEvidence(reference, ports);
	if (first.compare(bytes) !== 0) {
		throw new Error('The OpenFX production-readiness evidence changed between independent opens.');
	}
	const publicKey = await ports.resolveReviewPublicKey(
		reference.target, reference.signature.reviewKeyId,
	);
	if (publicKey === null || !verify(
		null, bytes, publicKey, Buffer.from(reference.signature.valueBase64, 'base64'),
	)) {
		throw new Error('The OpenFX production-readiness evidence has no trusted Ed25519 signature.');
	}
	let parsed: unknown;
	try { parsed = JSON.parse(bytes.toString('utf8')) as unknown; }
	catch { throw new TypeError('The OpenFX production-readiness evidence is not JSON.'); }
	const evidence = openFxProductionReadinessEvidence(parsed, reference.target);
	if (Buffer.from(JSON.stringify(evidence)).compare(bytes) !== 0
		|| evidence.scannerSha256 !== payload.scannerSha256
		|| evidence.runtimeHostSha256 !== payload.runtimeHostSha256
		|| evidence.launcher.launcherPayloadSha256 !== payload.isolation.launcherSha256
		|| evidence.launcher.sandboxProfileSha256 !== payload.isolation.sandboxProfileSha256
		|| evidence.launcher.brokerPolicySha256 !== payload.isolation.brokerPolicySha256
		|| JSON.stringify(evidence.runtimeLibraries)
			!== JSON.stringify(payload.isolation.runtimeLibraries)) {
		throw new Error('The signed OpenFX production-readiness evidence is stale or non-canonical.');
	}
	VERIFIED_READINESS.add(evidence);
	return evidence;
}

async function readExactEvidence(
	reference: OpenFxProductionReadinessReferenceV2,
	ports: OpenFxProductionReadinessPorts,
): Promise<Buffer> {
	const observed = await ports.readEvidence(reference.evidence.path);
	if (!Buffer.isBuffer(observed)) {
		throw new Error('The OpenFX production-readiness evidence changed bytes or digest.');
	}
	const bytes = Buffer.from(observed);
	if (bytes.byteLength !== reference.evidence.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== reference.evidence.sha256) {
		throw new Error('The OpenFX production-readiness evidence changed bytes or digest.');
	}
	return bytes;
}

export function isVerifiedOpenFxProductionReadiness(
	value: unknown,
): value is OpenFxProductionReadinessEvidenceV1 {
	return !!value && typeof value === 'object' && VERIFIED_READINESS.has(value);
}

export function openFxProductionReadinessEvidence(
	value: unknown,
	target: OpenFxProductionTarget,
): OpenFxProductionReadinessEvidenceV1 {
	const row = closed(value, [
		'schemaVersion', 'kind', 'target', 'scannerSha256', 'runtimeHostSha256',
		'qualifiedGpuBackends', 'runtimeLibraries', 'launcher',
		'openfxVersion', 'osIsolationAttested', 'hostilePluginDenialAttested',
		'realThirdPartyExecutionAttested', 'reviewedAt', 'reviewer',
	]);
	const launcher = launcherContract(row.launcher, target);
	const qualifiedGpuBackends = gpuBackends(row.qualifiedGpuBackends, target);
	const runtimeLibraries = runtimeLibraryEvidence(row.runtimeLibraries);
	if (row.schemaVersion !== 1 || row.kind !== 'framescaper-openfx-production-readiness'
		|| row.target !== target || typeof row.scannerSha256 !== 'string'
		|| !SHA256.test(row.scannerSha256) || typeof row.runtimeHostSha256 !== 'string'
		|| !SHA256.test(row.runtimeHostSha256) || row.openfxVersion !== '1.5.1'
		|| row.osIsolationAttested !== true || row.hostilePluginDenialAttested !== true
		|| row.realThirdPartyExecutionAttested !== true
		|| typeof row.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.reviewedAt)
		|| typeof row.reviewer !== 'string' || row.reviewer.length < 3 || row.reviewer.length > 128
		|| /[\u0000-\u001f\u007f]/u.test(row.reviewer)) {
		throw new TypeError('Signed OpenFX production-readiness evidence is invalid.');
	}
	return Object.freeze({
		schemaVersion: 1, kind: 'framescaper-openfx-production-readiness', target,
		scannerSha256: row.scannerSha256, runtimeHostSha256: row.runtimeHostSha256,
		qualifiedGpuBackends, runtimeLibraries, launcher,
		openfxVersion: '1.5.1', osIsolationAttested: true,
		hostilePluginDenialAttested: true, realThirdPartyExecutionAttested: true,
		reviewedAt: row.reviewedAt, reviewer: row.reviewer,
	});
}

function gpuBackends(value: unknown, target: OpenFxProductionTarget): readonly OpenFxGpuBackend[] {
	if (!Array.isArray(value) || value.length > TARGET_GPU_BACKENDS[target].length) {
		throw new TypeError('Signed OpenFX GPU qualification is invalid.');
	}
	const backends = value.map((entry) => {
		if (typeof entry !== 'string' || !(GPU_BACKENDS as readonly string[]).includes(entry)
			|| !(TARGET_GPU_BACKENDS[target] as readonly string[]).includes(entry)) {
			throw new TypeError('Signed OpenFX GPU qualification is invalid for its target.');
		}
		return entry as OpenFxGpuBackend;
	});
	const canonical = GPU_BACKENDS.filter((backend) => backends.includes(backend));
	if (new Set(backends).size !== backends.length || JSON.stringify(backends) !== JSON.stringify(canonical)) {
		throw new TypeError('Signed OpenFX GPU qualification must be uniquely ordered.');
	}
	return Object.freeze(backends);
}

export function sameOpenFxLauncherContract(
	left: OpenFxOsIsolationLauncherContractV1,
	right: OpenFxOsIsolationLauncherContractV1,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function launcherContract(
	value: unknown,
	target: OpenFxProductionTarget,
): OpenFxOsIsolationLauncherContractV1 {
	const row = closed(value, [
		'schemaVersion', 'target', 'launcherId', 'launcherPayloadSha256',
		'sandboxProfileSha256', 'brokerPolicySha256', 'filesystem', 'network',
		'childProcesses', 'dynamicCode',
	]);
	if (row.schemaVersion !== 1 || row.target !== target || row.launcherId !== LAUNCHERS[target]
		|| typeof row.launcherPayloadSha256 !== 'string' || !SHA256.test(row.launcherPayloadSha256)
		|| typeof row.sandboxProfileSha256 !== 'string' || !SHA256.test(row.sandboxProfileSha256)
		|| typeof row.brokerPolicySha256 !== 'string' || !SHA256.test(row.brokerPolicySha256)
		|| row.filesystem !== 'broker-only' || row.network !== 'denied'
		|| row.childProcesses !== 'denied' || row.dynamicCode !== 'admitted-plugin-only') {
		throw new TypeError('The signed OpenFX launcher isolation contract is invalid.');
	}
	return Object.freeze({
		schemaVersion: 1, target, launcherId: row.launcherId as string,
		launcherPayloadSha256: row.launcherPayloadSha256,
		sandboxProfileSha256: row.sandboxProfileSha256,
		brokerPolicySha256: row.brokerPolicySha256,
		filesystem: 'broker-only', network: 'denied', childProcesses: 'denied',
		dynamicCode: 'admitted-plugin-only',
	});
}

function runtimeLibraryEvidence(value: unknown): readonly OpenFxRuntimeLibraryEvidenceV1[] {
	if (!Array.isArray(value) || value.length > 32) {
		throw new TypeError('Signed OpenFX runtime-library evidence is invalid.');
	}
	const libraries = value.map((entry) => {
		const row = closed(entry, ['name', 'byteLength', 'sha256']);
		if (typeof row.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.test(row.name)
			|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
			|| typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
			throw new TypeError('Signed OpenFX runtime-library evidence is invalid.');
		}
		return Object.freeze({
			name: row.name, byteLength: Number(row.byteLength), sha256: row.sha256,
		});
	});
	if (libraries.some((library, index) => index > 0
		&& libraries[index - 1]!.name.localeCompare(library.name, 'en') >= 0)) {
		throw new TypeError('Signed OpenFX runtime-library evidence must be uniquely ordered.');
	}
	return Object.freeze(libraries);
}

function closed(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('OpenFX production readiness requires a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('OpenFX production readiness has missing or unsupported fields.');
	}
	return value as Readonly<Record<string, unknown>>;
}
