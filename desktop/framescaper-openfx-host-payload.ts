/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact current-target selection for the separately packaged OpenFX scanner and runtime host. */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

export const FRAMESCAPER_OPENFX_HOST_RUNTIME_TARGETS = Object.freeze({
	'linux-x64': 'linux-x64',
	'linux-arm64': 'linux-arm64',
	'darwin-arm64': 'mac-arm64',
	'win32-x64': 'win-x64',
	'win32-arm64': 'win-arm64',
} as const satisfies Readonly<Record<string, string>>);

type RuntimeKey = keyof typeof FRAMESCAPER_OPENFX_HOST_RUNTIME_TARGETS;
export type FramescaperOpenFxHostTargetId =
	(typeof FRAMESCAPER_OPENFX_HOST_RUNTIME_TARGETS)[RuntimeKey];

export type FramescaperOpenFxHostUnavailableReason =
	| 'unsupported-platform'
	| 'payload-pending-external'
	| 'production-readiness-unattested'
	| 'payload-missing'
	| 'payload-digest-mismatch'
	| 'manifest-unreadable';

export interface FramescaperOpenFxHostPayloadLocation {
	readonly applicationRoot: string;
	readonly packaged: boolean;
	readonly resourcesPath: string;
	readonly externalRuntimeRoot?: string;
	readonly platform?: string;
	readonly arch?: string;
}

export interface FramescaperOpenFxExecutableDescriptor {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: Readonly<{ dev: number; ino: number }>;
}

export interface FramescaperOpenFxHostDescriptor {
	readonly target: FramescaperOpenFxHostTargetId;
	readonly runtime: string;
	readonly hostVersion: string;
	readonly openfxVersion: '1.5.1';
	readonly openfxCommit: 'ab77951';
	readonly scanner: FramescaperOpenFxExecutableDescriptor;
	readonly runtimeHost: FramescaperOpenFxExecutableDescriptor;
}

export type FramescaperOpenFxHostAvailability =
	| Readonly<{ status: 'available'; descriptor: FramescaperOpenFxHostDescriptor }>
	| Readonly<{
		status: 'unavailable';
		reason: FramescaperOpenFxHostUnavailableReason;
		detail: string;
	}>;

interface FileStat {
	isFile(): boolean;
	isSymbolicLink?(): boolean;
	readonly size: number;
	readonly dev: number;
	readonly ino: number;
}

export interface FramescaperOpenFxHostPayloadPorts {
	readonly readFile: (path: string) => Promise<Buffer>;
	readonly stat: (path: string) => Promise<FileStat>;
}

interface PayloadIdentity {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface PayloadPair {
	readonly scannerPayload: PayloadIdentity;
	readonly runtimeHostPayload: PayloadIdentity;
}

interface PayloadRecord extends PayloadPair {
	readonly id: FramescaperOpenFxHostTargetId;
	readonly runtime: string;
}

interface TargetRecord {
	readonly id: FramescaperOpenFxHostTargetId;
	readonly runtime: string;
	readonly status: 'built' | 'pending-external';
	readonly blockedBy: string | null;
	readonly payload: PayloadPair | null;
	readonly productionReadiness: ProductionReadinessAttestation | null;
}

interface ProductionReadinessAttestation {
	readonly schemaVersion: 1;
	readonly status: 'reviewed';
	readonly target: FramescaperOpenFxHostTargetId;
	readonly scannerSha256: string;
	readonly runtimeHostSha256: string;
	readonly osIsolationAttested: true;
	readonly realThirdPartyExecutionAttested: true;
	readonly reviewedAt: string;
	readonly reviewer: string;
	readonly evidenceSha256: string;
}

interface PayloadManifest {
	readonly id: string;
	readonly payloads: readonly PayloadRecord[];
	readonly targets: readonly TargetRecord[];
}

const DEFAULT_PORTS: FramescaperOpenFxHostPayloadPorts = Object.freeze({ readFile, stat });
const MANIFEST_NAME = 'config/framescaper-openfx-host-payload-manifest.json';
const RUNTIME_PREFIX = 'native/framescaper-openfx-host';
const SOURCE_MANIFEST = 'native/framescaper-openfx-host/source-manifest.json';
const OPENFX_SHA256 = '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5';
const SHA256 = /^[a-f\d]{64}$/u;
const TARGET_RUNTIME = Object.freeze({
	'linux-x64': 'linux-x64',
	'linux-arm64': 'linux-arm64',
	'mac-arm64': 'darwin-arm64',
	'win-x64': 'win32-x64',
	'win-arm64': 'win32-arm64',
} as const satisfies Readonly<Record<FramescaperOpenFxHostTargetId, string>>);

export function framescaperOpenFxHostTargetFor(
	platform: string,
	architecture: string,
): FramescaperOpenFxHostTargetId | null {
	const key = `${platform}-${architecture}`;
	return Object.hasOwn(FRAMESCAPER_OPENFX_HOST_RUNTIME_TARGETS, key)
		? FRAMESCAPER_OPENFX_HOST_RUNTIME_TARGETS[key as RuntimeKey]
		: null;
}

export async function describeFramescaperOpenFxHostAvailability(
	location: FramescaperOpenFxHostPayloadLocation,
	ports: FramescaperOpenFxHostPayloadPorts = DEFAULT_PORTS,
): Promise<FramescaperOpenFxHostAvailability> {
	const platform = location.platform ?? process.platform;
	const architecture = location.arch ?? process.arch;
	const targetId = framescaperOpenFxHostTargetFor(platform, architecture);
	if (targetId === null) {
		return unavailable(
			'unsupported-platform',
			`${platform}-${architecture} is not a claimed Framescaper OpenFX-host target.`,
		);
	}
	let manifest: PayloadManifest;
	try {
		manifest = payloadManifest(JSON.parse(String(await ports.readFile(
			join(location.applicationRoot, MANIFEST_NAME),
		))) as unknown);
	} catch (error) {
		return unavailable(
			'manifest-unreadable',
			`The Framescaper OpenFX-host manifest is invalid: ${errorMessage(error)}`,
		);
	}
	const target = manifest.targets.find(({ id }) => id === targetId)!;
	if (target.status !== 'built') {
		return unavailable(
			'payload-pending-external',
			target.blockedBy ?? `No Framescaper OpenFX-host payload has been built for ${targetId}.`,
		);
	}
	if (target.productionReadiness === null) {
		return unavailable(
			'production-readiness-unattested',
			`The ${targetId} OpenFX payload has no reviewed OS-isolation and real third-party execution attestation.`,
		);
	}
	const payload = manifest.payloads.find(({ id }) => id === targetId)!;
	const scannerPath = payloadPath(location, targetId, payload.scannerPayload.path);
	const runtimePath = payloadPath(location, targetId, payload.runtimeHostPayload.path);
	try {
		const [scanner, runtimeHost] = await Promise.all([
			verifyPayload(scannerPath, payload.scannerPayload, ports),
			verifyPayload(runtimePath, payload.runtimeHostPayload, ports),
		]);
		return Object.freeze({
			status: 'available' as const,
			descriptor: Object.freeze({
				target: targetId,
				runtime: target.runtime,
				hostVersion: manifest.id.slice('framescaper-openfx-host-'.length),
				openfxVersion: '1.5.1' as const,
				openfxCommit: 'ab77951' as const,
				scanner,
				runtimeHost,
			}),
		});
	} catch (error) {
		const missing = isMissing(error);
		return unavailable(
			missing ? 'payload-missing' : 'payload-digest-mismatch',
			missing
				? `A Framescaper OpenFX-host payload is missing: ${errorMessage(error)}`
				: 'The Framescaper OpenFX-host payloads do not match their pinned bytes and identities.',
		);
	}
}

export function createFramescaperOpenFxHostVerifier(
	location: FramescaperOpenFxHostPayloadLocation,
	ports?: FramescaperOpenFxHostPayloadPorts,
): () => Promise<FramescaperOpenFxHostDescriptor> {
	return async () => {
		const availability = await describeFramescaperOpenFxHostAvailability(location, ports);
		if (availability.status === 'unavailable') {
			throw new Error(
				`The Framescaper OpenFX host is unavailable (${availability.reason}): ${availability.detail}`,
			);
		}
		return availability.descriptor;
	};
}

async function verifyPayload(
	path: string,
	payload: PayloadIdentity,
	ports: FramescaperOpenFxHostPayloadPorts,
): Promise<FramescaperOpenFxExecutableDescriptor> {
	const [bytes, details] = await Promise.all([ports.readFile(path), ports.stat(path)]);
	if (!details.isFile() || details.isSymbolicLink?.() === true
		|| !safeIdentity(details.dev) || !safeIdentity(details.ino)
		|| details.size !== payload.byteLength || bytes.byteLength !== payload.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== payload.sha256) {
		throw new TypeError('payload-digest-mismatch');
	}
	return Object.freeze({
		path,
		byteLength: payload.byteLength,
		sha256: payload.sha256,
		identity: Object.freeze({ dev: details.dev, ino: details.ino }),
	});
}

function payloadManifest(value: unknown): PayloadManifest {
	const record = closedRecord(value, [
		'schemaVersion', 'id', 'sourceManifestPath', 'openfx', 'runtimePrefix', 'payloads', 'targets',
	]);
	if (record.schemaVersion !== 1
		|| typeof record.id !== 'string' || !/^framescaper-openfx-host-\d+\.\d+\.\d+$/u.test(record.id)
		|| record.sourceManifestPath !== SOURCE_MANIFEST || record.runtimePrefix !== RUNTIME_PREFIX) {
		throw new TypeError('The OpenFX-host manifest identity is unsupported.');
	}
	const openfx = closedRecord(record.openfx, ['version', 'commit', 'sha256']);
	if (openfx.version !== '1.5.1' || openfx.commit !== 'ab77951'
		|| openfx.sha256 !== OPENFX_SHA256) {
		throw new TypeError('The OpenFX-host manifest does not bind the signed 1.5.1 source pin.');
	}
	if (!Array.isArray(record.targets) || !Array.isArray(record.payloads)) {
		throw new TypeError('The OpenFX-host manifest must contain target and payload arrays.');
	}
	const targets = record.targets.map(targetRecord);
	const payloads = record.payloads.map(payloadRecord);
	for (const [id, runtime] of Object.entries(TARGET_RUNTIME)) {
		const matchingTargets = targets.filter((target) => target.id === id);
		if (matchingTargets.length !== 1 || matchingTargets[0]!.runtime !== runtime) {
			throw new TypeError(`The OpenFX-host manifest must name exactly one ${id} target.`);
		}
		const target = matchingTargets[0]!;
		const matchingPayloads = payloads.filter((payload) => payload.id === id);
		if (target.status === 'built') {
			if (target.blockedBy !== null || target.payload === null || matchingPayloads.length !== 1
				|| !samePair(target.payload, matchingPayloads[0]!)) {
				throw new TypeError(`Built OpenFX-host target ${id} has inconsistent payload identities.`);
			}
			if (target.productionReadiness !== null
				&& (target.productionReadiness.scannerSha256 !== target.payload.scannerPayload.sha256
					|| target.productionReadiness.runtimeHostSha256
						!== target.payload.runtimeHostPayload.sha256)) {
				throw new TypeError(`Built OpenFX-host target ${id} has stale production-readiness evidence.`);
			}
		} else if (target.payload !== null || typeof target.blockedBy !== 'string'
			|| target.blockedBy.length < 16 || matchingPayloads.length !== 0
			|| target.productionReadiness !== null) {
			throw new TypeError(`Pending OpenFX-host target ${id} carries a payload claim.`);
		}
	}
	if (targets.length !== Object.keys(TARGET_RUNTIME).length
		|| payloads.some(({ id }) => !targets.some((target) => target.id === id && target.status === 'built'))) {
		throw new TypeError('The OpenFX-host manifest contains an unknown or duplicate target.');
	}
	return Object.freeze({ id: record.id, payloads: Object.freeze(payloads), targets: Object.freeze(targets) });
}

function targetRecord(value: unknown): TargetRecord {
	const record = closedRecord(value, [
		'id', 'runtime', 'status', 'blockedBy', 'payload', 'productionReadiness',
	]);
	const id = targetId(record.id);
	const runtime = record.runtime;
	const status = record.status;
	if (typeof runtime !== 'string' || runtime !== TARGET_RUNTIME[id]
		|| (status !== 'built' && status !== 'pending-external')
		|| (record.blockedBy !== null && typeof record.blockedBy !== 'string')) {
		throw new TypeError('An OpenFX-host target row is invalid.');
	}
	return Object.freeze({
		id,
		runtime,
		status,
		blockedBy: record.blockedBy,
		payload: record.payload === null ? null : payloadPair(record.payload, id),
		productionReadiness: record.productionReadiness === null
			? null : productionReadinessAttestation(record.productionReadiness, id),
	});
}

function productionReadinessAttestation(
	value: unknown,
	target: FramescaperOpenFxHostTargetId,
): ProductionReadinessAttestation {
	const record = closedRecord(value, [
		'schemaVersion', 'status', 'target', 'scannerSha256', 'runtimeHostSha256',
		'osIsolationAttested', 'realThirdPartyExecutionAttested', 'reviewedAt',
		'reviewer', 'evidenceSha256',
	]);
	if (record.schemaVersion !== 1 || record.status !== 'reviewed' || record.target !== target
		|| typeof record.scannerSha256 !== 'string' || !SHA256.test(record.scannerSha256)
		|| typeof record.runtimeHostSha256 !== 'string' || !SHA256.test(record.runtimeHostSha256)
		|| record.osIsolationAttested !== true
		|| record.realThirdPartyExecutionAttested !== true
		|| typeof record.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(record.reviewedAt)
		|| typeof record.reviewer !== 'string' || record.reviewer.length < 3
		|| record.reviewer.length > 128 || /[\u0000-\u001f\u007f]/u.test(record.reviewer)
		|| typeof record.evidenceSha256 !== 'string' || !SHA256.test(record.evidenceSha256)) {
		throw new TypeError('An OpenFX-host production-readiness attestation is invalid.');
	}
	return Object.freeze({
		schemaVersion: 1,
		status: 'reviewed',
		target,
		scannerSha256: record.scannerSha256,
		runtimeHostSha256: record.runtimeHostSha256,
		osIsolationAttested: true,
		realThirdPartyExecutionAttested: true,
		reviewedAt: record.reviewedAt,
		reviewer: record.reviewer,
		evidenceSha256: record.evidenceSha256,
	});
}

function payloadRecord(value: unknown): PayloadRecord {
	const record = closedRecord(value, ['id', 'runtime', 'scannerPayload', 'runtimeHostPayload']);
	const id = targetId(record.id);
	const runtime = record.runtime;
	if (typeof runtime !== 'string' || runtime !== TARGET_RUNTIME[id]) {
		throw new TypeError('An OpenFX-host payload runtime is invalid.');
	}
	return Object.freeze({
		id,
		runtime,
		...payloadPair({
			scannerPayload: record.scannerPayload,
			runtimeHostPayload: record.runtimeHostPayload,
		}, id),
	});
}

function payloadPair(value: unknown, id: FramescaperOpenFxHostTargetId): PayloadPair {
	const record = closedRecord(value, ['scannerPayload', 'runtimeHostPayload']);
	return Object.freeze({
		scannerPayload: payloadIdentity(record.scannerPayload, id, 'framescaper-ofx-scanner'),
		runtimeHostPayload: payloadIdentity(record.runtimeHostPayload, id, 'framescaper-ofx-runtime-host'),
	});
}

function payloadIdentity(
	value: unknown,
	id: FramescaperOpenFxHostTargetId,
	executableName: string,
): PayloadIdentity {
	const record = closedRecord(value, ['path', 'byteLength', 'sha256']);
	const expected = `${RUNTIME_PREFIX}/prebuilt/${id}/bin/${executableName}`;
	if (record.path !== expected || !Number.isSafeInteger(record.byteLength) || Number(record.byteLength) <= 0
		|| typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
		throw new TypeError('An OpenFX-host payload identity is invalid.');
	}
	return Object.freeze({
		path: record.path,
		byteLength: Number(record.byteLength),
		sha256: record.sha256,
	});
}

function targetId(value: unknown): FramescaperOpenFxHostTargetId {
	if (typeof value !== 'string' || !Object.hasOwn(TARGET_RUNTIME, value)) {
		throw new TypeError('An OpenFX-host target id is unsupported.');
	}
	return value as FramescaperOpenFxHostTargetId;
}

function samePair(left: PayloadPair, right: PayloadPair): boolean {
	return samePayload(left.scannerPayload, right.scannerPayload)
		&& samePayload(left.runtimeHostPayload, right.runtimeHostPayload);
}

function samePayload(left: PayloadIdentity, right: PayloadIdentity): boolean {
	return left.path === right.path && left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

function payloadPath(
	location: FramescaperOpenFxHostPayloadLocation,
	targetId: FramescaperOpenFxHostTargetId,
	pinnedPath: string,
): string {
	return location.externalRuntimeRoot
		? join(resolve(location.externalRuntimeRoot), RUNTIME_PREFIX, targetId, basename(pinnedPath))
		: location.packaged
		? join(location.resourcesPath, 'runtime', RUNTIME_PREFIX, targetId, basename(pinnedPath))
		: safeDevelopmentPath(location.applicationRoot, pinnedPath);
}

function safeDevelopmentPath(applicationRoot: string, payloadPath_: string): string {
	const root = resolve(applicationRoot);
	const path = resolve(root, payloadPath_);
	const traversal = relative(root, path);
	if (!traversal || traversal.startsWith('..') || resolve(root, traversal) !== path) {
		throw new TypeError('The OpenFX-host development payload leaves the application root.');
	}
	return path;
}

function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('An OpenFX-host manifest member must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError('An OpenFX-host manifest member has an invalid closed shape.');
	}
	return record;
}

function safeIdentity(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function unavailable(
	reason: FramescaperOpenFxHostUnavailableReason,
	detail: string,
): FramescaperOpenFxHostAvailability {
	return Object.freeze({ status: 'unavailable' as const, reason, detail });
}

function isMissing(error: unknown): boolean {
	return typeof error === 'object' && error !== null
		&& (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
