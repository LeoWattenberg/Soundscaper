/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

const DEFAULT_INTERVAL_MS = 3_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAXIMUM_ATTEMPTS = 10;
const MAXIMUM_DELAY_MS = 60_000;
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;
const SEARCH_PATH = '/api/freesound/search';

class FreesoundSmokeError extends Error {
	constructor(message, { cause, retryable = false } = {}) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'FreesoundSmokeError';
		this.retryable = retryable;
	}
}

/** Whether one Pages product owns the Freesound Function routes. */
export function shouldVerifyLiveFreesoundSearch(productId) {
	return productId === 'soundscaper';
}

/**
 * Read one populated search through the public Pages Function. This intentionally
 * carries no application credential: the deployed Function owns that secret.
 */
export async function verifyLiveFreesoundSearch({
	origin,
	fetchImpl = (input, init) => globalThis.fetch(input, init),
	requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) {
	const normalizedOrigin = pagesOrigin(origin);
	const timeoutMs = boundedInteger(
		requestTimeoutMs,
		'Freesound deployment-smoke request timeout',
		1,
		MAXIMUM_DELAY_MS,
	);
	const url = searchUrl(normalizedOrigin);
	let response;
	try {
		response = await fetchImpl(url.href, {
			method: 'GET',
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			headers: {
				accept: 'application/json',
				'accept-encoding': 'identity',
				'cache-control': 'no-cache, no-store',
				pragma: 'no-cache',
			},
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw new FreesoundSmokeError(
			`Live Freesound search on ${normalizedOrigin} had a transport failure.`,
			{ cause: error, retryable: true },
		);
	}
	if (!(response instanceof Response)) {
		throw new FreesoundSmokeError(`Live Freesound search on ${normalizedOrigin} returned no HTTP response.`);
	}
	if (response.status !== 200) {
		await discardResponse(response);
		throw new FreesoundSmokeError(
			`Live Freesound search on ${normalizedOrigin} received HTTP ${String(response.status)}.`,
			{ retryable: response.status === 429 || response.status >= 500 },
		);
	}
	const contentType = response.headers.get('content-type')?.toLocaleLowerCase('en-US') ?? '';
	if (!contentType.startsWith('application/json')) {
		await discardResponse(response);
		throw new FreesoundSmokeError(`Live Freesound search on ${normalizedOrigin} requires a JSON content type.`);
	}
	const payload = parseSearchPayload(await boundedBody(response), normalizedOrigin);
	return Object.freeze({
		origin: normalizedOrigin,
		resultCount: payload.results.length,
		firstResultId: payload.results[0].id,
	});
}

/** Retry only failures that can be transient at the network or upstream boundary. */
export async function verifyPublishedFreesoundSearch(options, schedule = {}) {
	const maxAttempts = boundedInteger(
		schedule.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
		'Freesound deployment-smoke maximum attempts',
		1,
		MAXIMUM_ATTEMPTS,
	);
	const intervalMs = boundedInteger(
		schedule.intervalMs ?? DEFAULT_INTERVAL_MS,
		'Freesound deployment-smoke retry interval',
		0,
		MAXIMUM_DELAY_MS,
	);
	const sleep = schedule.sleep
		?? ((milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); }));
	let lastError;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const result = await verifyLiveFreesoundSearch(options);
			return Object.freeze({ ...result, attemptCount: attempt });
		} catch (error) {
			if (!(error instanceof FreesoundSmokeError) || !error.retryable) throw error;
			lastError = error;
			if (attempt === maxAttempts) break;
			schedule.onRetry?.({ attempt, error, intervalMs, remainingAttempts: maxAttempts - attempt });
			await sleep(intervalMs);
		}
	}
	throw new Error(
		`Live Freesound search failed after ${String(maxAttempts)} attempts: ${lastError?.message ?? 'unknown failure'}`,
		{ cause: lastError },
	);
}

function searchUrl(origin) {
	const url = new URL(SEARCH_PATH, origin);
	url.searchParams.set('q', 'rain');
	url.searchParams.set('page', '1');
	url.searchParams.set('license', 'all');
	url.searchParams.set('sort', 'downloads');
	return url;
}

function parseSearchPayload(bytes, origin) {
	let payload;
	try {
		payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (error) {
		throw new FreesoundSmokeError(`Live Freesound search on ${origin} did not return valid JSON.`, { cause: error });
	}
	const data = record(payload, 'response').data;
	const results = record(data, 'response.data').results;
	if (!Array.isArray(results) || results.length < 1) {
		throw new FreesoundSmokeError(`Live Freesound search on ${origin} requires at least one result.`);
	}
	const first = record(results[0], 'response.data.results[0]');
	if (!Number.isSafeInteger(first.id) || first.id < 1) {
		throw new FreesoundSmokeError(`Live Freesound search on ${origin} returned an invalid result ID.`);
	}
	const preview = record(first.preview, 'response.data.results[0].preview');
	if (preview.available !== true) {
		throw new FreesoundSmokeError(`Live Freesound search on ${origin} returned no importable preview.`);
	}
	const waveform = record(first.waveform, 'response.data.results[0].waveform');
	const waveformValid = waveform.available === false && waveform.url === null
		|| waveform.available === true && typeof waveform.url === 'string'
			&& waveform.url.startsWith('/api/freesound/sounds/');
	if (!waveformValid) {
		throw new FreesoundSmokeError(`Live Freesound search on ${origin} returned an invalid waveform contract.`);
	}
	return { results };
}

async function boundedBody(response) {
	const declared = response.headers.get('content-length');
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_JSON_BYTES)) {
		await discardResponse(response);
		throw new FreesoundSmokeError('Live Freesound search JSON exceeded its byte limit.');
	}
	if (response.body === null) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks = [];
	let length = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		length += next.value.byteLength;
		if (length > MAXIMUM_JSON_BYTES) {
			await reader.cancel('Live Freesound search JSON exceeded its byte limit.').catch(() => undefined);
			throw new FreesoundSmokeError('Live Freesound search JSON exceeded its byte limit.');
		}
		chunks.push(next.value);
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function discardResponse(response) {
	if (response.body !== null) await response.body.cancel().catch(() => undefined);
}

function record(value, label) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new FreesoundSmokeError(`Live Freesound search ${label} must be an object.`);
	}
	return value;
}

function pagesOrigin(value) {
	assert(typeof value === 'string' && value.trim() === value && value.length > 0,
		'Freesound deployment-smoke origin is required.');
	const parsed = new URL(value);
	assert(parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '',
		'Freesound deployment-smoke origin must be an HTTPS origin without credentials.');
	assert(parsed.pathname === '/' && parsed.search === '' && parsed.hash === '',
		'Freesound deployment-smoke origin must not contain a path, query, or fragment.');
	return parsed.origin;
}

function boundedInteger(value, description, minimum, maximum) {
	assert(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
		`${description} must be an integer from ${String(minimum)} through ${String(maximum)}.`);
	return value;
}
