/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, lstatSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

import { revisionBoundSource } from './e2e-coverage-integrity.mjs';
import { E2E_REPOSITORY_URL_PREFIX } from './e2e-coverage-prefixes.mjs';

const EXECUTABLE_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;

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
	const normalizedSources = [];
	const repositorySources = new Set();
	const declaredRepositorySources = new Set();
	const thirdPartyExecutableSources = new Set();
	const thirdPartyMappedSources = new Set();
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
		normalizedSources.push(normalized);
		if (normalized.repositoryPath !== null) declaredRepositorySources.add(normalized.repositoryPath);
	}
	const mappedIndices = new Set(mappedE2ESourceMapEntries(map, label).map(({ index }) => index));
	for (const index of mappedIndices) {
		const normalized = normalizedSources[index];
		if (normalized.executableRepositoryPath !== null) {
			repositorySources.add(normalized.executableRepositoryPath);
		}
		if (normalized.executableThirdPartyPath !== null) {
			thirdPartyExecutableSources.add(normalized.executableThirdPartyPath);
		}
		if (normalized.thirdPartyPath !== null) thirdPartyMappedSources.add(index);
	}
	const hasOriginalMappings = mappedIndices.size > 0;
	const authenticatedThirdPartyOnly = hasOriginalMappings && declaredRepositorySources.size === 0
		&& thirdPartyMappedSources.size === mappedIndices.size;
	return Object.freeze({
		authenticatedThirdPartyOnly,
		executableRepositorySourceCount: repositorySources.size,
		executableThirdPartySourceCount: thirdPartyExecutableSources.size,
		hasOriginalMappings,
		map: Object.freeze({ ...map, sourceRoot: '', sources, sourcesContent }),
		repositorySourceCount: declaredRepositorySources.size,
		repositorySources: Object.freeze([...repositorySources].sort()),
	});
}

/** Return only the source entries that original-mapping segments actually reference. */
export function mappedE2ESourceMapEntries(map, label = 'source map') {
	if (!record(map) || !Array.isArray(map.sources) || typeof map.mappings !== 'string') {
		throw new Error(`${label} has an invalid source map.`);
	}
	return Object.freeze([...mappedSourceIndices(map.mappings, map.sources.length, label)]
		.sort((left, right) => left - right)
		.map((index) => Object.freeze({ index, source: map.sources[index] })));
}

function normalizeMapSource({ content, digest, label, repositoryRoot, source, sourceRevision }) {
	if (typeof source !== 'string' || source === '') return externalSource(source, content ?? null);
	if (source.startsWith(E2E_REPOSITORY_URL_PREFIX)) {
		const path = decodeURIComponent(source.slice(E2E_REPOSITORY_URL_PREFIX.length));
		if (generatedRepositoryPath(path)) return generatedRepositorySource(path, content);
		return repositorySource(
			path,
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
	if (pathname.endsWith('/__vite-browser-external')) {
		return externalSource(
			'file:///__soundscaper_external__/vite-browser-external',
			typeof content === 'string' ? content : null,
			null,
			'__vite-browser-external',
		);
	}
	for (const externalRoot of ['node_modules', 'vendor']) {
		const marker = `/${externalRoot}/`;
		const at = pathname.lastIndexOf(marker);
		if (at < 0) continue;
		const path = `${externalRoot}/${pathname.slice(at + marker.length)}`;
		return externalSource(
			`file:///__soundscaper_external__/${encodePath(path)}`,
			typeof content === 'string' ? content : null,
			EXECUTABLE_SOURCE_PATTERN.test(path) && !/\.d\.[cm]?ts$/u.test(path) ? path : null,
			externalRoot === 'node_modules' || EXECUTABLE_SOURCE_PATTERN.test(path) ? path : null,
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
		const path = pathname.slice(at + 1);
		if (generatedRepositoryPath(path)) return generatedRepositorySource(path, content);
		return repositorySource(path, repositoryRoot, label, content, digest, sourceRevision);
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
		executableThirdPartyPath: null,
		generatedRepositoryPath: null,
		repositoryPath: path,
		thirdPartyPath: null,
	};
}

function generatedRepositorySource(path, content) {
	return {
		url: `file:///__soundscaper_generated__/${encodePath(path)}`,
		content: typeof content === 'string' ? content : null,
		executableRepositoryPath: null,
		executableThirdPartyPath: null,
		generatedRepositoryPath: path,
		repositoryPath: path,
		thirdPartyPath: null,
	};
}

function generatedRepositoryPath(path) {
	return /[?#]/u.test(path) || !EXECUTABLE_SOURCE_PATTERN.test(path) || /\.d\.[cm]?ts$/u.test(path);
}

function externalSource(url, content, executableThirdPartyPath = null, thirdPartyPath = null) {
	return {
		url,
		content,
		executableRepositoryPath: null,
		executableThirdPartyPath,
		generatedRepositoryPath: null,
		repositoryPath: null,
		thirdPartyPath,
	};
}

function mappedSourceIndices(mappings, sourceCount, label) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const indices = new Set();
	let sourceIndex = 0;
	for (const segment of mappings.split(/[;,]/u)) {
		if (segment === '') continue;
		const fields = [];
		let value = 0;
		let shift = 0;
		for (const character of segment) {
			const digit = alphabet.indexOf(character);
			if (digit < 0) throw new Error(`${label} has invalid source-map mappings.`);
			value += (digit & 31) * (2 ** shift);
			if (!Number.isSafeInteger(value)) {
				throw new Error(`${label} has invalid source-map mappings.`);
			}
			if ((digit & 32) !== 0) {
				shift += 5;
				continue;
			}
			fields.push((value & 1) === 0 ? value / 2 : -(value >> 1));
			value = 0;
			shift = 0;
		}
		if (shift !== 0 || ![1, 4, 5].includes(fields.length)) {
			throw new Error(`${label} has invalid source-map mappings.`);
		}
		if (fields.length === 1) continue;
		sourceIndex += fields[1];
		if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= sourceCount) {
			throw new Error(`${label} maps an invalid source index.`);
		}
		indices.add(sourceIndex);
	}
	return indices;
}

function safeRelativePath(value) {
	return typeof value === 'string' && value !== '' && !isAbsolute(value) && !value.includes('\\')
		&& !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function encodePath(path) {
	return path.split('/').map(encodeURIComponent).join('/');
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
