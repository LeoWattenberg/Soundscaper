/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { assertE2EHtmlExecutablePolicy } from './e2e-dynamic-code-audit.mjs';
import { packagedExecutableResourceIdentity } from './packaged-executable-resource-identity.mjs';

const HTML_PATTERN = /\.html?$/u;
const SCRIPT_PATTERN = /\.(?:c|m)?js$/u;
const WASM_PATTERN = /\.wasm$/u;

/** Validate the external executable tree claimed by packaged build evidence. */
export function loadE2EPackagedResourceEvidence({ manifest, productId, root, scripts }) {
	if (!exactResourceIdentity(manifest.executableResources)
		|| !Array.isArray(manifest.excludedRuntimeScripts)
		|| !Array.isArray(manifest.documents)
		|| !Array.isArray(manifest.webAssemblyResources)) {
		throw new Error(`The ${productId} Electron build evidence has invalid executable resources.`);
	}
	const excludedRuntimeScripts = manifest.excludedRuntimeScripts.map((entry) => {
		if (!exactKeys(entry, ['byteLength', 'path', 'sha256']) || !safeRelativePath(entry.path)
			|| !entry.path.startsWith('runtime/') || !SCRIPT_PATTERN.test(entry.path)
			|| !fileRecord(entry)) {
			throw new Error(`The ${productId} Electron evidence has an invalid runtime-script exclusion.`);
		}
		return Object.freeze({ ...entry });
	});
	assertCanonicalPaths(excludedRuntimeScripts, 'path', `${productId} runtime-script exclusions`);

	const documents = manifest.documents.map((entry) => {
		if (!exactKeys(entry, ['artifactPath', 'byteLength', 'packagedPath', 'sha256'])
			|| !safeRelativePath(entry.artifactPath) || !safeRelativePath(entry.packagedPath)
			|| !HTML_PATTERN.test(entry.artifactPath) || !validDocumentLocation(entry)
			|| !fileRecord(entry)) {
			throw new Error(`The ${productId} Electron evidence has an invalid HTML document.`);
		}
		return Object.freeze({ ...entry });
	});
	assertCanonicalPaths(documents, 'artifactPath', `${productId} Electron documents`);
	if (new Set(documents.map(({ packagedPath }) => packagedPath)).size !== documents.length) {
		throw new Error(`The ${productId} Electron evidence has an ambiguous document path.`);
	}
	assertE2EHtmlExecutablePolicy(documents.map(({ artifactPath }) => ({
		artifactPath,
		source: readFileSync(join(root, artifactPath), 'utf8'),
	})), { label: `${productId} Electron` });
	const webAssemblyResources = manifest.webAssemblyResources.map((entry) => {
		if (!exactKeys(entry, ['artifactPath', 'byteLength', 'packagedPath', 'sha256'])
			|| !safeRelativePath(entry.artifactPath) || !safeRelativePath(entry.packagedPath)
			|| !WASM_PATTERN.test(entry.packagedPath)
			|| entry.artifactPath !== `webassembly/${entry.packagedPath}`
			|| !/^(?:renderer|runtime)\//u.test(entry.packagedPath) || !fileRecord(entry)) {
			throw new Error(`The ${productId} Electron evidence has invalid WebAssembly.`);
		}
		return Object.freeze({ ...entry });
	});
	assertCanonicalPaths(webAssemblyResources, 'packagedPath', `${productId} Electron WebAssembly`);

	const externalFiles = [
		...scripts.filter(({ realm }) => realm === 'renderer').map(resourceRecord),
		...documents.filter(({ packagedPath }) => !packagedPath.startsWith('app.asar/')).map(resourceRecord),
		...excludedRuntimeScripts,
		...webAssemblyResources.map(resourceRecord),
	].sort(comparePath);
	let identity;
	try {
		identity = packagedExecutableResourceIdentity(externalFiles);
	} catch (error) {
		throw new Error(`The ${productId} Electron executable-resource inventory is ambiguous.`, { cause: error });
	}
	if (stableJson(identity) !== stableJson(manifest.executableResources)) {
		throw new Error(`The ${productId} Electron executable-resource identity is inconsistent.`);
	}
	return Object.freeze({
		documents: Object.freeze(documents),
		excludedRuntimeScripts: Object.freeze(excludedRuntimeScripts),
		excludedRuntimeScriptsByPath: new Map(excludedRuntimeScripts.map((entry) => [entry.path, entry])),
		executableResources: Object.freeze({ ...manifest.executableResources }),
		webAssemblyResources: Object.freeze(webAssemblyResources),
		webAssemblyResourcesByPackagedPath: new Map(webAssemblyResources.map((entry) => [entry.packagedPath, entry])),
	});
}

export function validE2EPackagedScriptLocation(entry) {
	if (entry.realm === 'renderer') {
		return entry.artifactPath.startsWith('renderer/')
			&& entry.packagedPath === entry.artifactPath;
	}
	return entry.artifactPath.startsWith('app/')
		&& entry.packagedPath === `app.asar/${entry.artifactPath.slice('app/'.length)}`;
}

function validDocumentLocation(entry) {
	if (entry.artifactPath.startsWith('app/')) {
		return entry.packagedPath === `app.asar/${entry.artifactPath.slice('app/'.length)}`;
	}
	return (entry.artifactPath.startsWith('renderer/') || entry.artifactPath.startsWith('runtime/'))
		&& entry.packagedPath === entry.artifactPath;
}

function resourceRecord({ byteLength, packagedPath: path, sha256 }) {
	return { path, byteLength, sha256 };
}

function exactResourceIdentity(value) {
	return exactKeys(value, ['fileCount', 'sha256', 'totalBytes'])
		&& Number.isSafeInteger(value.fileCount) && value.fileCount >= 0
		&& Number.isSafeInteger(value.totalBytes) && value.totalBytes >= 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

function fileRecord(value) {
	return Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

function assertCanonicalPaths(values, key, label) {
	const paths = values.map((value) => value[key]);
	if (stableJson(paths) !== stableJson([...new Set(paths)].sort(compareText))) {
		throw new Error(`The ${label} are not uniquely sorted by path.`);
	}
}

function safeRelativePath(value) {
	return typeof value === 'string' && value !== '' && !isAbsolute(value) && !value.includes('\\')
		&& !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function exactKeys(value, keys) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& stableJson(Object.keys(value).sort()) === stableJson(keys);
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => (
			`${JSON.stringify(key)}:${stableJson(value[key])}`
		)).join(',')}}`;
	}
	return JSON.stringify(value);
}

function comparePath(left, right) {
	return compareText(left.path, right.path);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
