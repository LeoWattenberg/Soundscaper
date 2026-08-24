/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independently signed and reopened OS-isolation evidence for the media host. */

import { createHash, verify } from 'node:crypto';
import { posix } from 'node:path';

export type FramescaperMediaProductionTarget =
	| 'linux-x64' | 'linux-arm64' | 'mac-arm64' | 'win-x64' | 'win-arm64';

export interface FramescaperMediaProductionReadinessReferenceV2 {
	readonly schemaVersion: 2;
	readonly status: 'reviewed';
	readonly target: FramescaperMediaProductionTarget;
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

export interface FramescaperMediaRuntimeLibraryEvidenceV1 {
	readonly name: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperMediaOsIsolationLauncherContractV1 {
	readonly schemaVersion: 1;
	readonly target: FramescaperMediaProductionTarget;
	readonly launcherId: string;
	readonly launcherPayloadSha256: string;
	readonly sandboxProfileSha256: string;
	readonly brokerPolicySha256: string;
	readonly filesystem: 'broker-grant-only';
	readonly network: 'denied';
	readonly childProcesses: 'denied';
	readonly dynamicCode: 'denied';
}

export interface FramescaperMediaProductionReadinessEvidenceV1 {
	readonly schemaVersion: 1;
	readonly kind: 'framescaper-media-host-production-readiness';
	readonly target: FramescaperMediaProductionTarget;
	readonly mediaHostSha256: string;
	readonly runtimeLibraries: readonly FramescaperMediaRuntimeLibraryEvidenceV1[];
	readonly launcher: FramescaperMediaOsIsolationLauncherContractV1;
	readonly ffmpegVersion: '9.0.1';
	readonly osIsolationAttested: true;
	readonly hostileMediaDenialAttested: true;
	readonly dualStreamFdRemapAttested: true;
	readonly twoHourContinuityAttested: true;
	readonly reviewedAt: string;
	readonly reviewer: string;
}

export interface FramescaperMediaProductionReadinessPorts {
	readonly readEvidence: (path: string) => Promise<Buffer>;
	readonly resolveReviewPublicKey: (
		target: FramescaperMediaProductionTarget,
		reviewKeyId: string,
	) => Promise<string | Buffer | null> | string | Buffer | null;
}

export interface FramescaperMediaProductionPayloadIdentity {
	readonly mediaHostSha256: string;
	readonly isolation: Readonly<{
		readonly launcherSha256: string;
		readonly sandboxProfileSha256: string;
		readonly brokerPolicySha256: string;
		readonly runtimeLibraries: readonly FramescaperMediaRuntimeLibraryEvidenceV1[];
	}>;
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
} as const satisfies Readonly<Record<FramescaperMediaProductionTarget, string>>);
const VERIFIED_READINESS = new WeakSet<object>();

export function framescaperMediaProductionReadinessReference(
	value: unknown,
	target: FramescaperMediaProductionTarget,
): FramescaperMediaProductionReadinessReferenceV2 {
	const row = closed(value, ['schemaVersion', 'status', 'target', 'evidence', 'signature']);
	const evidence = closed(row.evidence, ['path', 'byteLength', 'sha256']);
	const signature = closed(row.signature, ['algorithm', 'reviewKeyId', 'valueBase64']);
	const expectedPath = `config/framescaper-media-host-production-readiness/${target}.json`;
	if (row.schemaVersion !== 2 || row.status !== 'reviewed' || row.target !== target
		|| evidence.path !== expectedPath || posix.normalize(String(evidence.path)) !== evidence.path
		|| !Number.isSafeInteger(evidence.byteLength) || Number(evidence.byteLength) < 128
		|| Number(evidence.byteLength) > 1_048_576
		|| typeof evidence.sha256 !== 'string' || !SHA256.test(evidence.sha256)
		|| signature.algorithm !== 'ed25519'
		|| typeof signature.reviewKeyId !== 'string' || !KEY_ID.test(signature.reviewKeyId)
		|| typeof signature.valueBase64 !== 'string' || !BASE64.test(signature.valueBase64)
		|| Buffer.from(signature.valueBase64, 'base64').byteLength !== 64) {
		throw new TypeError('A Framescaper media production-readiness reference is invalid.');
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

export async function verifyFramescaperMediaProductionReadiness(
	reference: FramescaperMediaProductionReadinessReferenceV2,
	payload: FramescaperMediaProductionPayloadIdentity,
	ports: FramescaperMediaProductionReadinessPorts,
): Promise<FramescaperMediaProductionReadinessEvidenceV1> {
	const first = await ports.readEvidence(reference.evidence.path);
	const reopened = await ports.readEvidence(reference.evidence.path);
	if (!Buffer.isBuffer(first) || !Buffer.isBuffer(reopened) || !first.equals(reopened)
		|| reopened.byteLength !== reference.evidence.byteLength
		|| createHash('sha256').update(reopened).digest('hex') !== reference.evidence.sha256) {
		throw new Error('The media production-readiness evidence changed between authenticated opens.');
	}
	const publicKey = await ports.resolveReviewPublicKey(
		reference.target, reference.signature.reviewKeyId,
	);
	if (publicKey === null || !verify(
		null, reopened, publicKey, Buffer.from(reference.signature.valueBase64, 'base64'),
	)) {
		throw new Error('The media production-readiness evidence has no trusted Ed25519 signature.');
	}
	let parsed: unknown;
	try { parsed = JSON.parse(reopened.toString('utf8')) as unknown; }
	catch { throw new TypeError('The media production-readiness evidence is not JSON.'); }
	const evidence = framescaperMediaProductionReadinessEvidence(parsed, reference.target);
	if (Buffer.from(JSON.stringify(evidence)).compare(reopened) !== 0
		|| evidence.mediaHostSha256 !== payload.mediaHostSha256
		|| evidence.launcher.launcherPayloadSha256 !== payload.isolation.launcherSha256
		|| evidence.launcher.sandboxProfileSha256 !== payload.isolation.sandboxProfileSha256
		|| evidence.launcher.brokerPolicySha256 !== payload.isolation.brokerPolicySha256
		|| JSON.stringify(evidence.runtimeLibraries)
			!== JSON.stringify(payload.isolation.runtimeLibraries)) {
		throw new Error('The signed media production-readiness evidence is stale or non-canonical.');
	}
	VERIFIED_READINESS.add(evidence);
	return evidence;
}

export function isVerifiedFramescaperMediaProductionReadiness(
	value: unknown,
): value is FramescaperMediaProductionReadinessEvidenceV1 {
	return !!value && typeof value === 'object' && VERIFIED_READINESS.has(value);
}

export function framescaperMediaRuntimeClosureSha256(value: readonly Readonly<{
	readonly byteLength: number;
	readonly sha256: string;
}>[]): string {
	if (!Array.isArray(value) || value.length > 32 || value.some((entry) => (
		!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.byteLength)
		|| entry.byteLength < 1 || !SHA256.test(entry.sha256)
	))) throw new TypeError('The Framescaper media runtime closure is invalid.');
	const canonical = value.map(({ byteLength, sha256 }) => ({ byteLength, sha256 }))
		.sort((left, right) => left.sha256.localeCompare(right.sha256) || left.byteLength - right.byteLength);
	return createHash('sha256').update(Buffer.from(JSON.stringify(canonical))).digest('hex');
}

export function framescaperMediaProductionReadinessEvidence(
	value: unknown,
	target: FramescaperMediaProductionTarget,
): FramescaperMediaProductionReadinessEvidenceV1 {
	const row = closed(value, [
		'schemaVersion', 'kind', 'target', 'mediaHostSha256', 'runtimeLibraries', 'launcher',
		'ffmpegVersion', 'osIsolationAttested', 'hostileMediaDenialAttested',
		'dualStreamFdRemapAttested', 'twoHourContinuityAttested', 'reviewedAt', 'reviewer',
	]);
	const launcher = launcherContract(row.launcher, target);
	const runtimeLibraries = runtimeLibraryEvidence(row.runtimeLibraries);
	if (row.schemaVersion !== 1 || row.kind !== 'framescaper-media-host-production-readiness'
		|| row.target !== target || typeof row.mediaHostSha256 !== 'string'
		|| !SHA256.test(row.mediaHostSha256) || row.ffmpegVersion !== '9.0.1'
		|| row.osIsolationAttested !== true || row.hostileMediaDenialAttested !== true
		|| row.dualStreamFdRemapAttested !== true || row.twoHourContinuityAttested !== true
		|| typeof row.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.reviewedAt)
		|| typeof row.reviewer !== 'string' || row.reviewer.length < 3 || row.reviewer.length > 128
		|| /[\u0000-\u001f\u007f]/u.test(row.reviewer)) {
		throw new TypeError('Signed media production-readiness evidence is invalid.');
	}
	return Object.freeze({
		schemaVersion: 1, kind: 'framescaper-media-host-production-readiness', target,
		mediaHostSha256: row.mediaHostSha256, runtimeLibraries, launcher,
		ffmpegVersion: '9.0.1', osIsolationAttested: true, hostileMediaDenialAttested: true,
		dualStreamFdRemapAttested: true, twoHourContinuityAttested: true,
		reviewedAt: row.reviewedAt, reviewer: row.reviewer,
	});
}

function launcherContract(
	value: unknown,
	target: FramescaperMediaProductionTarget,
): FramescaperMediaOsIsolationLauncherContractV1 {
	const row = closed(value, [
		'schemaVersion', 'target', 'launcherId', 'launcherPayloadSha256',
		'sandboxProfileSha256', 'brokerPolicySha256', 'filesystem', 'network',
		'childProcesses', 'dynamicCode',
	]);
	if (row.schemaVersion !== 1 || row.target !== target || row.launcherId !== LAUNCHERS[target]
		|| typeof row.launcherPayloadSha256 !== 'string' || !SHA256.test(row.launcherPayloadSha256)
		|| typeof row.sandboxProfileSha256 !== 'string' || !SHA256.test(row.sandboxProfileSha256)
		|| typeof row.brokerPolicySha256 !== 'string' || !SHA256.test(row.brokerPolicySha256)
		|| row.filesystem !== 'broker-grant-only' || row.network !== 'denied'
		|| row.childProcesses !== 'denied' || row.dynamicCode !== 'denied') {
		throw new TypeError('The signed media launcher isolation contract is invalid.');
	}
	return Object.freeze({
		schemaVersion: 1, target, launcherId: row.launcherId as string,
		launcherPayloadSha256: row.launcherPayloadSha256,
		sandboxProfileSha256: row.sandboxProfileSha256,
		brokerPolicySha256: row.brokerPolicySha256,
		filesystem: 'broker-grant-only', network: 'denied', childProcesses: 'denied',
		dynamicCode: 'denied',
	});
}

function runtimeLibraryEvidence(
	value: unknown,
): readonly FramescaperMediaRuntimeLibraryEvidenceV1[] {
	if (!Array.isArray(value) || value.length > 32) {
		throw new TypeError('Signed media runtime-library evidence is invalid.');
	}
	const libraries = value.map((entry) => {
		const row = closed(entry, ['name', 'byteLength', 'sha256']);
		if (typeof row.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.test(row.name)
			|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
			|| typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
			throw new TypeError('Signed media runtime-library evidence is invalid.');
		}
		return Object.freeze({
			name: row.name, byteLength: Number(row.byteLength), sha256: row.sha256,
		});
	});
	if (libraries.some((library, index) => index > 0
		&& libraries[index - 1]!.name.localeCompare(library.name, 'en') >= 0)) {
		throw new TypeError('Signed media runtime-library evidence must be uniquely ordered.');
	}
	return Object.freeze(libraries);
}

function closed(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Media production readiness requires a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Media production readiness has missing or unsupported fields.');
	}
	return value as Readonly<Record<string, unknown>>;
}
