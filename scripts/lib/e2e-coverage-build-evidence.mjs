/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	readFileSync,
	readdirSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';

import { E2E_EXECUTABLE_URL_PREFIX } from './e2e-coverage-contract.mjs';
import {
	DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS,
} from '../../desktop/renderer-smoke-execution.js';
import { assertE2EExecutableStringPolicy } from './e2e-dynamic-code-audit.mjs';
import { normalizeE2ESourceMap } from './e2e-coverage-source-maps.mjs';

export { normalizeE2ESourceMap } from './e2e-coverage-source-maps.mjs';

export const E2E_PRODUCTS = Object.freeze(['framescaper', 'soundscaper']);
const SCRIPT_PATTERN = /\.(?:c|m)?js$/u;
const BROWSER_PREFIX = `${E2E_EXECUTABLE_URL_PREFIX}browser/`;
const ELECTRON_PREFIX = `${E2E_EXECUTABLE_URL_PREFIX}electron/`;

export function loadE2EBuildEvidence({ repositoryRoot, evidenceRoot, sourceRevision }) {
	const browser = new Map();
	const electron = new Map();
	for (const productId of E2E_PRODUCTS) {
		browser.set(productId, loadBrowserEvidence({
			productId,
			repositoryRoot,
			root: join(evidenceRoot, 'browser', productId),
			sourceRevision,
		}));
		electron.set(productId, loadElectronEvidence({
			productId,
			repositoryRoot,
			root: join(evidenceRoot, 'electron', productId),
			sourceRevision,
		}));
	}
	return Object.freeze({
		browser,
		electron,
		digest: evidenceDigest(browser, electron, sourceRevision, true),
		executableDigest: evidenceDigest(browser, electron, sourceRevision, false),
		sourceRevision,
	});
}

function loadBrowserEvidence({ productId, repositoryRoot, root, sourceRevision }) {
	const siteRoot = join(root, 'site');
	const mapRoot = join(root, 'source-maps');
	const manifest = readJson(join(siteRoot, '.browser-product-build.json'), `${productId} browser manifest`);
	if (manifest.schemaVersion !== 2 || manifest.productId !== productId || !record(manifest.files)
		|| !record(manifest.sourceMaps) || manifest.sourceRevision !== sourceRevision
		|| typeof manifest.origin !== 'string') {
		throw new Error(`The ${productId} browser build evidence is invalid.`);
	}
	const actual = walkFiles(siteRoot)
		.map((path) => normalizedRelative(siteRoot, path))
		.filter((path) => path !== '.browser-product-build.json');
	const inventoried = Object.keys(manifest.files).sort();
	if (JSON.stringify(actual) !== JSON.stringify(inventoried)) {
		throw new Error(`The ${productId} browser evidence has an incomplete file inventory.`);
	}
	for (const path of actual) verifyFileRecord(
		join(siteRoot, path),
		manifest.files[path],
		`${productId} browser evidence is stale at ${path}`,
	);
	const scriptPaths = actual.filter((path) => SCRIPT_PATTERN.test(path));
	const mapPaths = walkFiles(mapRoot).filter((path) => path.endsWith('.map'));
	const actualMaps = mapPaths.map((path) => normalizedRelative(mapRoot, path));
	if (JSON.stringify(actualMaps) !== JSON.stringify(Object.keys(manifest.sourceMaps).sort())) {
		throw new Error(`The ${productId} browser evidence has an incomplete source-map inventory.`);
	}
	for (const path of actualMaps) verifyFileRecord(
		join(mapRoot, path),
		manifest.sourceMaps[path],
		`${productId} browser source-map evidence is stale at ${path}`,
	);
	const mapByScript = associateMaps(scriptPaths, mapPaths, mapRoot, `${productId} browser`);
	const scripts = scriptPaths.map((path) => descriptor({
		artifactPath: path,
		coverageUrl: `${BROWSER_PREFIX}${productId}/${encodePath(path)}`,
		inputFile: join(siteRoot, path),
		mapFile: mapByScript.get(path),
		packagedPath: null,
		productId,
		realm: 'renderer',
		repositoryRoot,
		runtime: 'browser',
		sourceRevision,
	}));
	const htmlResources = actual.filter((path) => /\.html?$/u.test(path)).map((path) => ({
		artifactPath: path,
		source: readFileSync(join(siteRoot, path), 'utf8'),
	}));
	assertE2EExecutableStringPolicy(scripts, {
		htmlResources,
		label: `${productId} browser`,
	});
	const electronScripts = scripts.map((script) => Object.freeze({
		...script,
		artifactPath: `browser-site/${script.artifactPath}`,
		coverageUrl: `${ELECTRON_PREFIX}${productId}/renderer-browser/${encodePath(script.artifactPath)}`,
		realm: 'renderer',
		runtime: 'electron',
	}));
	return Object.freeze({
		productId,
		origin: manifest.origin,
		siteDigest: hash(stableJson(manifest.files)),
		scripts: Object.freeze(scripts),
		scriptsByPath: new Map(scripts.map((script) => [script.artifactPath, script])),
		scriptsByUrl: new Map(scripts.map((script) => [script.coverageUrl, script])),
		electronScripts: Object.freeze(electronScripts),
		electronScriptsByPath: new Map(electronScripts.map((script) => [
			script.artifactPath.slice('browser-site/'.length),
			script,
		])),
	});
}

function loadElectronEvidence({ productId, repositoryRoot, root, sourceRevision }) {
	const manifest = readJson(join(root, 'manifest.json'), `${productId} Electron build manifest`);
	if (manifest.schemaVersion !== 2 || manifest.kind !== 'soundscaper-e2e-product-build-evidence'
		|| manifest.productId !== productId || manifest.sourceRevision !== sourceRevision
		|| !fileRecord(manifest.packageArchive) || !Array.isArray(manifest.scripts)
		|| !Array.isArray(manifest.sourceMaps)) {
		throw new Error(`The ${productId} Electron build evidence is invalid.`);
	}
	const declared = [...manifest.scripts, ...manifest.sourceMaps];
	const declaredPaths = declared.map(({ artifactPath }) => artifactPath).sort();
	const actualPaths = walkFiles(root)
		.map((path) => normalizedRelative(root, path))
		.filter((path) => path !== 'manifest.json');
	if (new Set(declaredPaths).size !== declaredPaths.length
		|| JSON.stringify(declaredPaths) !== JSON.stringify(actualPaths)) {
		throw new Error(`The ${productId} Electron evidence has an incomplete file inventory.`);
	}
	for (const entry of declared) {
		if (!safeRelativePath(entry.artifactPath)) {
			throw new Error(`The ${productId} Electron evidence contains an unsafe artifact path.`);
		}
		verifyFileRecord(
			join(root, entry.artifactPath),
			entry,
			`${productId} Electron evidence is stale at ${entry.artifactPath}`,
		);
	}
	const scriptEntries = manifest.scripts.map((entry) => {
		if (!['main', 'preload', 'renderer'].includes(entry.realm)
			|| !safeRelativePath(entry.packagedPath) || !SCRIPT_PATTERN.test(entry.artifactPath)) {
			throw new Error(`The ${productId} Electron evidence contains an invalid executable script.`);
		}
		return entry;
	});
	if (new Set(scriptEntries.map(({ packagedPath }) => packagedPath)).size !== scriptEntries.length) {
		throw new Error(`The ${productId} Electron evidence contains an ambiguous packaged path.`);
	}
	const rendererPaths = scriptEntries
		.filter(({ realm }) => realm === 'renderer')
		.map(({ artifactPath }) => artifactPath);
	const mapPaths = manifest.sourceMaps.map(({ artifactPath }) => join(root, artifactPath));
	const mapByScript = associateMaps(rendererPaths, mapPaths, root, `${productId} Electron renderer`);
	const scripts = scriptEntries.map((entry) => descriptor({
		artifactPath: entry.artifactPath,
		coverageUrl: `${ELECTRON_PREFIX}${productId}/${entry.realm}/${encodePath(entry.artifactPath)}`,
		inputFile: join(root, entry.artifactPath),
		mapFile: entry.realm === 'renderer' ? mapByScript.get(entry.artifactPath) : null,
		packagedPath: entry.packagedPath,
		productId,
		realm: entry.realm,
		repositoryRoot,
		runtime: 'electron',
		sourceRevision,
	}));
	validateE2EDynamicScriptExclusions(scripts, productId);
	return Object.freeze({
		packageArchive: Object.freeze({ ...manifest.packageArchive }),
		productId,
		scripts: Object.freeze(scripts),
		scriptsByArtifactPath: new Map(scripts.map((script) => [script.artifactPath, script])),
		scriptsByPackagedPath: new Map(scripts.map((script) => [script.packagedPath, script])),
	});
}

/** Refuse packaged evidence unless it contains only the closed recipe library. */
export function validateE2EDynamicScriptExclusions(scripts, productId = 'packaged product') {
	const source = scripts.map((script) => String(script?.source ?? '')).join('\n');
	const recipes = Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS);
	const approvedMarkers = new Set(recipes.map(({ marker }) => marker));
	const approvedPaths = new Set(recipes.map(({ pathPrefix }) => pathPrefix));
	const observedMarkers = source.match(/soundscaper-e2e-recipe:[a-z\d-]+/gu) ?? [];
	const observedPaths = source.match(/__e2e-excluded__\/[a-z\d-]+-v\d+-/gu) ?? [];
	const invalid = observedMarkers.some((marker) => !approvedMarkers.has(marker))
		|| observedPaths.some((path) => !approvedPaths.has(path));
	const countsAreInvalid = recipes.some(({ marker, pathPrefix, products }) => {
		const markerCount = observedMarkers.filter((value) => value === marker).length;
		const pathCount = observedPaths.filter((value) => value === pathPrefix).length;
		const required = productId === 'packaged product' || products.includes(productId);
		return markerCount !== pathCount || markerCount > 1 || (required && markerCount !== 1);
	});
	if (invalid || countsAreInvalid) {
		throw new Error(
			`The ${productId} Electron evidence has missing, duplicate, or unapproved dynamic-script recipes.`,
		);
	}
	assertE2EExecutableStringPolicy(scripts, {
		allowRendererRecipe: true,
		label: `${productId} Electron`,
	});
	return Object.freeze(observedMarkers.sort());
}

function descriptor({
	artifactPath,
	coverageUrl,
	inputFile,
	mapFile,
	packagedPath,
	productId,
	realm,
	repositoryRoot,
	runtime,
	sourceRevision,
}) {
	const source = readFileSync(inputFile, 'utf8');
	const normalizedMap = mapFile == null ? null : normalizeE2ESourceMap(
		readJson(mapFile, `source map ${basename(mapFile)}`),
		repositoryRoot,
		`${productId} ${runtime} ${artifactPath}`,
		sourceRevision,
	);
	// Only a map with executable first-party mappings can transfer ownership to
	// source files. Pure authenticated vendor maps stay external; every other
	// unmapped/non-code-source artifact is covered as its exact generated bytes.
	const generatedMap = normalizedMap !== null && (!normalizedMap.hasOriginalMappings
		|| normalizedMap.executableRepositorySourceCount === 0
			&& !normalizedMap.authenticatedThirdPartyOnly);
	const effectiveMap = generatedMap ? null : normalizedMap;
	const repositorySources = effectiveMap?.repositorySources ?? [];
	return Object.freeze({
		artifactPath,
		coverageUrl,
		inputFile,
		packagedPath,
		productId,
		realm,
		runtime,
		source,
		owned: effectiveMap === null || !effectiveMap.authenticatedThirdPartyOnly,
		sourceMap: effectiveMap === null ? null : Object.freeze({
			lineLengths: sourceLineLengths(source),
			data: effectiveMap.map,
			url: null,
		}),
		fullSourceMap: effectiveMap?.map ?? null,
		repositorySources: Object.freeze(repositorySources),
	});
}

function associateMaps(scriptPaths, mapFiles, mapRoot, label) {
	const scriptsByMapName = new Map();
	for (const path of scriptPaths) {
		const name = `${basename(path)}.map`;
		const paths = scriptsByMapName.get(name) ?? [];
		paths.push(path);
		scriptsByMapName.set(name, paths);
	}
	const result = new Map();
	for (const mapFile of mapFiles) {
		const name = basename(mapFile);
		const candidates = scriptsByMapName.get(name) ?? [];
		if (candidates.length === 0) throw new Error(`${label} source map ${name} has no executable script.`);
		if (candidates.length > 1) throw new Error(`${label} source map ${name} is ambiguous.`);
		result.set(candidates[0], isAbsolute(mapFile) ? mapFile : join(mapRoot, mapFile));
	}
	return result;
}

function verifyFileRecord(path, entry, label) {
	if (!fileRecord(entry)) {
		throw new Error(`${label}: its digest record is invalid.`);
	}
	const bytes = readFileSync(path);
	if (bytes.byteLength !== entry.byteLength || hash(bytes) !== entry.sha256) {
		throw new Error(`${label}.`);
	}
}

function fileRecord(entry) {
	return record(entry) && Number.isSafeInteger(entry.byteLength) && entry.byteLength >= 0
		&& typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(entry.sha256);
}

function walkFiles(root, directory = root) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...walkFiles(root, path));
		else if (entry.isFile()) files.push(path);
		else throw new Error(`E2E build evidence contains a non-file entry: ${path}.`);
	}
	return files.sort();
}

function normalizedRelative(root, path) {
	return relative(root, path).split(sep).join('/');
}

function safeRelativePath(value) {
	return typeof value === 'string' && value !== '' && !isAbsolute(value) && !value.includes('\\')
		&& !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function encodePath(path) {
	return path.split('/').map(encodeURIComponent).join('/');
}

function sourceLineLengths(value) {
	const lines = String(value).split('\n');
	if (lines.length > 1 && lines.at(-1) === '') lines.pop();
	return lines.map((line) => line.length);
}

function readJson(path, label) {
	try { return JSON.parse(readFileSync(path, 'utf8')); }
	catch (error) { throw new Error(`The ${label} is not readable JSON.`, { cause: error }); }
}

function hash(value) {
	return createHash('sha256').update(value).digest('hex');
}

function evidenceDigest(browser, electron, sourceRevision, includePackageArchives) {
	const products = E2E_PRODUCTS.map((productId) => ({
		productId,
		browserOrigin: browser.get(productId).origin,
		browserSite: browser.get(productId).siteDigest,
		browserScripts: browser.get(productId).scripts.map(digestibleScript),
		...(includePackageArchives ? { electronArchive: electron.get(productId).packageArchive } : {}),
		electronScripts: electron.get(productId).scripts.map(digestibleScript),
	}));
	return `sha256:${hash(stableJson({ products, sourceRevision }))}`;
}

function digestibleScript(script) {
	return {
		artifactPath: script.artifactPath,
		coverageUrl: script.coverageUrl,
		map: script.fullSourceMap === null ? null : hash(stableJson(script.fullSourceMap)),
		packagedPath: script.packagedPath,
		realm: script.realm,
		repositorySources: script.repositorySources,
		runtime: script.runtime,
		source: hash(script.source),
	};
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => (
			`${JSON.stringify(key)}:${stableJson(value[key])}`
		)).join(',')}}`;
	}
	return JSON.stringify(value);
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
