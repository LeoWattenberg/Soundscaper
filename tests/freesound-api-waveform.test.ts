/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	handleFreesoundWaveformRequest,
	type FreesoundFunctionContext,
} from '../functions/api/freesound/_shared/handlers.ts';

const API_KEY = 'server-secret-api-key';
const waveformUrl = 'https://cdn.freesound.org/displays/123/123456_789_wave_M.png';
const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function context(request: Request, id = '123456'): FreesoundFunctionContext {
	return { request, params: { id }, env: { FREESOUND_API_KEY: API_KEY } };
}

test('waveform returns a bounded same-origin PNG without forwarding the token', async () => {
	const requests: Request[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		return new Response(image, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(image.length) } });
	};
	const response = await handleFreesoundWaveformRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/waveform?asset=789&source=cdn',
		{ headers: { Origin: 'soundscaper-app://bundle' } },
	)), { fetchImpl });

	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.url, waveformUrl);
	assert.equal(requests[0]?.headers.get('authorization'), null);
	assert.equal(requests[0]?.redirect, 'manual');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'image/png');
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
	assert.equal(response.headers.get('access-control-allow-origin'), 'soundscaper-app://bundle');
	assert.match(response.headers.get('cache-control') ?? '', /s-maxage/u);
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), image);
});

test('waveform HEAD checks upstream metadata and returns no body', async () => {
	const methods: string[] = [];
	const response = await handleFreesoundWaveformRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/waveform?asset=789&source=cdn', { method: 'HEAD' },
	)), {
		fetchImpl: async (input, init) => {
			const request = new Request(input, init);
			methods.push(request.method);
			return new Response(null, { headers: { 'Content-Type': 'image/png', 'Content-Length': '1024' } });
		},
	});
	assert.equal(response.status, 200);
	assert.deepEqual(methods, ['HEAD']);
	assert.equal(response.body, null);
	assert.equal(response.headers.get('content-length'), '1024');
});

test('waveform maps a legacy Freesound image path to its pinned upstream host', async () => {
	let upstreamUrl = '';
	const response = await handleFreesoundWaveformRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/waveform?asset=789&source=site',
	)), {
		fetchImpl: async (input) => {
			upstreamUrl = String(input);
			return new Response(image, { headers: { 'Content-Type': 'image/png' } });
		},
	});
	assert.equal(upstreamUrl, 'https://freesound.org/data/displays/123/123456_789_wave_M.png');
	assert.equal(response.status, 200);
});

test('waveform rejects invalid ID and asset input before fetching', async () => {
	let calls = 0;
	const invalid = await handleFreesoundWaveformRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/evil/waveform?asset=789&source=cdn',
	), 'evil'), { fetchImpl: async () => { calls += 1; throw new Error('unused'); } });
	assert.equal(invalid.status, 400);
	for (const query of [
		'', '?asset=789&source=evil', '?asset=789&source=cdn&other=x',
		'?asset=789&asset=123&source=cdn', '?asset=../789&source=cdn',
	]) {
		const response = await handleFreesoundWaveformRequest(context(new Request(
			`https://soundscaper.org/api/freesound/sounds/123456/waveform${query}`,
		)), { fetchImpl: async () => { calls += 1; throw new Error('unused'); } });
		assert.equal(response.status, 400);
	}
	assert.equal(calls, 0);
});


test('waveform rejects redirects, incorrect type, and oversized body', async () => {
	for (const upstream of [
		new Response(null, { status: 302, headers: { Location: 'https://attacker.example/' } }),
		new Response('<html>bad</html>', { headers: { 'Content-Type': 'text/html' } }),
		new Response(image, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(1024 * 1024 + 1) } }),
		new Response(new Uint8Array(1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }),
	]) {
		const response = await handleFreesoundWaveformRequest(context(new Request(
			'https://soundscaper.org/api/freesound/sounds/123456/waveform?asset=789&source=cdn',
		)), {
			fetchImpl: async () => upstream,
		});
		assert.equal(response.status, 502);
	}
});
