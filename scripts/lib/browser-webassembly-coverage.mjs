/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { repositoryRevision } from './e2e-coverage-integrity.mjs';

const BUILD_EVIDENCE = '.browser-product-build.json';
const PRODUCT_IDS = new Set(['framescaper', 'soundscaper']);
const REVISION = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const WASM_PATH = /^(?:[A-Za-z\d][A-Za-z\d._~-]*\/)*[A-Za-z\d][A-Za-z\d._~-]*\.wasm$/u;

/**
 * Authenticate the only network URLs that CDP may classify as WebAssembly.
 * First-party modules are bound to an exact verified product-build file;
 * external FFmpeg stays on its separate committed manifest/policy identity.
 */
export function createBrowserWebAssemblyAuthenticator({
	expectedSourceRevision = null,
	ffmpegCoverage,
	repositoryRoot = process.cwd(),
	sites = [],
}) {
	if (!isAbsolute(repositoryRoot) || (expectedSourceRevision !== null
		&& !REVISION.test(expectedSourceRevision))) {
		throw new TypeError('Browser WebAssembly coverage received an invalid repository identity.');
	}
	const builds = new Map();
	const products = new Set();
	for (const site of sites) {
		if (!site || !PRODUCT_IDS.has(site.productId) || typeof site.origin !== 'string'
			|| new URL(site.origin).origin !== site.origin
			|| typeof site.outputDirectory !== 'string' || site.outputDirectory === ''
			|| builds.has(site.origin) || products.has(site.productId)) {
			throw new TypeError('Browser WebAssembly coverage received an invalid product site.');
		}
		products.add(site.productId);
		builds.set(site.origin, Object.freeze({
			origin: site.origin,
			outputDirectory: resolve(repositoryRoot, site.outputDirectory),
			productId: site.productId,
		}));
	}
	const builtAssets = new Map();
	let revision = null;
	return async ({ bytes, url }) => {
		if (!Buffer.isBuffer(bytes)) {
			throw new TypeError('Browser WebAssembly coverage requires captured binary bytes.');
		}
		if (url === ffmpegCoverage.wasm.url) {
			assertPinnedBytes(bytes, ffmpegCoverage.wasm, 'pinned FFmpeg WebAssembly');
			return true;
		}
		const resolved = resolveBuiltWasmUrl(url, builds);
		if (resolved === null) {
			throw new Error(`Browser coverage rejected unapproved WebAssembly URL ${String(url)}.`);
		}
		const cacheKey = `${resolved.origin}\0${resolved.outputDirectory}\0${resolved.artifactPath}`;
		let built = builtAssets.get(cacheKey);
		if (built === undefined) {
			revision ??= expectedSourceRevision === null
				? expectedBrowserCoverageRevision(repositoryRoot) : Promise.resolve(expectedSourceRevision);
			built = loadBuiltWasm(resolved, await revision);
			builtAssets.set(cacheKey, built);
		}
		const admitted = await built;
		assertPinnedBytes(bytes, admitted.record, `${resolved.productId} built WebAssembly`);
		if (bytes.byteLength !== admitted.bytes.byteLength
			|| !timingSafeEqual(bytes, admitted.bytes)) {
			throw new Error(`Captured ${resolved.productId} WebAssembly bytes differ from the inventoried build file.`);
		}
		return true;
	};
}

function resolveBuiltWasmUrl(url, builds) {
	let parsed;
	try { parsed = new URL(url); } catch { return null; }
	const site = builds.get(parsed.origin);
	if (site === undefined || parsed.protocol !== 'http:' || parsed.username || parsed.password
		|| parsed.search || parsed.hash || url !== parsed.href) return null;
	const artifactPath = parsed.pathname.slice(1);
	if (!WASM_PATH.test(artifactPath) || url !== `${site.origin}/${artifactPath}`) return null;
	const path = resolve(site.outputDirectory, artifactPath);
	if (!path.startsWith(`${site.outputDirectory}${sep}`)) return null;
	return Object.freeze({ ...site, artifactPath, path });
}

async function loadBuiltWasm({ artifactPath, origin, path, outputDirectory, productId }, sourceRevision) {
	let manifest;
	try {
		manifest = JSON.parse(await readFile(resolve(outputDirectory, BUILD_EVIDENCE), 'utf8'));
	} catch (error) {
		throw new Error(`The ${productId} browser build evidence is unreadable.`, { cause: error });
	}
	if (manifest?.schemaVersion !== 2 || manifest.productId !== productId
		|| manifest.origin !== origin || manifest.sourceRevision !== sourceRevision
		|| !plainRecord(manifest.files)) {
		throw new Error(`The ${productId} browser build evidence cannot authenticate WebAssembly.`);
	}
	const record = manifest.files[artifactPath];
	if (!exactFileRecord(record)) {
		throw new Error(`The ${productId} browser build does not inventory WebAssembly ${artifactPath}.`);
	}
	let canonicalRoot;
	let canonicalPath;
	let status;
	let bytes;
	try {
		[canonicalRoot, canonicalPath, status, bytes] = await Promise.all([
			realpath(outputDirectory), realpath(path), lstat(path), readFile(path),
		]);
	} catch (error) {
		throw new Error(`The inventoried ${productId} WebAssembly file is unreadable.`, { cause: error });
	}
	if (!status.isFile() || !canonicalPath.startsWith(`${canonicalRoot}${sep}`)) {
		throw new Error(`The inventoried ${productId} WebAssembly path is not a regular file.`);
	}
	assertPinnedBytes(bytes, record, `${productId} inventoried WebAssembly file`);
	return Object.freeze({ bytes, record: Object.freeze({ ...record }) });
}

function assertPinnedBytes(bytes, descriptor, label) {
	if (!pinnedDescriptor(descriptor) || bytes.byteLength !== descriptor.byteLength
		|| sha256(bytes) !== descriptor.sha256) {
		throw new Error(`${label} does not match its authenticated byte identity.`);
	}
}

function pinnedDescriptor(value) {
	return plainRecord(value) && Number.isSafeInteger(value.byteLength) && value.byteLength > 0
		&& SHA256.test(value.sha256);
}

function exactFileRecord(value) {
	return pinnedDescriptor(value) && Object.keys(value).sort().join(',') === 'byteLength,sha256';
}

function plainRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function expectedBrowserCoverageRevision(repositoryRoot) {
	try {
		const stage = JSON.parse(await readFile(resolve(repositoryRoot, 'stage-manifest.json'), 'utf8'));
		if (stage?.kind !== 'soundscaper-desktop-nightly-tests'
			|| !REVISION.test(stage.sourceRevision ?? '')) {
			throw new Error('The nightly test stage has no authenticated source revision.');
		}
		return stage.sourceRevision;
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		return repositoryRevision(repositoryRoot);
	}
}
