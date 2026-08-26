/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Public-delivery verification for mirrored local-model artifacts.
 *
 * The release signer is deliberately not part of this module. A publisher
 * must finish these public checks before handing the resulting catalog to the
 * repository-external signer.
 */

import { createHash } from 'node:crypto';

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const PUBLIC_CORS_ORIGIN = 'https://soundscaper.org';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function throwIfAborted(signal) {
	if (signal?.aborted) throw signal.reason ?? new Error('Model mirror verification aborted');
}

function assertResponse(response, label) {
	assert(response && Number.isInteger(response.status)
		&& response.headers && typeof response.headers.get === 'function', `${label} returned an invalid response`);
}

function assertCors(response, url, origin, label) {
	const allowed = response.headers.get('access-control-allow-origin');
	assert(allowed === origin || allowed === '*',
		`${url} ${label} CORS does not allow ${origin}`);
}

function assertExactLength(response, expected, label) {
	const value = response.headers.get('content-length');
	assert(typeof value === 'string' && /^\d+$/u.test(value) && Number(value) === expected,
		`${label} Content-Length is not ${String(expected)}`);
}

function requestOptions(method, signal, headers = {}) {
	return {
		method,
		cache: 'no-store',
		credentials: 'omit',
		headers: { Origin: PUBLIC_CORS_ORIGIN, ...headers },
		redirect: 'error',
		signal,
	};
}

async function verifyHead({ url, artifact, fetchImpl, signal }) {
	throwIfAborted(signal);
	const response = await fetchImpl(url, requestOptions('HEAD', signal));
	assertResponse(response, `${url} HEAD`);
	assert(response.status === 200, `${url} HEAD returned HTTP ${String(response.status)}`);
	assertCors(response, url, PUBLIC_CORS_ORIGIN, 'HEAD');
	assertExactLength(response, artifact.byteLength, `${url} HEAD`);
}

async function verifyRange({ url, artifact, fetchImpl, signal }) {
	throwIfAborted(signal);
	const response = await fetchImpl(url, requestOptions('GET', signal, { Range: 'bytes=0-0' }));
	assertResponse(response, `${url} ranged GET`);
	assert(response.status === 206,
		`${url} ranged GET returned HTTP ${String(response.status)}, not 206`);
	assertCors(response, url, PUBLIC_CORS_ORIGIN, 'ranged GET');
	assert(response.headers.get('accept-ranges')?.toLowerCase() === 'bytes',
		`${url} ranged GET does not advertise byte ranges`);
	assert(response.headers.get('content-range') === `bytes 0-0/${String(artifact.byteLength)}`,
		`${url} ranged GET returned an invalid Content-Range`);
	assertExactLength(response, 1, `${url} ranged GET`);
	const exposed = new Set((response.headers.get('access-control-expose-headers') ?? '')
		.split(',').map((header) => header.trim().toLowerCase()).filter(Boolean));
	assert(exposed.has('content-range'),
		`${url} ranged GET CORS does not expose Content-Range`);
	assert(response.body, `${url} ranged GET returned no body`);
	let bytes = 0;
	for await (const chunk of response.body) {
		throwIfAborted(signal);
		bytes += chunk.byteLength;
		assert(bytes <= 1, `${url} ranged GET served more than one byte`);
	}
	assert(bytes === 1, `${url} ranged GET served ${String(bytes)} bytes, not one`);
}

async function verifyFullBody({ url, artifact, fetchImpl, signal }) {
	throwIfAborted(signal);
	const response = await fetchImpl(url, requestOptions('GET', signal));
	assertResponse(response, `${url} GET`);
	assert(response.status === 200, `${url} returned HTTP ${String(response.status)}`);
	assertCors(response, url, PUBLIC_CORS_ORIGIN, 'GET');
	assert(response.body, `${url} returned no body`);
	const hash = createHash('sha256');
	let bytes = 0;
	for await (const chunk of response.body) {
		throwIfAborted(signal);
		bytes += chunk.byteLength;
		assert(bytes <= artifact.byteLength,
			`${url} served more than the recorded ${String(artifact.byteLength)} bytes`);
		hash.update(chunk);
	}
	assert(bytes === artifact.byteLength,
		`${url} served ${String(bytes)} bytes, not the recorded ${String(artifact.byteLength)}`);
	const digest = hash.digest('hex');
	assert(digest === artifact.sha256, `${url} served ${digest}, not the recorded ${artifact.sha256}`);
	return Object.freeze({ url, byteLength: bytes, sha256: digest });
}

/**
 * Proves the public object contract that must precede external catalog signing:
 * browser-readable HEAD, a one-byte Range response, then a streamed full hash.
 */
export async function verifyMirroredArtifact({ url, artifact, fetchImpl = fetch, signal }) {
	assert(typeof url === 'string' && url.startsWith('https://'), 'Mirrored model URL must use HTTPS');
	assert(Number.isSafeInteger(artifact?.byteLength) && artifact.byteLength > 0,
		'Mirrored model byte length is invalid');
	assert(SHA256_PATTERN.test(artifact?.sha256 ?? ''), 'Mirrored model SHA-256 is invalid');
	assert(typeof fetchImpl === 'function', 'Mirrored model fetch implementation is invalid');
	await verifyHead({ url, artifact, fetchImpl, signal });
	await verifyRange({ url, artifact, fetchImpl, signal });
	return verifyFullBody({ url, artifact, fetchImpl, signal });
}
