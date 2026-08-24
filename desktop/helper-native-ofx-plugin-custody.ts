/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed helper-wire identity for one immutable OpenFX file or bundle snapshot. */

import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

export interface HelperOpenFxPluginFileIdentity {
	readonly dev: number;
	readonly ino: number;
}

export interface HelperOpenFxPluginRuntimeFile {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly identity: HelperOpenFxPluginFileIdentity;
}

export interface HelperOpenFxPluginCustody {
	readonly schemaVersion: 1;
	readonly kind: 'file' | 'bundle';
	readonly rootPath: string;
	readonly rootIdentity: HelperOpenFxPluginFileIdentity;
	readonly byteLength: number;
	readonly sha256: string;
	readonly fileCount: number;
	readonly executableRelativePath: string;
	readonly resources: readonly HelperOpenFxPluginRuntimeFile[];
	readonly runtimeClosure: readonly HelperOpenFxPluginRuntimeFile[];
}

const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_BYTES = 16 * 1024 ** 3;
const MAXIMUM_FILES = 100_000;
const MAXIMUM_RUNTIME_FILES = 60;
const KEYS = Object.freeze([
	'schemaVersion', 'kind', 'rootPath', 'rootIdentity', 'byteLength', 'sha256',
	'fileCount', 'executableRelativePath', 'resources', 'runtimeClosure',
]);
const FILE_KEYS = Object.freeze(['path', 'bytes', 'sha256', 'identity']);

export function validateHelperOpenFxPluginCustody(
	value: unknown,
	executable: Readonly<{ path: string; bytes: number; sha256: string }>,
): HelperOpenFxPluginCustody {
	const row = record(value, KEYS, 'OpenFX plug-in custody');
	if (row.schemaVersion !== 1 || (row.kind !== 'file' && row.kind !== 'bundle')) {
		throw new TypeError('OpenFX plug-in custody has an unsupported schema or kind.');
	}
	const rootPath = absolutePath(row.rootPath, 'custody root');
	const rootIdentity = identity(row.rootIdentity);
	const byteLength = integer(row.byteLength, 1, MAXIMUM_BYTES, 'custody byte length');
	const fileCount = integer(row.fileCount, 1, MAXIMUM_FILES, 'custody file count');
	const sha256 = digest(row.sha256, 'custody digest');
	const executableRelativePath = relativePath(row.executableRelativePath);
	if (!Array.isArray(row.resources) || !Array.isArray(row.runtimeClosure)
		|| row.resources.length + row.runtimeClosure.length > MAXIMUM_RUNTIME_FILES) {
		throw new TypeError('OpenFX plug-in custody runtime closure is invalid.');
	}
	const resources = Object.freeze(row.resources.map((entry) => runtimeFile(entry, rootPath)));
	const runtimeClosure = Object.freeze(row.runtimeClosure.map((entry) => runtimeFile(entry, rootPath)));
	if (!uniquelyOrdered(resources) || !uniquelyOrdered(runtimeClosure)
		|| resources.some(({ path }) => runtimeClosure.some((entry) => entry.path === path))) {
		throw new TypeError('OpenFX plug-in custody files must be disjoint and uniquely ordered.');
	}
	const expectedExecutable = row.kind === 'file' ? rootPath
		: resolve(rootPath, ...executableRelativePath.split('/'));
	if (executable.path !== expectedExecutable || runtimeClosure.some(({ path }) => path === executable.path)
		|| resources.some(({ path }) => path === executable.path)
		|| (row.kind === 'file' && (executableRelativePath !== '' || fileCount !== 1
			|| resources.length !== 0 || runtimeClosure.length !== 0
			|| byteLength !== executable.bytes || sha256 !== executable.sha256))
		|| (row.kind === 'bundle' && (executableRelativePath === ''
			|| fileCount !== resources.length + runtimeClosure.length + 1
			|| byteLength < executable.bytes))) {
		throw new TypeError('OpenFX plug-in custody does not bind its exact executable and tree.');
	}
	return Object.freeze({
		schemaVersion: 1, kind: row.kind, rootPath, rootIdentity, byteLength, sha256,
		fileCount, executableRelativePath, resources, runtimeClosure,
	});
}

function uniquelyOrdered(values: readonly HelperOpenFxPluginRuntimeFile[]): boolean {
	return values.every((entry, index) => index === 0
		|| values[index - 1]!.path.localeCompare(entry.path, 'en') < 0);
}

function runtimeFile(value: unknown, rootPath: string): HelperOpenFxPluginRuntimeFile {
	const row = record(value, FILE_KEYS, 'OpenFX plug-in runtime file');
	const path = absolutePath(row.path, 'runtime file');
	if (!inside(rootPath, path)) throw new TypeError('An OpenFX runtime file escapes its bundle snapshot.');
	return Object.freeze({
		path, bytes: integer(row.bytes, 1, MAXIMUM_BYTES, 'runtime file bytes'),
		sha256: digest(row.sha256, 'runtime file digest'), identity: identity(row.identity),
	});
}

function inside(root: string, path: string): boolean {
	const value = relative(root, path);
	return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function relativePath(value: unknown): string {
	if (value === '') return '';
	if (typeof value !== 'string' || value.includes('\0') || value.includes('\\')
		|| posix.normalize(value) !== value || value.startsWith('/') || value === '..'
		|| value.startsWith('../')) throw new TypeError('OpenFX executable relative path is invalid.');
	return value;
}

function absolutePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value.includes('\0')) {
		throw new TypeError(`OpenFX ${label} must be an absolute normalized path.`);
	}
	return value;
}

function identity(value: unknown): HelperOpenFxPluginFileIdentity {
	const row = record(value, ['dev', 'ino'], 'OpenFX custody identity');
	return Object.freeze({
		dev: integer(row.dev, 0, Number.MAX_SAFE_INTEGER, 'device identity'),
		ino: integer(row.ino, 0, Number.MAX_SAFE_INTEGER, 'inode identity'),
	});
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new TypeError(`OpenFX ${label} is invalid.`);
	}
	return Number(value);
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`OpenFX ${label} is invalid.`);
	return value;
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| Reflect.ownKeys(value).length !== keys.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key))) {
		throw new TypeError(`${label} must be one closed plain record.`);
	}
	return value as Record<string, unknown>;
}
