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
	| 'payload-pending-external'
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
	readonly status: string;
	readonly blockedBy: string | null;
	readonly toolchainIdentity: string | null;
	readonly payload: Readonly<{ path: string; byteLength: number; sha256: string }> | null;
}

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
	let manifest: {
		addon: { version: string; napiVersion: number; payloadName: string };
		targets: readonly ManifestTarget[];
	};
	try {
		manifest = JSON.parse(String(await readFileImpl(
			join(location.applicationRoot, 'config/native-addon-payload-manifest.json'),
		))) as typeof manifest;
	} catch (error) {
		return unavailable('manifest-unreadable',
			`The native addon payload manifest could not be read: ${describeError(error)}`);
	}
	const record = manifest.targets?.find((entry) => entry.id === target);
	if (!record) {
		return unavailable('unsupported-platform', `The native addon payload manifest has no ${target} target.`);
	}
	if (record.status !== 'built' || record.payload === null) {
		return unavailable('payload-pending-external',
			record.blockedBy ?? `No native addon payload has been built for ${target}.`);
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

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
