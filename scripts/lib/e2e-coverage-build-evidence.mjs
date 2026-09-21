/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
	E2E_EXECUTABLE_URL_PREFIX,
	E2E_REPOSITORY_URL_PREFIX,
} from './e2e-coverage-contract.mjs';
import { revisionBoundSource } from './e2e-coverage-integrity.mjs';
import {
	DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS,
} from '../../desktop/renderer-smoke-execution.js';

export const E2E_PRODUCTS = Object.freeze(['framescaper', 'soundscaper']);
const SCRIPT_PATTERN = /\.(?:c|m)?js$/u;
const EXECUTABLE_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;
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
	const repositorySources = normalizedMap?.repositorySources ?? [];
	return Object.freeze({
		artifactPath,
		coverageUrl,
		inputFile,
		packagedPath,
		productId,
		realm,
		runtime,
		source,
		owned: normalizedMap === null || repositorySources.length > 0,
		sourceMap: normalizedMap === null ? null : Object.freeze({
			lineLengths: sourceLineLengths(source),
			data: normalizedMap.map,
			url: null,
		}),
		fullSourceMap: normalizedMap?.map ?? null,
		repositorySources: Object.freeze(repositorySources),
	});
}

export function normalizeE2ESourceMap(map, repositoryRoot, label, sourceRevision) {
	if (!record(map) || map.version !== 3 || !Array.isArray(map.sources)
		|| typeof map.mappings !== 'string'
		|| !Array.isArray(map.x_soundscaper_source_sha256)
		|| map.x_soundscaper_source_sha256.length !== map.sources.length
		|| (map.sourcesContent !== undefined && (!Array.isArray(map.sourcesContent)
			|| map.sourcesContent.length !== map.sources.length))) {
		throw new Error(`${label} has an invalid source map.`);
	}
	const sources = [];
	const sourcesContent = [];
	const repositorySources = new Set();
	for (const [index, source] of map.sources.entries()) {
		const normalized = normalizeMapSource({
			content: map.sourcesContent?.[index],
			digest: map.x_soundscaper_source_sha256[index],
			label,
			repositoryRoot,
			source,
			sourceRevision,
		});
		sources.push(normalized.url);
		sourcesContent.push(normalized.content);
		if (normalized.executableRepositoryPath !== null) {
			repositorySources.add(normalized.executableRepositoryPath);
		}
	}
	return Object.freeze({
		map: Object.freeze({ ...map, sourceRoot: '', sources, sourcesContent }),
		repositorySources: Object.freeze([...repositorySources].sort()),
	});
}

function normalizeMapSource({ content, digest, label, repositoryRoot, source, sourceRevision }) {
	if (typeof source !== 'string' || source === '') return externalSource(source, content ?? null);
	if (source.startsWith(E2E_REPOSITORY_URL_PREFIX)) {
		return repositorySource(
			decodeURIComponent(source.slice(E2E_REPOSITORY_URL_PREFIX.length)),
			repositoryRoot,
			label,
			content,
			digest,
			sourceRevision,
		);
	}
	let pathname;
	try { pathname = decodeURIComponent(new URL(source).pathname).replaceAll('\\', '/'); }
	catch { return externalSource(source, null); }
	for (const externalRoot of ['node_modules', 'vendor']) {
		const marker = `/${externalRoot}/`;
		const at = pathname.lastIndexOf(marker);
		if (at < 0) continue;
		const path = `${externalRoot}/${pathname.slice(at + marker.length)}`;
		return externalSource(
			`file:///__soundscaper_external__/${encodePath(path)}`,
			typeof content === 'string' ? content : null,
		);
	}
	for (const root of ['src', 'desktop']) {
		const marker = `/${root}/`;
		const at = pathname.lastIndexOf(marker);
		if (at < 0) continue;
		const prefix = pathname.slice(0, at);
		if (/(?:^|\/)\.(?:wrangler|desktop-build)(?:\/|$)|(?:^|\/)dist(?:\/|$)/u.test(prefix)) {
			throw new Error(`${label} maps through a stale nested build path: ${source}.`);
		}
		return repositorySource(
			pathname.slice(at + 1), repositoryRoot, label, content, digest, sourceRevision,
		);
	}
	if (EXECUTABLE_SOURCE_PATTERN.test(pathname)) {
		throw new Error(`${label} has mapped first-party source ${source} outside src/ and desktop/.`);
	}
	const repositoryMarker = `/${basename(repositoryRoot)}/`;
	const repositoryAt = pathname.toLowerCase().lastIndexOf(repositoryMarker.toLowerCase());
	if (repositoryAt >= 0) {
		const path = pathname.slice(repositoryAt + repositoryMarker.length);
		return externalSource(
			`file:///__soundscaper_external__/repository-noncode/${encodePath(path)}`,
			typeof content === 'string' ? content : null,
		);
	}
	return externalSource(source, typeof content === 'string' ? content : null);
}

function repositorySource(path, repositoryRoot, label, embedded, expectedDigest, sourceRevision) {
	if (!safeRelativePath(path) || (!path.startsWith('src/') && !path.startsWith('desktop/'))) {
		throw new Error(`${label} has an unsafe repository source ${path}.`);
	}
	const candidate = resolve(repositoryRoot, path);
	if (!existsSync(candidate) || !lstatSync(candidate).isFile()) {
		throw new Error(`${label} maps missing repository source ${path}.`);
	}
	const source = revisionBoundSource(repositoryRoot, sourceRevision, path);
	if (expectedDigest !== source.sha256.slice('sha256:'.length)) {
		throw new Error(`${label} has stale build-time source bytes for ${path}.`);
	}
	if (embedded !== undefined && embedded !== source.text) {
		throw new Error(`${label} has stale embedded source bytes for ${path}.`);
	}
	return {
		url: `${E2E_REPOSITORY_URL_PREFIX}${encodePath(path)}`,
		content: source.text,
		executableRepositoryPath: EXECUTABLE_SOURCE_PATTERN.test(path) && !/\.d\.[cm]?ts$/u.test(path)
			? path : null,
	};
}

function externalSource(url, content) {
	return { url, content, executableRepositoryPath: null };
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
