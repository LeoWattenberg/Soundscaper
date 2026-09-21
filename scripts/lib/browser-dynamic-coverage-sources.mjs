/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	INSTALL_WORKLET_COVERAGE_CHECKPOINT,
	WORKLET_COVERAGE_CHECKPOINT_URL,
} from './browser-service-worker-coverage.mjs';
import {
	INSTALL_NAVIGATION_COVERAGE_CHECKPOINT,
	NAVIGATION_COVERAGE_CHECKPOINT_URL,
} from './navigation-coverage-checkpoint.mjs';
import { mappedE2ESourceMapEntries } from './e2e-coverage-source-maps.mjs';

const EXECUTABLE_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;

/** Whether a named script needs exact Debugger source bytes for dynamic attestation. */
export function needsCapturedBrowserSource(url, directoriesByOrigin) {
	if (typeof url !== 'string' || url === '') return false;
	let parsed;
	try { parsed = new URL(url); }
	catch { return true; }
	return !(['http:', 'https:'].includes(parsed.protocol) && directoriesByOrigin.has(parsed.origin));
}

/** Admit only the two collector-owned instrumentation programs by exact bytes. */
export function excludedBrowserCoverageInstrumentation(url, source) {
	const expected = new Map([
		[NAVIGATION_COVERAGE_CHECKPOINT_URL, INSTALL_NAVIGATION_COVERAGE_CHECKPOINT],
		[WORKLET_COVERAGE_CHECKPOINT_URL, INSTALL_WORKLET_COVERAGE_CHECKPOINT],
	]).get(url);
	if (expected === undefined) return false;
	if (source !== expected) {
		throw new Error(`Browser coverage instrumentation source bytes are stale for ${url}.`);
	}
	return true;
}

/** Retain one URL-to-source binding and refuse conflicting runtime bytes. */
export function retainCapturedBrowserSource(sources, url, source) {
	if (typeof source !== 'string') {
		throw new Error(`Browser coverage captured no source bytes for ${url}.`);
	}
	const previous = sources.get(url);
	if (previous !== undefined && previous !== source) {
		throw new Error(`Browser coverage captured conflicting source bytes for ${url}.`);
	}
	sources.set(url, source);
}

export function mergeCapturedBrowserSources(target, incoming) {
	for (const [url, source] of incoming) retainCapturedBrowserSource(target, url, source);
}

/** Preserve exact Blob bytes for the build-evidence assembler to authenticate. */
export function retainedBrowserDynamicCoverageScript(url, source) {
	let parsed;
	try { parsed = new URL(url); } catch { return null; }
	if (parsed.protocol !== 'blob:') return null;
	if (typeof source !== 'string') {
		throw new Error(`Browser coverage captured no source bytes for ${url}.`);
	}
	return { coverageUrl: url, path: '/__soundscaper_dynamic__/blob.js', retainSource: true, source };
}

/** Reject captured executable bytes that have no corresponding V8 profile entry. */
export function validateBrowserSourceCache(profile, name) {
	const cache = profile?.['script-source-cache'];
	if (!record(cache) || Object.values(cache).some((source) => typeof source !== 'string')) {
		throw new Error(`Browser coverage profile ${name} has an invalid script-source cache.`);
	}
	if (!Array.isArray(profile.result) || profile.result.some((entry) => (
		!record(entry) || typeof entry.url !== 'string' || !Array.isArray(entry.functions)
	))) throw new Error(`Browser profile ${name} has no valid V8 result array.`);
	const observedUrls = new Set(profile.result.map(({ url }) => url));
	const unobserved = Object.keys(cache).find((url) => !observedUrls.has(url));
	if (unobserved !== undefined) {
		throw new Error(`Browser coverage captured source bytes without a V8 entry for ${unobserved}.`);
	}
}

/**
 * A map owns emitted JavaScript only through an executable first-party mapping.
 * Pure mapped vendor JavaScript remains outside that denominator; every other
 * zero-first-party map leaves the exact emitted artifact as the coverage source.
 */
export function isUnmappedBrowserSourceMap(map) {
	if (!Array.isArray(map?.sources) || typeof map.mappings !== 'string') return false;
	const mapped = mappedE2ESourceMapEntries(map, 'browser build source map');
	if (mapped.length === 0) return true;
	if (mapped.some(({ source }) => repositorySource(source) && executableSource(source))) return false;
	const declaresRepositorySource = map.sources.some(repositorySource);
	const authenticatedVendorOnly = !declaresRepositorySource && mapped.every(({ source }) => (
		vendorSource(source) && executableSource(source)
	));
	return !authenticatedVendorOnly;
}

function executableSource(source) {
	if (typeof source !== 'string') return false;
	let path = source;
	try { path = decodeURIComponent(new URL(source).pathname); } catch { /* Keep virtual source text. */ }
	return EXECUTABLE_SOURCE_PATTERN.test(path) && !/\.d\.[cm]?ts$/u.test(path);
}

function repositorySource(source) {
	const path = sourcePath(source);
	return !/(?:^|\/)(?:node_modules|vendor)(?:\/|$)/u.test(path)
		&& /(?:^|\/)(?:src|desktop)(?:\/|$)/u.test(path);
}

function vendorSource(source) {
	return /(?:^|\/)(?:node_modules|vendor)(?:\/|$)/u.test(sourcePath(source));
}

function sourcePath(source) {
	if (typeof source !== 'string') return '';
	try { return decodeURIComponent(new URL(source).pathname).replaceAll('\\', '/'); }
	catch { return source.replaceAll('\\', '/'); }
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
