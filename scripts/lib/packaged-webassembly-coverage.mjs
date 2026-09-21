/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PRODUCTS = new Set(['framescaper', 'soundscaper']);
const WASM_PATH = /^(?:[A-Za-z\d][A-Za-z\d._~-]*\/)*[A-Za-z\d][A-Za-z\d._~-]*\.wasm$/u;

/** Authenticate Wasm bytes against the exact installed Resources file CDP names. */
export function createPackagedWebAssemblyAuthenticator({
	allowAppUrl = false,
	allowFileUrl = false,
	productId,
	resourcesRoot,
	webAssemblyResources,
}) {
	if (!PRODUCTS.has(productId) || typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)
		|| (!allowAppUrl && !allowFileUrl) || !validRecords(webAssemblyResources)) {
		throw new TypeError('Packaged WebAssembly coverage received an invalid resource identity.');
	}
	const root = resolve(resourcesRoot);
	const appPrefix = `${productId}-app://bundle/`;
	return async ({ bytes, url }) => {
		if (!Buffer.isBuffer(bytes) || typeof url !== 'string') {
			throw new TypeError('Packaged WebAssembly coverage requires captured binary bytes and a URL.');
		}
		let path = null;
		let packagedPath = null;
		if (allowAppUrl && url.startsWith(appPrefix)) {
			const artifactPath = url.slice(appPrefix.length);
			if (WASM_PATH.test(artifactPath) && url === `${appPrefix}${artifactPath}`) {
				packagedPath = artifactPath.startsWith('runtime/')
					? artifactPath : `renderer/${artifactPath}`;
				path = resolve(root, packagedPath);
			}
		}
		if (path === null && allowFileUrl) {
			const file = packagedFileWasmPath(url, root);
			if (file !== null) ({ packagedPath, path } = file);
		}
		const record = webAssemblyResources.find(({ path: name }) => name === packagedPath);
		if (path === null || record === undefined) {
			throw new Error(`Packaged coverage rejected unapproved WebAssembly URL ${String(url)}.`);
		}
		const [canonicalRoot, canonicalPath, status, installed] = await Promise.all([
			realpath(root), realpath(path), lstat(path), readFile(path),
		]);
		if (!status.isFile() || !canonicalPath.startsWith(`${canonicalRoot}${sep}`)
			|| installed.byteLength !== record.byteLength || digest(installed) !== record.sha256
			|| bytes.byteLength !== installed.byteLength || !timingSafeEqual(bytes, installed)) {
			throw new Error('Captured packaged WebAssembly differs from its installed regular file.');
		}
		return true;
	};
}

function packagedFileWasmPath(url, root) {
	let parsed;
	try { parsed = new URL(url); } catch { return null; }
	if (parsed.protocol !== 'file:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
	let path;
	try { path = fileURLToPath(parsed); } catch { return null; }
	if (pathToFileURL(path).href !== url) return null;
	const child = relative(root, path).split(sep).join('/');
	if (!WASM_PATH.test(child) || child.startsWith('../') || isAbsolute(child)) return null;
	return { packagedPath: child, path: resolve(root, child) };
}

function validRecords(value) {
	return Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object'
		&& Object.keys(entry).sort().join(',') === 'byteLength,path,sha256'
		&& WASM_PATH.test(entry.path) && Number.isSafeInteger(entry.byteLength) && entry.byteLength > 0
		&& /^[a-f\d]{64}$/u.test(entry.sha256))
		&& new Set(value.map(({ path }) => path)).size === value.length
		&& value.map(({ path }) => path).join('\0') === value.map(({ path }) => path).toSorted().join('\0');
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
