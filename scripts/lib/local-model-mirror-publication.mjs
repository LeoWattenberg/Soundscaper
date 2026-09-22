/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Public-delivery verification for mirrored local-model artifacts.
 *
 * A publisher must finish these public checks before the repository verifier
 * can admit the resulting digest-pinned catalog.
 */

import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const PUBLIC_CORS_ORIGIN = 'https://soundscaper.org';
const TRANSIENT_CONNECTION_ERRORS = new Set([
	'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN',
]);

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

async function fetchWithTransientRetry(fetchImpl, url, options, signal) {
	for (let attempt = 0; ; attempt += 1) {
		throwIfAborted(signal);
		try {
			return await fetchImpl(url, options);
		} catch (error) {
			const code = error instanceof TypeError ? error.cause?.code : undefined;
			if (attempt >= 2 || !TRANSIENT_CONNECTION_ERRORS.has(code)) throw error;
			await delay(250 * 2 ** attempt, undefined, { signal });
		}
	}
}

async function verifyHead({ url, artifact, fetchImpl, signal }) {
	throwIfAborted(signal);
	const response = await fetchWithTransientRetry(fetchImpl, url,
		requestOptions('HEAD', signal, { 'Accept-Encoding': 'identity' }), signal);
	assertResponse(response, `${url} HEAD`);
	assert(response.status === 200, `${url} HEAD returned HTTP ${String(response.status)}`);
	assertCors(response, url, PUBLIC_CORS_ORIGIN, 'HEAD');
	assertExactLength(response, artifact.byteLength, `${url} HEAD`);
}

async function verifyRange({ url, artifact, fetchImpl, signal }) {
	throwIfAborted(signal);
	let response = await fetchWithTransientRetry(fetchImpl, url,
		requestOptions('GET', signal, { Range: 'bytes=0-0' }), signal);
	assertResponse(response, `${url} ranged GET`);
	if (response.status === 200) {
		// A cold R2 custom-domain edge can ignore its first range request for a
		// large object. Cancel that full body; only a proved 206 may pass below.
		await response.body?.cancel();
		throwIfAborted(signal);
		response = await fetchWithTransientRetry(fetchImpl, url,
			requestOptions('GET', signal, { Range: 'bytes=0-0' }), signal);
		assertResponse(response, `${url} retried ranged GET`);
	}
	if (response.status !== 206) await response.body?.cancel();
	assert(response.status === 206,
		`${url} ranged GET returned HTTP ${String(response.status)}, not 206`);
	assertCors(response, url, PUBLIC_CORS_ORIGIN, 'ranged GET');
	// RFC 9110 section 14.3 makes Accept-Ranges advisory. R2 can omit it on
	// partial responses; the exact 206, Content-Range and body prove support.
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
	const response = await fetchWithTransientRetry(fetchImpl, url,
		requestOptions('GET', signal), signal);
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

function assertVerificationInput({ url, artifact, fetchImpl }) {
	assert(typeof url === 'string' && url.startsWith('https://'), 'Mirrored model URL must use HTTPS');
	assert(Number.isSafeInteger(artifact?.byteLength) && artifact.byteLength > 0,
		'Mirrored model byte length is invalid');
	assert(SHA256_PATTERN.test(artifact?.sha256 ?? ''), 'Mirrored model SHA-256 is invalid');
	assert(typeof fetchImpl === 'function', 'Mirrored model fetch implementation is invalid');
}

/**
 * Proves the public browser-delivery contract with metadata and one byte only.
 * A caller that already downloads and hashes the complete object can use this
 * without transferring a second model body.
 */
export async function verifyMirroredArtifactDelivery({ url, artifact, fetchImpl = fetch, signal }) {
	assertVerificationInput({ url, artifact, fetchImpl });
	await verifyHead({ url, artifact, fetchImpl, signal });
	await verifyRange({ url, artifact, fetchImpl, signal });
	return Object.freeze({ url, byteLength: artifact.byteLength, sha256: artifact.sha256 });
}

/**
 * Proves the public object contract that must precede catalog publication:
 * browser-readable HEAD, a one-byte Range response, then a streamed full hash.
 */
export async function verifyMirroredArtifact({ url, artifact, fetchImpl = fetch, signal }) {
	await verifyMirroredArtifactDelivery({ url, artifact, fetchImpl, signal });
	return verifyFullBody({ url, artifact, fetchImpl, signal });
}
