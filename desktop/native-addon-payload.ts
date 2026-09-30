/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Runtime selection and verification of the native helper addon payload.
 *
 * The pins live inside the fuse-protected application archive and the payload
 * lives outside it as a verified resource, so the asar integrity fuse protects
 * what we expect and this module proves the bytes on disk still match it. The
 * digest is re-checked before every spawn rather than once at startup: a
 * payload that changed while the editor was running must not be loaded.
 *
 * A target with no built payload is not an error. It reports a typed
 * unavailability the surface shows the user, and the editor keeps working
 * without any native tier at all.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const NATIVE_ADDON_RUNTIME_TARGETS = Object.freeze({
	'linux-x64': 'linux-x64',
	'linux-arm64': 'linux-arm64',
	'darwin-arm64': 'mac-arm64',
	'win32-x64': 'win-x64',
	'win32-arm64': 'win-arm64',
} as const satisfies Readonly<Record<string, string>>);

export type NativeAddonRuntimeKey = keyof typeof NATIVE_ADDON_RUNTIME_TARGETS;
export type NativeAddonTargetId = (typeof NATIVE_ADDON_RUNTIME_TARGETS)[NativeAddonRuntimeKey];

export type NativeAddonUnavailableReason =
	| 'unsupported-platform'
	| 'payload-not-generated'
	| 'payload-missing'
	| 'payload-digest-mismatch'
	| 'manifest-unreadable';

export interface NativeAddonDescriptor {
	readonly target: NativeAddonTargetId;
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly addonVersion: string;
	readonly napiVersion: number;
	readonly toolchainIdentity: string;
}

export type NativeAddonAvailability =
	| Readonly<{ status: 'available'; descriptor: NativeAddonDescriptor }>
	| Readonly<{ status: 'unavailable'; reason: NativeAddonUnavailableReason; detail: string }>;

export interface NativeAddonPayloadLocation {
	/** The directory that holds `config/native-addon-payload-manifest.json`. */
	readonly applicationRoot: string;
	readonly packaged: boolean;
	readonly resourcesPath: string;
	readonly platform?: string;
	readonly arch?: string;
}

interface ManifestTarget {
	readonly id: string;
	readonly status: 'built' | 'ci-generated';
	readonly toolchainIdentity: string | null;
	readonly payload: Readonly<{ path: string; byteLength: number; sha256: string }> | null;
}

interface NativeAddonManifest {
	readonly addon: Readonly<{ version: string; napiVersion: number; payloadName: string }>;
	readonly targets: readonly ManifestTarget[];
}

const SHA256 = /^[a-f0-9]{64}$/u;
const NATIVE_ADDON_TARGET_IDS = new Set<string>(Object.values(NATIVE_ADDON_RUNTIME_TARGETS));

export function nativeAddonTargetFor(platform: string, architecture: string): NativeAddonTargetId | null {
	const key = `${platform}-${architecture}`;
	return Object.hasOwn(NATIVE_ADDON_RUNTIME_TARGETS, key)
		? NATIVE_ADDON_RUNTIME_TARGETS[key as NativeAddonRuntimeKey]
		: null;
}

/**
 * Resolves the payload for the running target and verifies its bytes. Every
 * failure is a typed unavailability rather than a thrown error, because the
 * caller's correct response is always the same: report it and stay on the
 * portable path.
 */
export async function describeNativeAddonAvailability(
	location: NativeAddonPayloadLocation,
	readFileImpl: (path: string) => Promise<Buffer> = readFile,
): Promise<NativeAddonAvailability> {
	const platform = location.platform ?? process.platform;
	const architecture = location.arch ?? process.arch;
	const target = nativeAddonTargetFor(platform, architecture);
	if (!target) {
		return unavailable('unsupported-platform', `${platform}-${architecture} is not a claimed native helper target.`);
	}
	let manifest: NativeAddonManifest;
	try {
		const parsed: unknown = JSON.parse(String(await readFileImpl(
			join(location.applicationRoot, 'config/native-addon-payload-manifest.json'),
		)));
		// Validate every path-producing and descriptor-producing field inside the
		// typed-failure guard. A parseable manifest is still unreadable when one of
		// those fields could escape its root or violate the public descriptor type.
		manifest = validateNativeAddonManifest(parsed);
	} catch (error) {
		return unavailable('manifest-unreadable',
			`The native addon payload manifest could not be read: ${describeError(error)}`);
	}
	const record = manifest.targets.find((entry) => entry.id === target);
	if (!record) {
		return unavailable('unsupported-platform', `The native addon payload manifest has no ${target} target.`);
	}
	if (record.status !== 'built' || record.payload === null) {
		return unavailable('payload-not-generated',
			`The target-native CI payload has not been generated and staged for ${target}.`);
	}
	const path = location.packaged
		? join(location.resourcesPath, 'runtime', 'native', target, manifest.addon.payloadName)
		: join(location.applicationRoot, record.payload.path);
	let bytes: Buffer;
	try {
		bytes = await readFileImpl(path);
	} catch (error) {
		return unavailable('payload-missing', `The native addon payload is missing at ${path}: ${describeError(error)}`);
	}
	if (bytes.byteLength !== record.payload.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== record.payload.sha256) {
		return unavailable('payload-digest-mismatch',
			`The native addon payload at ${path} does not match its pinned digest.`);
	}
	return Object.freeze({
		status: 'available' as const,
		descriptor: Object.freeze({
			target,
			path,
			byteLength: record.payload.byteLength,
			sha256: record.payload.sha256,
			addonVersion: manifest.addon.version,
			napiVersion: manifest.addon.napiVersion,
			toolchainIdentity: record.toolchainIdentity ?? '',
		}),
	});
}

/**
 * The `verifyBinary` seam a helper supervisor calls before every spawn. It
 * throws, because a supervisor treats a failed payload verification as a
 * binary-mismatch fault rather than as a capability report.
 */
export function createNativeAddonVerifier(
	location: NativeAddonPayloadLocation,
	readFileImpl?: (path: string) => Promise<Buffer>,
): () => Promise<NativeAddonDescriptor> {
	return async () => {
		const availability = await describeNativeAddonAvailability(location, readFileImpl);
		if (availability.status !== 'available') {
			throw new Error(`The native helper addon is unavailable (${availability.reason}): ${availability.detail}`);
		}
		return availability.descriptor;
	};
}

function unavailable(reason: NativeAddonUnavailableReason, detail: string): NativeAddonAvailability {
	return Object.freeze({ status: 'unavailable' as const, reason, detail });
}

function validateNativeAddonManifest(value: unknown): NativeAddonManifest {
	const record = manifestRecord(value, 'manifest');
	const addonRecord = manifestRecord(record.addon, 'addon descriptor');
	const addon = Object.freeze({
		version: boundedManifestText(addonRecord.version, 'addon version', 128),
		napiVersion: positiveManifestInteger(addonRecord.napiVersion, 'N-API version'),
		payloadName: payloadFileName(addonRecord.payloadName),
	});
	if (!Array.isArray(record.targets) || record.targets.length < 1
		|| record.targets.length > NATIVE_ADDON_TARGET_IDS.size) {
		throw new TypeError('The manifest must carry one bounded target list.');
	}
	const targets: ManifestTarget[] = [];
	const seen = new Set<string>();
	for (const candidate of record.targets) {
		const target = validateManifestTarget(candidate, addon.payloadName);
		if (seen.has(target.id)) throw new TypeError('The manifest repeats a native addon target.');
		seen.add(target.id);
		targets.push(target);
	}
	return Object.freeze({ addon, targets: Object.freeze(targets) });
}

function validateManifestTarget(value: unknown, payloadName: string): ManifestTarget {
	const record = manifestRecord(value, 'target descriptor');
	if (typeof record.id !== 'string' || !NATIVE_ADDON_TARGET_IDS.has(record.id)) {
		throw new TypeError('The manifest names an unknown native addon target.');
	}
	if (record.status !== 'built' && record.status !== 'ci-generated') {
		throw new TypeError('The manifest names an unknown native addon target status.');
	}
	const toolchainIdentity = record.toolchainIdentity === null
		? null : boundedManifestText(record.toolchainIdentity, 'toolchain identity', 1_024);
	let payload: ManifestTarget['payload'] = null;
	if (record.payload !== null) {
		const payloadRecord = manifestRecord(record.payload, 'payload descriptor');
		const path = relativeManifestPath(payloadRecord.path);
		if (path.split(/[\\/]/u).at(-1) !== payloadName) {
			throw new TypeError('The native addon payload path and payload name do not agree.');
		}
		if (typeof payloadRecord.sha256 !== 'string' || !SHA256.test(payloadRecord.sha256)) {
			throw new TypeError('The native addon payload digest is invalid.');
		}
		payload = Object.freeze({
			path,
			byteLength: positiveManifestInteger(payloadRecord.byteLength, 'payload byte length'),
			sha256: payloadRecord.sha256,
		});
	}
	if ((record.status === 'built') !== (payload !== null)) {
		throw new TypeError('A built native addon target must carry exactly one payload descriptor.');
	}
	return Object.freeze({
		id: record.id,
		status: record.status,
		toolchainIdentity,
		payload,
	});
}

function manifestRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The native addon ${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function boundedManifestText(value: unknown, label: string, maximum: number): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`The native addon ${label} must be bounded non-empty text.`);
	}
	return value;
}

function positiveManifestInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new TypeError(`The native addon ${label} must be a positive safe integer.`);
	}
	return Number(value);
}

function payloadFileName(value: unknown): string {
	const name = boundedManifestText(value, 'payload name', 255);
	if (name === '.' || name === '..' || /[\\/]/u.test(name)) {
		throw new TypeError('The native addon payload name must be one file name.');
	}
	return name;
}

function relativeManifestPath(value: unknown): string {
	const path = boundedManifestText(value, 'payload path', 4_096);
	const components = path.split(/[\\/]/u);
	if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/u.test(path)
		|| components.some((component) => component === '' || component === '.' || component === '..')) {
		throw new TypeError('The native addon payload path must be relative and traversal-free.');
	}
	return path;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
