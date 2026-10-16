/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared, authenticated native ORT core, WebGPU plugin and C API headers. */

import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { extract } from 'tar';

import pinnedPayloads from '../../config/assistance-onnx-runtime-payloads.json' with { type: 'json' };
import pinnedPlugin from '../../config/assistance-onnx-webgpu-plugin.json' with { type: 'json' };

const TARGETS = ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'];
const MAXIMUM_BYTES = 256 * 1024 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function createDesktopAssistanceOnnxNativeClosureManifest(
	targetId, payloads = pinnedPayloads, pluginRecipe = pinnedPlugin,
) {
	if (!TARGETS.includes(targetId)) throw new TypeError('The native ONNX target is unsupported.');
	if (payloads.runtimeVersion !== '1.29.0' || payloads.sourceRevision !== pinnedPayloads.sourceRevision
		|| pluginRecipe.schemaVersion !== 1 || pluginRecipe.version !== '0.4.0'
		|| pluginRecipe.sourceRevision !== payloads.sourceRevision || !pluginRecipe.targets[targetId]) {
		throw new TypeError('The native ONNX closure source identity is invalid.');
	}
	const core = payloads.sources.find(({ id }) => id === 'onnxruntime-node');
	const libraries = core?.targetFiles[targetId]?.filter(({ path }) => (
		/\/(?:libonnxruntime[^/]*\.(?:so(?:\.1)?|dylib)|onnxruntime\.dll|dxcompiler\.dll|dxil\.dll)$/u.test(path)
	)) ?? [];
	if (!libraries.some(({ path }) => /\/(?:libonnxruntime|onnxruntime\.dll)/u.test(path))) {
		throw new TypeError('The native ONNX core library inventory is missing.');
	}
	const notices = payloads.sources.filter(({ kind, id }) => kind === 'file'
		&& (!id.startsWith('directx-') || targetId.startsWith('win-')));
	const files = [
		...libraries.map((file) => ({ ...file, path: basename(file.path) })),
		...notices.map(({ destination, byteLength, sha256 }) => ({ path: basename(destination), byteLength, sha256 })),
		...pluginRecipe.files.map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
		(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 }))(pluginRecipe.targets[targetId]),
	].sort((left, right) => left.path.localeCompare(right.path, 'en'));
	for (const file of files) validatePin(file);
	for (const source of [core, pluginRecipe.archive, ...notices, ...pluginRecipe.headers]) validateSource(source);
	for (const header of pluginRecipe.headers) validatePath(header.path);
	if (new Set(files.map(({ path }) => path)).size !== files.length) {
		throw new TypeError('The native ONNX closure has repeated paths.');
	}
	return {
		files,
		sourcePins: [core, pluginRecipe.archive, ...notices, ...pluginRecipe.headers]
			.map(({ id, url, byteLength, sha256 }) => ({ id, url, byteLength, sha256 })),
	};
}

export async function prepareDesktopAssistanceOnnxNativeClosure({
	targetId, outputRoot, cacheRoot, fetchImpl = globalThis.fetch,
	payloads = pinnedPayloads, pluginRecipe = pinnedPlugin,
}) {
	const manifest = createDesktopAssistanceOnnxNativeClosureManifest(targetId, payloads, pluginRecipe);
	assertRoot(outputRoot); assertRoot(cacheRoot);
	await mkdir(cacheRoot, { recursive: true });
	await assertDirectory(cacheRoot);
	await mkdir(outputRoot, { recursive: true });
	await assertDirectory(outputRoot);
	const core = payloads.sources.find(({ id }) => id === 'onnxruntime-node');
	const libraries = new Map(core.targetFiles[targetId]
		.filter(({ path }) => manifest.files.some((file) => file.path === basename(path)))
		.map((file) => [`package/${file.path}`, file]));
	const seen = new Set();
	await extract({
		file: await authenticatedOnnxSource(core, cacheRoot, fetchImpl), cwd: outputRoot,
		strict: true, preservePaths: false, noChmod: true, noMtime: true,
		filter(path, entry) {
			const expected = libraries.get(path);
			if (!expected) return false;
			if (entry.type !== 'File' || entry.size !== expected.byteLength || seen.has(path)) {
				throw new Error('The native ONNX core archive entry is invalid.');
			}
			seen.add(path);
			entry.path = basename(path);
			return true;
		},
	});
	if (seen.size !== libraries.size) throw new Error('The native ONNX core archive is missing pinned libraries.');
	for (const source of payloads.sources.filter(({ kind, destination }) => kind === 'file'
		&& manifest.files.some(({ path }) => path === basename(destination)))) {
		await copyFile(await authenticatedOnnxSource(source, cacheRoot, fetchImpl), join(outputRoot, basename(source.destination)));
	}
	const selected = [...pluginRecipe.files, pluginRecipe.targets[targetId]];
	const archive = await readFile(await authenticatedOnnxSource(pluginRecipe.archive, cacheRoot, fetchImpl));
	const expected = new Map(selected.map((file) => [file.sourcePath, file]));
	const contents = unzipSync(archive, { filter: ({ name, originalSize }) => {
		const pin = expected.get(name);
		if (!pin) return false;
		if (originalSize !== pin.byteLength) throw new Error('The WebGPU plugin archive entry length failed verification.');
		return true;
	} });
	for (const file of selected) {
		const bytes = contents[file.sourcePath];
		verifyBytes(bytes, file, 'WebGPU plugin file verification');
		await writeFile(join(outputRoot, file.path), bytes);
	}
	const headerRoot = join(cacheRoot, `onnx-headers-${payloads.sourceRevision}`);
	await mkdir(headerRoot, { recursive: true });
	await assertDirectory(headerRoot);
	for (const header of pluginRecipe.headers) {
		await copyFile(await authenticatedOnnxSource(header, cacheRoot, fetchImpl), join(headerRoot, basename(header.path)));
	}
	for (const file of manifest.files) verifyBytes(await readFile(join(outputRoot, file.path)), file, 'native ONNX file verification');
	const library = manifest.files.find(({ path }) => targetId.startsWith('win-') ? path === 'onnxruntime.dll'
		: targetId.startsWith('mac-') ? path === 'libonnxruntime.1.29.0.dylib' : path === 'libonnxruntime.so.1');
	return {
		...manifest, includeRoot: headerRoot,
		libraryPath: join(outputRoot, library.path), pluginPath: join(outputRoot, pluginRecipe.targets[targetId].path),
	};
}

/** Cache entries are verified on every read, including a concurrent writer's result. */
export async function authenticatedOnnxSource(source, cacheRoot, fetchImpl = globalThis.fetch) {
	validateSource(source);
	assertRoot(cacheRoot);
	await mkdir(cacheRoot, { recursive: true });
	await assertDirectory(cacheRoot);
	const path = join(cacheRoot, source.sha256);
	try {
		await verifyFile(path, source);
		return path;
	} catch (error) { if (error.code !== 'ENOENT') throw error; }
	const response = await fetchImpl(source.url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
	if (!response.ok || !response.body) throw new Error(`The ONNX source ${source.id} returned HTTP ${response.status}.`);
	const chunks = []; let length = 0;
	for await (const chunk of response.body) {
		if (!(chunk instanceof Uint8Array) || (length += chunk.byteLength) > source.byteLength) {
			throw new Error('The ONNX source exceeds its pinned byte length.');
		}
		chunks.push(chunk);
	}
	const bytes = Buffer.concat(chunks);
	verifyBytes(bytes, source, 'ONNX source integrity');
	if (source.integrity && `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== source.integrity) {
		throw new Error('The ONNX source npm integrity is invalid.');
	}
	const temporary = join(cacheRoot, `.download-${randomUUID()}`);
	try {
		await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
		await rename(temporary, path);
	} finally { await rm(temporary, { force: true }); }
	await verifyFile(path, source);
	return path;
}

async function verifyFile(path, source) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== source.byteLength) {
		throw new Error('The cached ONNX source integrity is invalid.');
	}
	const bytes = await readFile(path);
	verifyBytes(bytes, source, 'ONNX source integrity');
	if (source.integrity && `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== source.integrity) {
		throw new Error('The cached ONNX source npm integrity is invalid.');
	}
}

function verifyBytes(bytes, pin, label) {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength !== pin.byteLength || hash(bytes) !== pin.sha256) {
		throw new Error(`The ${label} failed.`);
	}
}

function validateSource(source) {
	if (!source || typeof source.id !== 'string' || typeof source.url !== 'string'
		|| !source.url.startsWith('https://')) throw new TypeError('The native ONNX source identity is invalid.');
	validatePin({ ...source, path: source.path ?? source.destination ?? source.id });
}

function validatePin(pin) {
	validatePath(pin.path);
	if (!Number.isSafeInteger(pin.byteLength) || pin.byteLength < 1 || pin.byteLength > MAXIMUM_BYTES
		|| !/^[a-f\d]{64}$/u.test(pin.sha256)) throw new TypeError('The native ONNX file pin is invalid.');
}

function validatePath(path) {
	if (typeof path !== 'string' || !path.split('/').every((part) => /^[A-Za-z\d][A-Za-z\d._-]*$/u.test(part)
		&& part !== '.' && part !== '..')) throw new TypeError('The native ONNX file path is invalid.');
}

function assertRoot(path) {
	if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
		throw new TypeError('The native ONNX root must be a normalized absolute path.');
	}
}

async function assertDirectory(path) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('The native ONNX directory is not real.');
}
