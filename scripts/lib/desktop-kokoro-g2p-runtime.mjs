/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact, target-specific inventory for the frozen offline Kokoro G2P helper. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import noticeRegister from '../kokoro-g2p/notices/sources.json' with { type: 'json' };

export const KOKORO_G2P_VERSION = '0.9.4';
export const KOKORO_G2P_PREFIX = `assistance/kokoro-g2p/${KOKORO_G2P_VERSION}`;
const TARGETS = new Set(['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']);
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_FILES = 16_384;
const MAXIMUM_FILE_BYTES = 2 * 1024 ** 3;
const MAXIMUM_TOTAL_BYTES = 4 * 1024 ** 3;
const MAXIMUM_LICENSE_INVENTORY_BYTES = 2 * 1024 ** 2;

export async function stageDesktopKokoroG2pRuntime({ targetId, bundleRoot, runtimeRoot }) {
	assertTarget(targetId);
	const source = absolutePath(bundleRoot, 'Kokoro G2P build bundle');
	const root = absolutePath(runtimeRoot, 'Kokoro G2P runtime root');
	await assertDirectory(source, 'Kokoro G2P build bundle');
	await validatePythonLicenseCoverage(source);
	const paths = await inventoryPaths(source);
	const executable = targetId.startsWith('win-') ? 'kokoro-g2p.exe' : 'kokoro-g2p';
	if (!paths.includes(executable)) throw new Error(`Kokoro G2P build bundle is missing executable ${executable}.`);
	const destination = join(root, KOKORO_G2P_PREFIX, targetId);
	const temporary = `${destination}.staging-${process.pid}`;
	await mkdir(dirname(destination), { recursive: true });
	await rm(temporary, { recursive: true, force: true });
	await mkdir(temporary, { recursive: true });
	try {
		const files = [];
		let totalBytes = 0;
		for (const path of paths) {
			const input = join(source, path);
			const output = join(temporary, path);
			await mkdir(dirname(output), { recursive: true });
			await cp(input, output, { errorOnExist: true, force: false });
			const info = await fileDescriptor(output);
			files.push({ path, ...info });
			totalBytes += info.byteLength;
			if (totalBytes > MAXIMUM_TOTAL_BYTES) throw new Error('Kokoro G2P build bundle exceeds its byte limit.');
		}
		const manifest = {
			schemaVersion: 1,
			runtimeVersion: KOKORO_G2P_VERSION,
			targetId,
			runtimePrefix: KOKORO_G2P_PREFIX,
			executable,
			files,
		};
		await verifyDesktopKokoroG2pRuntime({ manifest, targetId, runtimeRoot: root, targetRoot: temporary });
		await rm(destination, { recursive: true, force: true });
		await rename(temporary, destination);
		return {
			manifest,
			manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
			summary: { targetId, fileCount: files.length, byteLength: totalBytes },
		};
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

/** Describe a completed onedir bundle without copying it, for verified reuse. */
export async function describeDesktopKokoroG2pBundle({ targetId, bundleRoot }) {
	assertTarget(targetId);
	const root = absolutePath(bundleRoot, 'Kokoro G2P build bundle');
	await assertDirectory(root, 'Kokoro G2P build bundle');
	await validatePythonLicenseCoverage(root);
	const paths = await inventoryPaths(root);
	const executable = targetId.startsWith('win-') ? 'kokoro-g2p.exe' : 'kokoro-g2p';
	if (!paths.includes(executable)) throw new Error('Kokoro G2P build bundle is missing its executable.');
	const files = [];
	for (const path of paths) {
		files.push({ path, ...await fileDescriptor(join(root, path)) });
	}
	const manifest = {
		schemaVersion: 1, runtimeVersion: KOKORO_G2P_VERSION, targetId,
		runtimePrefix: KOKORO_G2P_PREFIX, executable, files,
	};
	validateDesktopKokoroG2pManifest(manifest, targetId);
	return manifest;
}

export async function verifyDesktopKokoroG2pRuntime({ manifest, targetId, runtimeRoot, targetRoot }) {
	assertTarget(targetId);
	const root = absolutePath(runtimeRoot, 'Kokoro G2P runtime root');
	validateDesktopKokoroG2pManifest(manifest, targetId);
	const target = targetRoot === undefined
		? join(root, KOKORO_G2P_PREFIX, targetId)
		: absolutePath(targetRoot, 'Kokoro G2P staging root');
	await assertDirectory(target, 'Kokoro G2P target');
	const actual = await inventoryPaths(target);
	const expected = manifest.files.map(({ path }) => path);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error('Kokoro G2P file inventory differs from the authenticated manifest.');
	}
	let totalBytes = 0;
	for (const file of manifest.files) {
		const actualFile = await fileDescriptor(join(target, file.path));
		if (actualFile.byteLength !== file.byteLength || actualFile.sha256 !== file.sha256) {
			throw new Error(`Kokoro G2P file digest or length differs: ${file.path}.`);
		}
		totalBytes += file.byteLength;
	}
	if (totalBytes > MAXIMUM_TOTAL_BYTES) throw new Error('Kokoro G2P closure exceeds its byte limit.');
	return { executablePath: join(target, manifest.executable), fileCount: actual.length, byteLength: totalBytes };
}

export function validateDesktopKokoroG2pManifest(manifest, targetId) {
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
		|| manifest.schemaVersion !== 1 || manifest.runtimeVersion !== KOKORO_G2P_VERSION
		|| manifest.targetId !== targetId || manifest.runtimePrefix !== KOKORO_G2P_PREFIX
		|| manifest.executable !== (targetId.startsWith('win-') ? 'kokoro-g2p.exe' : 'kokoro-g2p')
		|| !Array.isArray(manifest.files) || manifest.files.length === 0
		|| manifest.files.length > MAXIMUM_FILES) {
		throw new TypeError('Kokoro G2P target manifest is invalid.');
	}
	let previous = '';
	let totalBytes = 0;
	for (const file of manifest.files) {
		if (!file || typeof file !== 'object' || Array.isArray(file)
			|| !validRelativePath(file.path)
			|| !Number.isSafeInteger(file.byteLength) || file.byteLength < 0
			|| file.byteLength > MAXIMUM_FILE_BYTES || !SHA256.test(file.sha256)
			|| (previous !== '' && previous.localeCompare(file.path, 'en') >= 0)) {
			throw new TypeError('Kokoro G2P target manifest has an invalid file path or digest.');
		}
		previous = file.path;
		totalBytes += file.byteLength;
	}
	if (totalBytes > MAXIMUM_TOTAL_BYTES
		|| !manifest.files.some(({ path }) => path === manifest.executable)) {
		throw new TypeError('Kokoro G2P target manifest has no valid executable closure.');
	}
}

async function validatePythonLicenseCoverage(bundleRoot) {
	const inventoryPath = join(bundleRoot, 'python-license-inventory.json');
	const metadata = await lstat(inventoryPath);
	if (!metadata.isFile() || metadata.size > MAXIMUM_LICENSE_INVENTORY_BYTES) {
		throw new Error('Kokoro G2P Python license inventory is invalid.');
	}
	const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
	if (inventory?.schemaVersion !== 1 || !Array.isArray(inventory.packages)
		|| inventory.packages.length === 0 || inventory.packages.length > 1024
		|| noticeRegister.schemaVersion !== 1 || !Array.isArray(noticeRegister.notices)) {
		throw new Error('Kokoro G2P Python license inventory or upstream register is invalid.');
	}
	const seen = new Set();
	for (const distribution of inventory.packages) {
		const name = distribution?.name;
		const version = distribution?.version;
		if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(name)
			|| typeof version !== 'string' || !/^[a-z0-9][a-z0-9.+_-]{0,127}$/iu.test(version)
			|| !Array.isArray(distribution.notices)) {
			throw new Error('Kokoro G2P Python license inventory has an invalid distribution.');
		}
		const safeName = name.toLowerCase().replace(/[^a-z0-9.-]/gu, '-');
		if (seen.has(safeName)) throw new Error(`Kokoro G2P Python license inventory repeats ${name}.`);
		seen.add(safeName);
		const upstream = noticeRegister.notices.filter((notice) =>
			notice.package === name.toLowerCase() && notice.version === version);
		const notices = distribution.notices.length > 0
			? distribution.notices
			: upstream.map((notice) => ({
				path: `licenses/upstream/${notice.path}`,
				byteLength: notice.byteLength,
				sha256: notice.sha256,
			}));
		if (notices.length === 0) {
			throw new Error(`Kokoro G2P package has no license notice: ${name}@${version}.`);
		}
		for (const notice of notices) {
			const expectedPrefix = distribution.notices.length > 0
				? `licenses/python/${safeName}/` : 'licenses/upstream/';
			if (!validRelativePath(notice?.path) || !notice.path.startsWith(expectedPrefix)
				|| !Number.isSafeInteger(notice.byteLength) || notice.byteLength < 1
				|| !SHA256.test(notice.sha256)) {
				throw new Error(`Kokoro G2P license notice is invalid: ${name}@${version}.`);
			}
			const actual = await fileDescriptor(join(bundleRoot, notice.path));
			if (actual.byteLength !== notice.byteLength || actual.sha256 !== notice.sha256) {
				throw new Error(`Kokoro G2P license notice digest or length differs: ${name}@${version}.`);
			}
		}
	}
}

async function inventoryPaths(root) {
	const files = [];
	async function visit(directory, prefix) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			if (!validRelativePath(path)) throw new Error(`Kokoro G2P build bundle has an invalid path: ${path}.`);
			if (entry.isSymbolicLink()) throw new Error(`Kokoro G2P build bundle contains a symbolic link: ${path}.`);
			if (entry.isDirectory()) await visit(join(directory, entry.name), path);
			else if (entry.isFile()) files.push(path);
			else throw new Error(`Kokoro G2P build bundle contains a special file: ${path}.`);
			if (files.length > MAXIMUM_FILES) throw new Error('Kokoro G2P build bundle exceeds its file limit.');
		}
	}
	await visit(root, '');
	files.sort((left, right) => left.localeCompare(right, 'en'));
	return files;
}

async function fileDescriptor(path) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.size > MAXIMUM_FILE_BYTES) {
		throw new Error(`Kokoro G2P closure contains an invalid regular file: ${path}.`);
	}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return { byteLength: metadata.size, sha256: hash.digest('hex') };
}

async function assertDirectory(path, label) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory()) throw new TypeError(`${label} must be a real directory.`);
}

function absolutePath(path, label) {
	if (typeof path !== 'string' || !isAbsolute(path)) throw new TypeError(`${label} must be absolute.`);
	return resolve(path);
}

function assertTarget(targetId) {
	if (!TARGETS.has(targetId)) throw new TypeError('Kokoro G2P package target is unsupported.');
}

function validRelativePath(path) {
	return typeof path === 'string' && path.length > 0 && path.length <= 512
		&& !path.includes('\\') && ![...path].some((part) => part.charCodeAt(0) < 32 || part.charCodeAt(0) === 127)
		&& path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
