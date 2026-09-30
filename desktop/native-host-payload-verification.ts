/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared filesystem authentication for separately packaged Framescaper native hosts. */

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

export const FRAMESCAPER_NATIVE_HOST_RUNTIME_TARGETS = Object.freeze({
	'linux-x64': 'linux-x64', 'linux-arm64': 'linux-arm64',
	'darwin-arm64': 'mac-arm64', 'win32-x64': 'win-x64', 'win32-arm64': 'win-arm64',
} as const satisfies Readonly<Record<string, string>>);

type RuntimeKey = keyof typeof FRAMESCAPER_NATIVE_HOST_RUNTIME_TARGETS;
export type FramescaperNativeHostTargetId =
	(typeof FRAMESCAPER_NATIVE_HOST_RUNTIME_TARGETS)[RuntimeKey];

export const FRAMESCAPER_NATIVE_HOST_TARGET_RUNTIMES = Object.freeze({
	'linux-x64': 'linux-x64', 'linux-arm64': 'linux-arm64',
	'mac-arm64': 'darwin-arm64', 'win-x64': 'win32-x64', 'win-arm64': 'win32-arm64',
} as const satisfies Readonly<Record<FramescaperNativeHostTargetId, string>>);

export interface NativeHostPayloadLocation {
	readonly applicationRoot: string; readonly packaged: boolean; readonly resourcesPath: string;
	readonly externalRuntimeRoot?: string; readonly platform?: string; readonly arch?: string;
}

export interface NativeHostPayloadIdentity {
	readonly path: string; readonly byteLength: number; readonly sha256: string;
}

export interface NativeHostIsolationPayloadIdentity {
	readonly launcherPayload: NativeHostPayloadIdentity; readonly sandboxProfilePayload: NativeHostPayloadIdentity;
	readonly brokerPolicyPayload: NativeHostPayloadIdentity;
	readonly runtimeLibraryPayloads: readonly NativeHostPayloadIdentity[];
}

export interface NativeHostFileStat {
	isFile(): boolean; isSymbolicLink?(): boolean;
	readonly size: number; readonly dev: number; readonly ino: number;
}

export interface NativeHostPayloadPorts {
	readonly readFile: (path: string) => Promise<Buffer>; readonly stat: (path: string) => Promise<NativeHostFileStat>;
}

export interface NativeHostExecutableDescriptor extends NativeHostPayloadIdentity {
	readonly identity: Readonly<{ readonly dev: number; readonly ino: number }>;
}

export const DEFAULT_NATIVE_HOST_PAYLOAD_PORTS: NativeHostPayloadPorts = Object.freeze({ readFile, stat: lstat });

export function framescaperNativeHostTargetFor(
	platform: string,
	architecture: string,
): FramescaperNativeHostTargetId | null {
	const key = `${platform}-${architecture}`;
	return Object.hasOwn(FRAMESCAPER_NATIVE_HOST_RUNTIME_TARGETS, key)
		? FRAMESCAPER_NATIVE_HOST_RUNTIME_TARGETS[key as RuntimeKey]
		: null;
}

export function nativeHostIsolationPayloads(
	value: NativeHostIsolationPayloadIdentity,
): readonly NativeHostPayloadIdentity[] {
	return Object.freeze([
		value.launcherPayload, value.sandboxProfilePayload, value.brokerPolicyPayload,
		...value.runtimeLibraryPayloads,
	]);
}

export function nativeHostPayloadPath(
	location: NativeHostPayloadLocation,
	runtimePrefix: string,
	targetId: FramescaperNativeHostTargetId,
	pinnedPath: string,
	developmentTraversalError: string,
): string {
	return location.externalRuntimeRoot
		? join(resolve(location.externalRuntimeRoot), runtimePrefix, targetId, basename(pinnedPath))
		: location.packaged
			? join(location.resourcesPath, 'runtime', runtimePrefix, targetId, basename(pinnedPath))
			: safeDevelopmentPath(location.applicationRoot, pinnedPath, developmentTraversalError);
}

export async function verifyNativeHostPayload(
	path: string,
	payload: NativeHostPayloadIdentity,
	ports: NativeHostPayloadPorts,
): Promise<NativeHostExecutableDescriptor> {
	const before = payloadStatSnapshot(await ports.stat(path), payload);
	const bytes = await ports.readFile(path);
	const after = payloadStatSnapshot(await ports.stat(path), payload);
	if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| bytes.byteLength !== payload.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== payload.sha256) {
		throw new TypeError('payload-digest-mismatch');
	}
	return Object.freeze({
		path,
		byteLength: payload.byteLength,
		sha256: payload.sha256,
		identity: Object.freeze({ dev: after.dev, ino: after.ino }),
	});
}

export async function verifyNativeHostPayloadInventory<
	const Payloads extends readonly NativeHostPayloadIdentity[],
>(options: Readonly<{
	readonly location: NativeHostPayloadLocation;
	readonly runtimePrefix: string;
	readonly targetId: FramescaperNativeHostTargetId;
	readonly payloads: Payloads;
	readonly ports: NativeHostPayloadPorts;
	readonly developmentTraversalError: string;
}>): Promise<Readonly<{ [Index in keyof Payloads]: NativeHostExecutableDescriptor }>> {
	const descriptors = await Promise.all(options.payloads.map((payload) => verifyNativeHostPayload(
		nativeHostPayloadPath(
			options.location,
			options.runtimePrefix,
			options.targetId,
			payload.path,
			options.developmentTraversalError,
		),
		payload,
		options.ports,
	)));
	return Object.freeze(descriptors) as Readonly<{ [Index in keyof Payloads]: NativeHostExecutableDescriptor }>;
}

export function isMissingNativeHostPayloadError(error: unknown): boolean {
	return typeof error === 'object' && error !== null
		&& (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function safeDevelopmentPath(applicationRoot: string, payloadPath: string,
	developmentTraversalError: string): string {
	const root = resolve(applicationRoot);
	const path = resolve(root, payloadPath);
	const traversal = relative(root, path);
	if (!traversal || traversal.startsWith('..') || resolve(root, traversal) !== path) {
		throw new TypeError(developmentTraversalError);
	}
	return path;
}

function payloadStatSnapshot(details: NativeHostFileStat, payload: NativeHostPayloadIdentity):
	Readonly<{ readonly size: number; readonly dev: number; readonly ino: number }> {
	if (!details.isFile() || details.isSymbolicLink?.() === true
		|| !safeIdentity(details.dev) || !safeIdentity(details.ino)
		|| details.size !== payload.byteLength) {
		throw new TypeError('payload-digest-mismatch');
	}
	return Object.freeze({ size: details.size, dev: details.dev, ino: details.ino });
}

function safeIdentity(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}
