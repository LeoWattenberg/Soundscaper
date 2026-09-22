/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	shouldVerifyLiveFreesoundSearch,
	verifyLiveFreesoundSearch,
	verifyPublishedFreesoundSearch,
} from '../scripts/lib/freesound-deploy-smoke.mjs';

const SEARCH_URL = 'https://soundscaper.org/api/freesound/search?q=rain&page=1&license=all&sort=downloads';

function populatedSearchResponse() {
	return new Response(JSON.stringify({
		data: {
			results: [{
				id: 314_159,
				preview: { available: true },
				waveform: { available: true, url: '/api/freesound/sounds/314159/waveform?asset=2718&source=cdn' },
			}],
		},
	}), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

test('the live Freesound smoke reads a populated production search without carrying a credential', async () => {
	let request;
	const result = await verifyLiveFreesoundSearch({
		origin: 'https://soundscaper.org',
		fetchImpl: async (input, init) => {
			request = new Request(input, init);
			return populatedSearchResponse();
		},
		requestTimeoutMs: 9_000,
	});

	assert.deepEqual(result, {
		origin: 'https://soundscaper.org',
		resultCount: 1,
		firstResultId: 314_159,
	});
	assert(request);
	assert.equal(request.url, SEARCH_URL);
	assert.equal(request.method, 'GET');
	assert.equal(request.redirect, 'error');
	assert.equal(request.cache, 'no-store');
	assert.equal(request.credentials, 'omit');
	assert.equal(request.headers.get('accept'), 'application/json');
	assert.equal(request.headers.get('accept-encoding'), 'identity');
	assert.equal(request.headers.get('cache-control'), 'no-cache, no-store');
	assert.equal(request.headers.get('pragma'), 'no-cache');
	assert.equal(request.headers.get('authorization'), null);
	assert.equal(request.signal.aborted, false);
});

test('the published smoke retries only transport, rate-limit, and server failures', async (context) => {
	const cases = [
		{ name: 'transport', failure: new TypeError('connection reset') },
		{ name: 'rate limit', failure: new Response(null, { status: 429 }) },
		{ name: 'server error', failure: new Response('error code: 502', { status: 502 }) },
	];
	for (const retryCase of cases) {
		await context.test(retryCase.name, async () => {
			let calls = 0;
			const waits = [];
			const retries = [];
			const result = await verifyPublishedFreesoundSearch({
				origin: 'https://soundscaper.org',
				fetchImpl: async () => {
					calls += 1;
					if (calls === 1) {
						if (retryCase.failure instanceof Response) return retryCase.failure;
						throw retryCase.failure;
					}
					return populatedSearchResponse();
				},
			}, {
				intervalMs: 7,
				maxAttempts: 2,
				sleep: async (milliseconds) => { waits.push(milliseconds); },
				onRetry: (retry) => { retries.push(retry); },
			});

			assert.equal(result.attemptCount, 2);
			assert.equal(calls, 2);
			assert.deepEqual(waits, [7]);
			assert.equal(retries.length, 1);
			assert.equal(retries[0].attempt, 1);
			assert.equal(retries[0].remainingAttempts, 1);
		});
	}
});

test('the published smoke stops at its bounded retry limit', async () => {
	let calls = 0;
	const waits = [];
	await assert.rejects(
		() => verifyPublishedFreesoundSearch({
			origin: 'https://soundscaper.org',
			fetchImpl: async () => {
				calls += 1;
				return new Response(null, { status: 503 });
			},
		}, {
			intervalMs: 3,
			maxAttempts: 3,
			sleep: async (milliseconds) => { waits.push(milliseconds); },
		}),
		/failed after 3 attempts.*HTTP 503/iu,
	);
	assert.equal(calls, 3);
	assert.deepEqual(waits, [3, 3]);
});

test('client and contract failures fail once without being retried', async (context) => {
	const oversized = 2 * 1024 * 1024 + 1;
	const cases = [
		{ name: 'client status', response: new Response(null, { status: 404 }), error: /HTTP 404/u },
		{
			name: 'non-JSON response',
			response: new Response('{}', { headers: { 'Content-Type': 'text/plain' } }),
			error: /JSON content type/u,
		},
		{
			name: 'malformed JSON',
			response: new Response('{', { headers: { 'Content-Type': 'application/json' } }),
			error: /valid JSON/u,
		},
		{
			name: 'empty result page',
			response: new Response(JSON.stringify({ data: { results: [] } }), {
				headers: { 'Content-Type': 'application/json' },
			}),
			error: /at least one result/u,
		},
		{
			name: 'oversized JSON',
			response: new Response('{}', {
				headers: { 'Content-Type': 'application/json', 'Content-Length': String(oversized) },
			}),
			error: /byte limit/u,
		},
	];
	for (const failureCase of cases) {
		await context.test(failureCase.name, async () => {
			let calls = 0;
			let sleeps = 0;
			await assert.rejects(
				() => verifyPublishedFreesoundSearch({
					origin: 'https://soundscaper.org',
					fetchImpl: async () => {
						calls += 1;
						return failureCase.response;
					},
				}, {
					maxAttempts: 3,
					sleep: async () => { sleeps += 1; },
				}),
				failureCase.error,
			);
			assert.equal(calls, 1);
			assert.equal(sleeps, 0);
		});
	}
});

test('the deploy verifier invokes the live smoke only for Soundscaper', async () => {
	assert.equal(shouldVerifyLiveFreesoundSearch('soundscaper'), true);
	assert.equal(shouldVerifyLiveFreesoundSearch('framescaper'), false);
	assert.equal(shouldVerifyLiveFreesoundSearch('future-product'), false);

	const source = await readFile('scripts/verify-pages-deploy.mjs', 'utf8');
	assert.match(source, /shouldVerifyLiveFreesoundSearch\(routing\.productId\)/u);
	assert.match(source, /verifyPublishedFreesoundSearch/u);
});
