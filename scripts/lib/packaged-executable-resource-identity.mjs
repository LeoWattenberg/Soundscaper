/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';

const EXECUTABLE_RESOURCE_PATTERN = /(?:\.(?:c|m)?js|\.html?)$/u;
const MAXIMUM_EXECUTABLE_FILES = 10_000;
const MAXIMUM_EXECUTABLE_FILE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_EXECUTABLE_TOTAL_BYTES = 1024 * 1024 * 1024;

/** Resolve Electron's external Resources directory from its platform executable. */
export function resolvePackagedResourcesPath(executablePath, platform) {
	if (!['linux', 'win32', 'darwin'].includes(platform)) {
		throw new TypeError('Packaged executable-resource platform is invalid.');
	}
	const paths = platform === 'win32' ? win32 : posix;
	if (typeof executablePath !== 'string' || !paths.isAbsolute(executablePath)) {
		throw new TypeError('Packaged executable-resource path needs an absolute executable.');
	}
	const directory = paths.dirname(executablePath);
	return platform === 'darwin'
		? paths.resolve(directory, '..', 'Resources')
		: paths.resolve(directory, 'resources');
}

/** Inventory every JavaScript and HTML resource shipped outside app.asar. */
export async function collectPackagedExecutableResourceFiles(resourcesRoot) {
	if (typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)) {
		throw new TypeError('Packaged executable resources need an absolute root.');
	}
	const root = resolve(resourcesRoot);
	const files = [];
	let totalBytes = 0;

	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => compareText(left.name, right.name));
		for (const entry of entries) {
			const path = join(directory, entry.name);
			const name = relative(root, path).split(sep).join('/');
			if (entry.isSymbolicLink()) {
				throw new Error(`Packaged executable resources contain a symbolic link at ${name}.`);
			}
			if (entry.isDirectory()) {
				await visit(path);
				continue;
			}
			if (!entry.isFile()) {
				throw new Error(`Packaged executable resources contain a special entry at ${name}.`);
			}
			if (!EXECUTABLE_RESOURCE_PATTERN.test(name)) continue;
			const metadata = await lstat(path);
			if (metadata.size > MAXIMUM_EXECUTABLE_FILE_BYTES) {
				throw new Error(`Packaged executable resource ${name} exceeds its byte limit.`);
			}
			const bytes = await readFile(path);
			totalBytes += bytes.byteLength;
			files.push(Object.freeze({
				path: name,
				byteLength: bytes.byteLength,
				sha256: sha256(bytes),
			}));
			if (files.length > MAXIMUM_EXECUTABLE_FILES || totalBytes > MAXIMUM_EXECUTABLE_TOTAL_BYTES) {
				throw new Error('Packaged executable resources exceed their inventory budget.');
			}
		}
	}

	await visit(root);
	files.sort((left, right) => compareText(left.path, right.path));
	return Object.freeze(files);
}

/** Content identity used by build evidence and the before/after runtime witness. */
export function packagedExecutableResourceIdentity(files) {
	if (!Array.isArray(files) || files.some((file) => !validFileRecord(file))) {
		throw new TypeError('Packaged executable-resource identity needs exact file records.');
	}
	const paths = files.map(({ path }) => path);
	if (JSON.stringify(paths) !== JSON.stringify([...new Set(paths)].sort(compareText))) {
		throw new Error('Packaged executable-resource records must be uniquely sorted by path.');
	}
	return Object.freeze({
		fileCount: files.length,
		totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
		sha256: sha256(Buffer.from(JSON.stringify(files), 'utf8')),
	});
}

export async function capturePackagedExecutableResourcesBeforeLaunch({ executablePath, platform }) {
	const path = resolvePackagedResourcesPath(executablePath, platform);
	const files = await collectPackagedExecutableResourceFiles(path);
	return Object.freeze({ path, beforeLaunch: packagedExecutableResourceIdentity(files) });
}

export async function capturePackagedExecutableResourcesAfterCollection(value) {
	const inspected = inspectPackagedExecutableResourcesBeforeLaunch(value);
	const files = await collectPackagedExecutableResourceFiles(inspected.path);
	const afterCollection = packagedExecutableResourceIdentity(files);
	if (JSON.stringify(inspected.beforeLaunch) !== JSON.stringify(afterCollection)) {
		throw new Error('Packaged executable resources changed between launch and collection.');
	}
	return Object.freeze({
		path: inspected.path,
		beforeLaunch: inspected.beforeLaunch,
		afterCollection,
	});
}

export function inspectPackagedExecutableResourcesBeforeLaunch(value, expectedPath = null) {
	if (!validBeforeLaunch(value) || (expectedPath !== null && value.path !== expectedPath)) {
		throw new TypeError('Packaged executable resources need a valid pre-launch identity.');
	}
	return Object.freeze({
		path: value.path,
		beforeLaunch: Object.freeze({ ...value.beforeLaunch }),
	});
}

function validBeforeLaunch(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& exactKeys(value, ['beforeLaunch', 'path'])
		&& typeof value.path === 'string' && isAbsolute(value.path)
		&& validIdentity(value.beforeLaunch);
}

function validIdentity(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& exactKeys(value, ['fileCount', 'sha256', 'totalBytes'])
		&& Number.isSafeInteger(value.fileCount) && value.fileCount >= 0
		&& Number.isSafeInteger(value.totalBytes) && value.totalBytes >= 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

function validFileRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& exactKeys(value, ['byteLength', 'path', 'sha256'])
		&& typeof value.path === 'string' && value.path !== '' && !value.path.includes('\\')
		&& !value.path.split('/').some((part) => part === '' || part === '.' || part === '..')
		&& EXECUTABLE_RESOURCE_PATTERN.test(value.path)
		&& Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

function exactKeys(value, keys) {
	return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
