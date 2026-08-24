/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed file-or-directory publication authority for native media jobs. */

import { isAbsolute, normalize } from 'node:path';

import { HELPER_DATA_PLANE_MAXIMUM_BYTES } from './helper-data-plane.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';
import {
	admitNativeMediaOutputTreeIdentity,
	type NativeMediaOutputTreeIdentityV1,
} from './native-media-output-tree.ts';

export interface HelperOutputIdentity {
	readonly dev: number;
	readonly ino: number;
}

export interface HelperOutputFileGrant {
	readonly rootPath: string;
	readonly rootIdentity: Readonly<HelperOutputIdentity>;
	readonly temporaryPath: string;
	readonly finalPath: string;
	readonly maximumBytes: number;
}

export interface HelperOutputDirectoryGrant {
	readonly kind: 'directory';
	readonly rootPath: string;
	readonly rootIdentity: Readonly<HelperOutputIdentity>;
	readonly temporaryPath: string;
	readonly finalPath: string;
	readonly maximumBytes: number;
	readonly treeIdentity: NativeMediaOutputTreeIdentityV1;
}

export type HelperOutputGrant = HelperOutputFileGrant | HelperOutputDirectoryGrant;

const FILE_KEYS = Object.freeze([
	'rootPath', 'rootIdentity', 'temporaryPath', 'finalPath', 'maximumBytes',
]);
const DIRECTORY_KEYS = Object.freeze([...FILE_KEYS, 'kind', 'treeIdentity']);
const IDENTITY_KEYS = Object.freeze(['dev', 'ino']);
const MAXIMUM_PATH_BYTES = 4_096;

export function validateHelperOutputGrant(value: unknown): HelperOutputGrant {
	try {
		const record = plainRecord(value);
		const directory = Object.hasOwn(record, 'kind');
		exactKeys(record, directory ? DIRECTORY_KEYS : FILE_KEYS);
		if (directory && record.kind !== 'directory') unsafe('A helper directory output kind is unsupported.');
		const rootPath = absolutePath(record.rootPath, 'output root');
		const temporaryPath = absolutePath(record.temporaryPath, 'temporary output');
		const finalPath = absolutePath(record.finalPath, 'final output');
		if (temporaryPath === finalPath || !isInside(rootPath, temporaryPath)
			|| !isInside(rootPath, finalPath) || parentPath(temporaryPath) !== parentPath(finalPath)) {
			unsafe('A helper output grant must name distinct siblings inside its exact destination root.');
		}
		const base = Object.freeze({
			rootPath, rootIdentity: identity(record.rootIdentity), temporaryPath, finalPath,
			maximumBytes: bytes(record.maximumBytes),
		});
		if (!directory) return base;
		const treeIdentity = admitNativeMediaOutputTreeIdentity(record.treeIdentity);
		const normalizedFinal = normalizedPath(finalPath);
		const normalizedRoot = `${normalizedPath(rootPath).replace(/\/$/u, '')}/`;
		const relativeDestination = normalizedFinal.slice(normalizedRoot.length);
		if (treeIdentity.relativeDestination !== relativeDestination) {
			unsafe('A helper output tree identity disagrees with its exact relative destination.');
		}
		return Object.freeze({ kind: 'directory' as const, ...base, treeIdentity });
	} catch (error) {
		if (error instanceof HelperContractViolationError) throw error;
		return unsafe(error instanceof Error ? error.message : String(error));
	}
}

export function isHelperOutputDirectoryGrant(value: HelperOutputGrant): value is HelperOutputDirectoryGrant {
	return 'kind' in value && value.kind === 'directory';
}

function identity(value: unknown): Readonly<HelperOutputIdentity> {
	const record = plainRecord(value);
	exactKeys(record, IDENTITY_KEYS);
	if (!Number.isSafeInteger(record.dev) || Number(record.dev) < 0
		|| !Number.isSafeInteger(record.ino) || Number(record.ino) < 0) {
		unsafe('A helper output root requires its captured non-negative identity.');
	}
	return Object.freeze({ dev: Number(record.dev), ino: Number(record.ino) });
}

function absolutePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')
		|| normalize(value) !== value || new TextEncoder().encode(value).byteLength > MAXIMUM_PATH_BYTES) {
		unsafe(`A helper ${label} authority must use one bounded normalized absolute path.`);
	}
	return value;
}

function bytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > HELPER_DATA_PLANE_MAXIMUM_BYTES) {
		unsafe('A helper output authority must declare its positive bounded byte length.');
	}
	return Number(value);
}

function isInside(rootPath: string, childPath: string): boolean {
	const root = normalizedPath(rootPath).replace(/\/$/u, '');
	const child = normalizedPath(childPath);
	return child.startsWith(`${root}/`) && child.length > root.length + 1;
}
function parentPath(value: string): string {
	const normalized = normalizedPath(value);
	return normalized.slice(0, normalized.lastIndexOf('/'));
}
function normalizedPath(value: string): string { return value.replace(/\\/gu, '/').replace(/\/{2,}/gu, '/'); }
function plainRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		unsafe('A helper output grant must be a plain record.');
	}
	return value as Record<string, unknown>;
}
function exactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		unsafe('A helper output grant must carry exactly its kind-specific schema keys.');
	}
}
function unsafe(message: string): never { throw new HelperContractViolationError('unsafe-grant', message); }
