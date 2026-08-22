/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact current-target selection for the separately packaged Framescaper media host. */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

export const FRAMESCAPER_MEDIA_HOST_RUNTIME_TARGETS = Object.freeze({
	'linux-x64': 'linux-x64',
	'linux-arm64': 'linux-arm64',
	'darwin-arm64': 'mac-arm64',
	'win32-x64': 'win-x64',
	'win32-arm64': 'win-arm64',
} as const satisfies Readonly<Record<string, string>>);

type RuntimeKey = keyof typeof FRAMESCAPER_MEDIA_HOST_RUNTIME_TARGETS;
export type FramescaperMediaHostTargetId =
	(typeof FRAMESCAPER_MEDIA_HOST_RUNTIME_TARGETS)[RuntimeKey];

export type FramescaperMediaHostUnavailableReason =
	| 'unsupported-platform'
	| 'payload-pending-external'
	| 'payload-missing'
	| 'payload-digest-mismatch'
	| 'manifest-unreadable';

export interface FramescaperMediaHostPayloadLocation {
	readonly applicationRoot: string;
	readonly packaged: boolean;
	readonly resourcesPath: string;
	readonly externalRuntimeRoot?: string;
	readonly platform?: string;
	readonly arch?: string;
}

export interface FramescaperMediaHostDescriptor {
	readonly target: FramescaperMediaHostTargetId;
	readonly runtime: string;
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly hostVersion: string;
	readonly ffmpegVersion: '9.0.1';
	readonly identity: Readonly<{ dev: number; ino: number }>;
}

export type FramescaperMediaHostAvailability =
	| Readonly<{ status: 'available'; descriptor: FramescaperMediaHostDescriptor }>
	| Readonly<{
		status: 'unavailable';
		reason: FramescaperMediaHostUnavailableReason;
		detail: string;
	}>;

interface FileStat {
	isFile(): boolean;
	isSymbolicLink?(): boolean;
	readonly size: number;
	readonly dev: number;
	readonly ino: number;
}

export interface FramescaperMediaHostPayloadPorts {
	readonly readFile: (path: string) => Promise<Buffer>;
	readonly stat: (path: string) => Promise<FileStat>;
}

const DEFAULT_PORTS: FramescaperMediaHostPayloadPorts = Object.freeze({ readFile, stat });
const MANIFEST_NAME = 'config/framescaper-media-host-payload-manifest.json';
const RUNTIME_PREFIX = 'native/framescaper-media-host';
const SOURCE_MANIFEST = 'native/framescaper-media-host/source-manifest.json';
const FFMPEG_SHA256 = 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635';
const SHA256 = /^[a-f\d]{64}$/u;
const TARGET_RUNTIME = Object.freeze({
	'linux-x64': 'linux-x64',
	'linux-arm64': 'linux-arm64',
	'mac-arm64': 'darwin-arm64',
	'win-x64': 'win32-x64',
	'win-arm64': 'win32-arm64',
} as const satisfies Readonly<Record<FramescaperMediaHostTargetId, string>>);

interface PayloadIdentity {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface PayloadRecord extends PayloadIdentity {
	readonly id: FramescaperMediaHostTargetId;
	readonly runtime: string;
}

interface TargetRecord {
	readonly id: FramescaperMediaHostTargetId;
	readonly runtime: string;
	readonly status: 'built' | 'pending-external';
	readonly blockedBy: string | null;
	readonly payload: PayloadIdentity | null;
}

interface PayloadManifest {
	readonly id: string;
	readonly payloads: readonly PayloadRecord[];
	readonly targets: readonly TargetRecord[];
}

export function framescaperMediaHostTargetFor(
	platform: string,
	architecture: string,
): FramescaperMediaHostTargetId | null {
	const key = `${platform}-${architecture}`;
	return Object.hasOwn(FRAMESCAPER_MEDIA_HOST_RUNTIME_TARGETS, key)
		? FRAMESCAPER_MEDIA_HOST_RUNTIME_TARGETS[key as RuntimeKey]
		: null;
}

export async function describeFramescaperMediaHostAvailability(
	location: FramescaperMediaHostPayloadLocation,
	ports: FramescaperMediaHostPayloadPorts = DEFAULT_PORTS,
): Promise<FramescaperMediaHostAvailability> {
	const platform = location.platform ?? process.platform;
	const architecture = location.arch ?? process.arch;
	const targetId = framescaperMediaHostTargetFor(platform, architecture);
	if (targetId === null) {
		return unavailable(
			'unsupported-platform',
			`${platform}-${architecture} is not a claimed Framescaper media-host target.`,
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
			`The Framescaper media-host manifest is invalid: ${errorMessage(error)}`,
		);
	}
	const target = manifest.targets.find(({ id }) => id === targetId)!;
	if (target.status !== 'built') {
		return unavailable(
			'payload-pending-external',
			target.blockedBy ?? `No Framescaper media-host payload has been built for ${targetId}.`,
		);
	}
	const payload = manifest.payloads.find(({ id }) => id === targetId)!;
	const path = location.externalRuntimeRoot
		? join(resolve(location.externalRuntimeRoot), RUNTIME_PREFIX, targetId, basename(payload.path))
		: location.packaged
		? join(location.resourcesPath, 'runtime', RUNTIME_PREFIX, targetId, basename(payload.path))
		: safeDevelopmentPath(location.applicationRoot, payload.path);
	let bytes: Buffer;
	let details: FileStat;
	try {
		[bytes, details] = await Promise.all([ports.readFile(path), ports.stat(path)]);
	} catch (error) {
		return unavailable(
			'payload-missing',
			`The Framescaper media-host payload is missing at ${path}: ${errorMessage(error)}`,
		);
	}
	if (!details.isFile() || details.isSymbolicLink?.() === true
		|| !safeIdentity(details.dev) || !safeIdentity(details.ino)
		|| details.size !== payload.byteLength || bytes.byteLength !== payload.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== payload.sha256) {
		return unavailable(
			'payload-digest-mismatch',
			`The Framescaper media-host payload at ${path} does not match its pinned bytes and identity.`,
		);
	}
	return Object.freeze({
		status: 'available' as const,
		descriptor: Object.freeze({
			target: targetId,
			runtime: target.runtime,
			path,
			byteLength: payload.byteLength,
			sha256: payload.sha256,
			hostVersion: manifest.id.slice('framescaper-media-host-'.length),
			ffmpegVersion: '9.0.1' as const,
			identity: Object.freeze({ dev: details.dev, ino: details.ino }),
		}),
	});
}

export function createFramescaperMediaHostVerifier(
	location: FramescaperMediaHostPayloadLocation,
	ports?: FramescaperMediaHostPayloadPorts,
): () => Promise<FramescaperMediaHostDescriptor> {
	return async () => {
		const availability = await describeFramescaperMediaHostAvailability(location, ports);
		if (availability.status === 'unavailable') {
			throw new Error(
				`The Framescaper media host is unavailable (${availability.reason}): ${availability.detail}`,
			);
		}
		return availability.descriptor;
	};
}

function payloadManifest(value: unknown): PayloadManifest {
	const record = closedRecord(value, [
		'schemaVersion', 'id', 'sourceManifestPath', 'ffmpeg', 'runtimePrefix', 'payloads', 'targets',
	]);
	if (record.schemaVersion !== 1
		|| typeof record.id !== 'string' || !/^framescaper-media-host-\d+\.\d+\.\d+$/u.test(record.id)
		|| record.sourceManifestPath !== SOURCE_MANIFEST || record.runtimePrefix !== RUNTIME_PREFIX) {
		throw new TypeError('The media-host manifest identity is unsupported.');
	}
	const ffmpeg = closedRecord(record.ffmpeg, ['version', 'sha256']);
	if (ffmpeg.version !== '9.0.1' || ffmpeg.sha256 !== FFMPEG_SHA256) {
		throw new TypeError('The media-host manifest does not bind FFmpeg 9.0.1.');
	}
	if (!Array.isArray(record.targets) || !Array.isArray(record.payloads)) {
		throw new TypeError('The media-host manifest must contain target and payload arrays.');
	}
	const targets = record.targets.map(targetRecord);
	const payloads = record.payloads.map(payloadRecord);
	for (const [id, runtime] of Object.entries(TARGET_RUNTIME)) {
		const matchingTargets = targets.filter((target) => target.id === id);
		if (matchingTargets.length !== 1 || matchingTargets[0]!.runtime !== runtime) {
			throw new TypeError(`The media-host manifest must name exactly one ${id} target.`);
		}
		const target = matchingTargets[0]!;
		const matchingPayloads = payloads.filter((payload) => payload.id === id);
		if (target.status === 'built') {
			if (target.blockedBy !== null || target.payload === null || matchingPayloads.length !== 1
				|| !samePayload(target.payload, matchingPayloads[0]!)) {
				throw new TypeError(`Built media-host target ${id} has an inconsistent payload identity.`);
			}
		} else if (target.payload !== null || typeof target.blockedBy !== 'string'
			|| target.blockedBy.length < 16 || matchingPayloads.length !== 0) {
			throw new TypeError(`Pending media-host target ${id} carries a payload claim.`);
		}
	}
	if (targets.length !== Object.keys(TARGET_RUNTIME).length
		|| payloads.some(({ id }) => !targets.some((target) => target.id === id && target.status === 'built'))) {
		throw new TypeError('The media-host manifest contains an unknown or duplicate target.');
	}
	return Object.freeze({
		id: record.id,
		payloads: Object.freeze(payloads),
		targets: Object.freeze(targets),
	});
}

function targetRecord(value: unknown): TargetRecord {
	const record = closedRecord(value, ['id', 'runtime', 'status', 'blockedBy', 'payload']);
	const id = targetId(record.id);
	const runtime = record.runtime;
	const status = record.status;
	const blockedBy = record.blockedBy;
	if (typeof runtime !== 'string' || runtime !== TARGET_RUNTIME[id]
		|| (status !== 'built' && status !== 'pending-external')
		|| (blockedBy !== null && typeof blockedBy !== 'string')) {
		throw new TypeError('A media-host target row is invalid.');
	}
	return Object.freeze({
		id,
		runtime,
		status,
		blockedBy,
		payload: record.payload === null ? null : payloadIdentity(record.payload, id),
	});
}

function payloadRecord(value: unknown): PayloadRecord {
	const record = closedRecord(value, ['id', 'runtime', 'path', 'byteLength', 'sha256']);
	const id = targetId(record.id);
	const runtime = record.runtime;
	if (typeof runtime !== 'string' || runtime !== TARGET_RUNTIME[id]) {
		throw new TypeError('A media-host payload runtime is invalid.');
	}
	return Object.freeze({
		id,
		runtime,
		...payloadIdentity({
			path: record.path,
			byteLength: record.byteLength,
			sha256: record.sha256,
		}, id),
	});
}

function payloadIdentity(value: unknown, id: FramescaperMediaHostTargetId): PayloadIdentity {
	const record = closedRecord(value, ['path', 'byteLength', 'sha256']);
	const prefix = `${RUNTIME_PREFIX}/prebuilt/${id}/`;
	if (typeof record.path !== 'string' || !record.path.startsWith(prefix)
		|| record.path.slice(prefix.length).includes('/') || record.path.includes('\\')
		|| !Number.isSafeInteger(record.byteLength) || Number(record.byteLength) <= 0
		|| typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
		throw new TypeError('A media-host payload identity is invalid.');
	}
	return Object.freeze({
		path: record.path,
		byteLength: Number(record.byteLength),
		sha256: record.sha256,
	});
}

function targetId(value: unknown): FramescaperMediaHostTargetId {
	if (typeof value !== 'string' || !Object.hasOwn(TARGET_RUNTIME, value)) {
		throw new TypeError('A media-host target id is unsupported.');
	}
	return value as FramescaperMediaHostTargetId;
}

function samePayload(left: PayloadIdentity, right: PayloadRecord): boolean {
	return left.path === right.path && left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

function safeDevelopmentPath(applicationRoot: string, payloadPath: string): string {
	const root = resolve(applicationRoot);
	const path = resolve(root, payloadPath);
	const traversal = relative(root, path);
	if (!traversal || traversal.startsWith('..') || resolve(root, traversal) !== path) {
		throw new TypeError('The media-host development payload leaves the application root.');
	}
	return path;
}

function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('A media-host manifest member must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError('A media-host manifest member has an invalid closed shape.');
	}
	return record;
}

function safeIdentity(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function unavailable(
	reason: FramescaperMediaHostUnavailableReason,
	detail: string,
): FramescaperMediaHostAvailability {
	return Object.freeze({ status: 'unavailable' as const, reason, detail });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
