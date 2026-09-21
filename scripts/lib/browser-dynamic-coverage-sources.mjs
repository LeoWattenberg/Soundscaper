/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	INSTALL_WORKLET_COVERAGE_CHECKPOINT,
	WORKLET_COVERAGE_CHECKPOINT_URL,
} from './browser-service-worker-coverage.mjs';
import {
	INSTALL_NAVIGATION_COVERAGE_CHECKPOINT,
	NAVIGATION_COVERAGE_CHECKPOINT_URL,
} from './navigation-coverage-checkpoint.mjs';

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

/** Empty and non-executable-only maps cannot own nonempty emitted JavaScript. */
export function isUnmappedBrowserSourceMap(map) {
	return Array.isArray(map?.sources) && typeof map.mappings === 'string'
		&& (map.sources.length === 0 || !/[A-Za-z\d+/]/u.test(map.mappings)
			|| map.sources.every((source) => !executableSource(source)));
}

function executableSource(source) {
	if (typeof source !== 'string') return false;
	let path = source;
	try { path = decodeURIComponent(new URL(source).pathname); } catch { /* Keep virtual source text. */ }
	return EXECUTABLE_SOURCE_PATTERN.test(path) && !/\.d\.[cm]?ts$/u.test(path);
}
