/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 24;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAXIMUM_ATTEMPTS = 120;
const MAXIMUM_DELAY_MS = 60_000;

/**
 * Bind a Pages deployment to one exact artifact downloaded from the admitted
 * build. Cache-policy checks alone cannot distinguish a newly deployed build
 * from a policy-valid predecessor while Pages propagates.
 */
export async function verifyPublishedPagesArtifactIdentity({
	expectedArtifactPath,
	origin,
	publishedPath = '/offline-shell.json',
	fetchImpl = fetch,
}, schedule = {}) {
	const expected = await expectedArtifact(expectedArtifactPath);
	const normalizedOrigin = pagesOrigin(origin);
	const normalizedPath = pagesArtifactPath(publishedPath);
	const maxAttempts = boundedInteger(
		schedule.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
		'Pages artifact-binding maximum attempts',
		1,
		MAXIMUM_ATTEMPTS,
	);
	const intervalMs = boundedInteger(
		schedule.intervalMs ?? DEFAULT_INTERVAL_MS,
		'Pages artifact-binding retry interval',
		0,
		MAXIMUM_DELAY_MS,
	);
	const requestTimeoutMs = boundedInteger(
		schedule.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		'Pages artifact-binding request timeout',
		1,
		MAXIMUM_DELAY_MS,
	);
	const sleep = schedule.sleep
		?? ((milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); }));
	let lastError;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			await verifyAttempt({
				attempt,
				expected,
				fetchImpl,
				origin: normalizedOrigin,
				publishedPath: normalizedPath,
				requestTimeoutMs,
			});
			return Object.freeze({
				schemaVersion: 1,
				origin: normalizedOrigin,
				publishedPath: normalizedPath,
				sha256: expected.sha256,
				byteLength: expected.bytes.byteLength,
				attemptCount: attempt,
			});
		} catch (error) {
			lastError = error;
			if (attempt === maxAttempts) break;
			schedule.onRetry?.({ attempt, error, intervalMs, remainingAttempts: maxAttempts - attempt });
			await sleep(intervalMs);
		}
	}
	throw new Error(
		`Live Pages artifact ${normalizedPath} on ${normalizedOrigin} does not match admitted artifact `
		+ `${expected.sha256} after ${String(maxAttempts)} attempts: ${lastError?.message ?? 'unknown failure'}`,
		{ cause: lastError },
	);
}

async function expectedArtifact(path) {
	assert(typeof path === 'string' && path.trim() === path && path.length > 0,
		'Pages artifact-binding expected artifact path is required.');
	const metadata = await lstat(path);
	assert(metadata.isFile() && !metadata.isSymbolicLink(),
		'Pages artifact-binding expected artifact must be a regular, non-symlink file.');
	const bytes = await readFile(path);
	assert(bytes.byteLength > 0, 'Pages artifact-binding expected artifact is empty.');
	return Object.freeze({ bytes, sha256: sha256(bytes) });
}

async function verifyAttempt({
	attempt,
	expected,
	fetchImpl,
	origin,
	publishedPath,
	requestTimeoutMs,
}) {
	const url = new URL(publishedPath, origin);
	url.searchParams.set(
		'soundscaper-deploy-sha256',
		`${expected.sha256}-${randomUUID()}-${String(attempt)}`,
	);
	const response = await fetchImpl(url.href, {
		cache: 'no-store',
		headers: {
			accept: 'application/json',
			'accept-encoding': 'identity',
			'cache-control': 'no-cache, no-store',
			pragma: 'no-cache',
		},
		redirect: 'error',
		signal: AbortSignal.timeout(requestTimeoutMs),
	});
	assert(response instanceof Response && response.status === 200,
		`Pages artifact-binding received HTTP ${String(response?.status)} for ${publishedPath}.`);
	const contentEncoding = response.headers.get('content-encoding');
	assert(contentEncoding === null || contentEncoding === 'identity',
		`Pages artifact-binding received an encoded response (${contentEncoding}) for ${publishedPath}.`);
	const observed = Buffer.from(await response.arrayBuffer());
	const exact = observed.byteLength === expected.bytes.byteLength
		&& timingSafeEqual(observed, expected.bytes);
	assert(exact,
		`Observed ${publishedPath} does not match admitted bytes: expected ${expected.sha256} `
		+ `(${String(expected.bytes.byteLength)} bytes), received ${sha256(observed)} `
		+ `(${String(observed.byteLength)} bytes).`);
}

function pagesOrigin(value) {
	assert(typeof value === 'string' && value.trim() === value && value.length > 0,
		'Pages artifact-binding origin is required.');
	const parsed = new URL(value);
	assert(parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '',
		'Pages artifact-binding origin must be an HTTPS origin without credentials.');
	assert(parsed.pathname === '/' && parsed.search === '' && parsed.hash === '',
		'Pages artifact-binding origin must not contain a path, query, or fragment.');
	return parsed.origin;
}

function pagesArtifactPath(value) {
	assert(typeof value === 'string' && value.startsWith('/'),
		'Pages artifact-binding published path must be root-relative.');
	const parsed = new URL(value, 'https://pages.invalid');
	assert(parsed.origin === 'https://pages.invalid' && parsed.search === '' && parsed.hash === ''
		&& parsed.pathname === value && !value.includes('\\'),
	'Pages artifact-binding published path must be a canonical path without a query or fragment.');
	return parsed.pathname;
}

function boundedInteger(value, description, minimum, maximum) {
	assert(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
		`${description} must be an integer from ${String(minimum)} through ${String(maximum)}.`);
	return value;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
