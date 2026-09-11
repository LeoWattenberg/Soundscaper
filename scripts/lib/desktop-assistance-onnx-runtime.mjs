/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reproducible CPU-only extraction of the exact upstream ONNX Runtime closure. */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	cp, lstat, mkdir, mkdtemp, open, readdir, rename, rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { extract } from 'tar';

import pinnedPayloads from '../../config/assistance-onnx-runtime-payloads.json' with { type: 'json' };

const TARGETS = Object.freeze(['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']);
const PREFIX = 'assistance/onnxruntime-node/1.29.0';
const ENTRYPOINT = 'node_modules/onnxruntime-node/dist/index.js';
const MAXIMUM_SOURCE_BYTES = 256 * 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;

export function createDesktopAssistanceOnnxManifest(targetId, payloads = pinnedPayloads) {
	validatePayloads(payloads);
	assertTarget(targetId);
	const files = payloads.sources.flatMap((source) => source.kind === 'file'
		? [{ path: source.destination, byteLength: source.byteLength, sha256: source.sha256, executable: false }]
		: selectedFiles(source, targetId).map((file) => ({
			...file, path: `${source.destination}/${file.path}`, executable: false,
		})));
	files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	if (!files.some(({ path }) => path === ENTRYPOINT)
		|| new Set(files.map(({ path }) => path)).size !== files.length) {
		throw new TypeError('The ONNX Runtime closure has missing or repeated entrypoints.');
	}
	return {
		schemaVersion: 1,
		familyId: 'onnxruntime-node',
		runtimeVersion: '1.29.0',
		source: { url: pinnedPayloads.sources[0].url, revision: '1.29.0' },
		executionProvider: 'cpu',
		runtimePrefix: PREFIX,
		targets: TARGETS.map((id) => id === targetId ? {
			id, status: 'authenticated', entrypoint: ENTRYPOINT, files,
		} : {
			id, status: 'pending-external',
			blockedBy: `This ${targetId} desktop package does not contain the ${id} ONNX Runtime payload.`,
		}),
	};
}

/** Downloads are verified before extraction; no npm lifecycle script is executed. */
export async function stageDesktopAssistanceOnnxRuntime({
	targetId,
	outputRoot,
	cacheRoot = join(tmpdir(), 'soundscaper-assistance-runtime-cache'),
	fetchImpl = globalThis.fetch,
	payloads = pinnedPayloads,
}) {
	const manifest = createDesktopAssistanceOnnxManifest(targetId, payloads);
	const root = absoluteRoot(outputRoot, 'runtime output');
	const cache = absoluteRoot(cacheRoot, 'runtime source cache');
	if (typeof fetchImpl !== 'function') throw new TypeError('The runtime source fetcher is invalid.');
	await mkdir(cache, { recursive: true, mode: 0o700 });
	await assertDirectory(cache);
	const parent = join(root, PREFIX);
	await mkdir(parent, { recursive: true });
	await assertDirectory(parent);
	const temporary = await mkdtemp(join(parent, `.stage-${targetId}-`));
	try {
		for (const source of payloads.sources) {
			const archivePath = await cachedSource(source, cache, fetchImpl);
			if (source.kind === 'file') {
				const destination = join(temporary, source.destination);
				await mkdir(dirname(destination), { recursive: true });
				await cp(archivePath, destination, { errorOnExist: true, force: false });
			} else {
				await extractPackage(source, selectedFiles(source, targetId), archivePath, temporary);
			}
		}
		const target = manifest.targets.find(({ id }) => id === targetId);
		await verifyInventory(temporary, target.files);
		const destination = join(parent, targetId);
		await rm(destination, { recursive: true, force: true });
		await rename(temporary, destination);
		return {
			manifest,
			summary: {
				schemaVersion: 1, familyId: manifest.familyId, version: manifest.runtimeVersion,
				target: targetId, status: 'authenticated',
				root: `${PREFIX}/${targetId}`, entrypoint: ENTRYPOINT,
				fileCount: target.files.length,
				byteLength: target.files.reduce((total, { byteLength }) => total + byteLength, 0),
				sourceSha256: payloads.sources.map(({ id, sha256 }) => ({ id, sha256 })),
			},
		};
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

async function cachedSource(source, cache, fetchImpl) {
	const destination = join(cache, source.sha256);
	try {
		await verifySource(destination, source);
		return destination;
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	const temporary = join(cache, `.download-${randomUUID()}`);
	let handle;
	try {
		const response = await fetchImpl(source.url, {
			redirect: 'error', signal: AbortSignal.timeout(10 * 60 * 1_000),
		});
		if (!response.ok || !response.body) {
			throw new Error(`The pinned runtime source ${source.id} returned HTTP ${response.status}.`);
		}
		handle = await open(temporary, 'wx', 0o600);
		let length = 0;
		for await (const chunk of response.body) {
			if (!(chunk instanceof Uint8Array)) throw new TypeError('The runtime download is not a byte stream.');
			length += chunk.byteLength;
			if (length > source.byteLength) throw new Error(`The runtime source ${source.id} exceeds its pinned length.`);
			await handle.writeFile(chunk);
		}
		await handle.close(); handle = null;
		await verifySource(temporary, source);
		await rename(temporary, destination);
		return destination;
	} finally {
		await handle?.close();
		await rm(temporary, { force: true });
	}
}

async function verifySource(path, source) {
	const actual = await fingerprint(path);
	if (actual.byteLength !== source.byteLength || actual.sha256 !== source.sha256
		|| source.kind === 'npm-tarball' && `sha512-${actual.sha512}` !== source.integrity) {
		throw new Error(`The pinned runtime source ${source.id} failed integrity verification.`);
	}
}

async function extractPackage(source, files, archivePath, temporary) {
	const destination = join(temporary, source.destination);
	await mkdir(destination, { recursive: true });
	const expected = new Map(files.map((file) => [`package/${file.path}`, file]));
	const seen = new Set();
	await extract({
		file: archivePath, cwd: destination, strip: 1, strict: true,
		preservePaths: false, noChmod: true, noMtime: true,
		filter(path, entry) {
			if (!expected.has(path)) return false;
			if (entry.type !== 'File' || seen.has(path)
				|| entry.size !== expected.get(path).byteLength) {
				throw new Error(`The runtime archive entry ${path} is not one pinned regular file.`);
			}
			seen.add(path);
			return true;
		},
	});
	if (seen.size !== expected.size) throw new Error(`The runtime archive ${source.id} is missing pinned files.`);
}

async function verifyInventory(root, expected) {
	const actual = await inventory(root);
	if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.map(({ path }) => path).sort())) {
		throw new Error('The staged ONNX Runtime file inventory is not exact.');
	}
	for (const file of expected) {
		const actualFile = await fingerprint(join(root, file.path));
		if (actualFile.byteLength !== file.byteLength || actualFile.sha256 !== file.sha256) {
			throw new Error(`The staged ONNX Runtime file ${file.path} failed verification.`);
		}
	}
}

async function inventory(root, relative = '') {
	const result = [];
	for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
		const path = relative ? `${relative}/${entry.name}` : entry.name;
		if (entry.isSymbolicLink()) throw new Error('The runtime inventory contains a symbolic link.');
		if (entry.isDirectory()) result.push(...await inventory(root, path));
		else if (entry.isFile()) result.push(path);
		else throw new Error('The runtime inventory contains a non-regular file.');
	}
	return result;
}

async function fingerprint(path) {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size > MAXIMUM_SOURCE_BYTES) {
		throw new Error('The runtime source must be a bounded regular file.');
	}
	const sha256 = createHash('sha256');
	const sha512 = createHash('sha512');
	let byteLength = 0;
	for await (const chunk of createReadStream(path)) {
		byteLength += chunk.byteLength;
		if (byteLength > MAXIMUM_SOURCE_BYTES) throw new Error('The runtime source grew beyond its size limit.');
		sha256.update(chunk); sha512.update(chunk);
	}
	const after = await lstat(path);
	if (!after.isFile() || after.isSymbolicLink() || after.ino !== before.ino
		|| after.dev !== before.dev || after.size !== before.size || byteLength !== before.size
		|| after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
		throw new Error('The runtime source changed while it was being verified.');
	}
	return { byteLength, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') };
}

function selectedFiles(source, targetId) {
	return [...source.files, ...(source.targetFiles[targetId] ?? [])];
}

function validatePayloads(payloads) {
	if (payloads?.schemaVersion !== 1 || payloads.familyId !== 'onnxruntime-node'
		|| payloads.runtimeVersion !== '1.29.0' || !/^[a-f\d]{40}$/u.test(payloads.sourceRevision)
		|| !Array.isArray(payloads.sources) || payloads.sources.length < 1 || payloads.sources.length > 8) {
		throw new TypeError('The pinned ONNX Runtime source inventory is invalid.');
	}
	const ids = new Set();
	for (const source of payloads.sources) {
		if (typeof source.id !== 'string' || !/^[a-z\d-]+$/u.test(source.id) || ids.has(source.id)
			|| !['npm-tarball', 'file'].includes(source.kind)
			|| typeof source.url !== 'string' || !source.url.startsWith('https://')) {
			throw new TypeError('A pinned ONNX Runtime source identity is invalid.');
		}
		ids.add(source.id);
		validateFile({ path: source.destination, byteLength: source.byteLength, sha256: source.sha256 });
		if (source.kind === 'file') continue;
		if (typeof source.integrity !== 'string' || !/^sha512-[A-Za-z\d+/]{86}==$/u.test(source.integrity)
			|| !Array.isArray(source.files) || !source.targetFiles
			|| Object.keys(source.targetFiles).some((id) => !TARGETS.includes(id))) {
			throw new TypeError('The pinned runtime package integrity or file inventory is invalid.');
		}
		for (const files of [source.files, ...Object.values(source.targetFiles)]) {
			if (!Array.isArray(files) || files.length > 128) throw new TypeError('The runtime package files are invalid.');
			for (const file of files) validateFile(file);
		}
	}
}

function validateFile(file) {
	if (typeof file.path !== 'string' || file.path.length > 300
		|| !file.path.split('/').every((part) => /^[A-Za-z\d][A-Za-z\d._-]*$/u.test(part)
			&& part !== '.' && part !== '..')
		|| !Number.isSafeInteger(file.byteLength) || file.byteLength < 1
		|| file.byteLength > MAXIMUM_SOURCE_BYTES || !SHA256.test(file.sha256)) {
		throw new TypeError('A pinned runtime file path, length or digest is invalid.');
	}
}

function assertTarget(targetId) {
	if (!TARGETS.includes(targetId)) throw new TypeError('The ONNX Runtime desktop target is unsupported.');
}

function absoluteRoot(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be one normalized absolute path.`);
	}
	return value;
}

async function assertDirectory(path) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error('The runtime staging directory must be a real directory.');
	}
}
