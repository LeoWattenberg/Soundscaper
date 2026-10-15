/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAudiocomSearchRequest, handleAudiocomUploadRequest, handleAudiocomPreviewRequest, handleAudiocomUsageRequest } from '../functions/api/audiocom/_shared/handlers.ts';
import { encryptOAuthSecret, hashCapability } from '../functions/api/audiocom/_shared/oauth-crypto.ts';
import { encodeBase64Url } from '../functions/api/freesound/_shared/oauth-crypto.ts';
import type { AudiocomOAuthFunctionContext } from '../functions/api/audiocom/_shared/oauth-http.ts';
import { MemoryAudiocomOAuthRepository } from './helpers/audiocom-oauth-memory-repository.ts';
const NOW = Date.UTC(2026, 9, 15);
const TOKEN = 't'.repeat(43);
const GRANT = 'audiocom-user-attempt';
const KEY = `v1:${encodeBase64Url(new Uint8Array(32).fill(13))}`;
const audio = { id: '12345678', title: 'Rain', username: 'recorder', author_name: 'Recorder', slug: 'rain', description: '', license: 'arr', is_downloadable: false, play: { duration: 1000, url: 'https://s3.audio.com/audio/12345678.mp3', waveform: '' } };
const context = (request: Request): AudiocomOAuthFunctionContext => ({ request, env: { AUDIOCOM_OAUTH_MASTER_KEY: KEY }, params: {} });
function request(path: string, init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set('Authorization', `Bearer ${TOKEN}`);
	headers.set('Origin', 'soundscaper-app://bundle');
	return new Request(`https://soundscaper.org/api/audiocom/${path}`, { ...init, headers });
}
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function session(): Promise<MemoryAudiocomOAuthRepository> {
	const repository = new MemoryAudiocomOAuthRepository();
	repository.grants.set(GRANT, {
		id: GRANT, user: { id: 'attempt', username: '' },
		accessTokenCiphertext: await encryptOAuthSecret('provider-secret', KEY, `audiocom-oauth:${GRANT}:access`),
		refreshTokenCiphertext: await encryptOAuthSecret('provider-refresh', KEY, `audiocom-oauth:${GRANT}:refresh`),
		accessExpiresAt: NOW + 3600_000, refreshGeneration: 0, refreshLeaseOwner: null, refreshLeaseExpiresAt: null,
	});
	const tokenHash = await hashCapability(TOKEN);
	repository.sessions.set(tokenHash, { tokenHash, grantId: GRANT, clientKind: 'desktop', createdAt: NOW, expiresAt: NOW + 86_400_000 });
	return repository;
}
function uploadRequest(body: Uint8Array = new Uint8Array(4), length = 4): Request {
	return request('uploads?title=Rain&category=recording&description=Field&license=arr&listed=0&downloadable=0', {
		method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Audiocom-Filename': 'rain.wav', 'X-Audiocom-Content-Length': String(length) }, body: Uint8Array.from(body).buffer,
	});
}

test('audio.com search is authenticated, audio-only, paginated and bounded', async () => {
	const repository = await session();
	const response = await handleAudiocomSearchRequest(context(request('search?q=%23rain&page=2')), {
		repository, now: () => NOW, fetchImpl: (input, init) => {
			const url = new URL(String(input));
			assert.equal(url.origin, 'https://api.audio.com');
			assert.equal(url.pathname, '/v1/search');
			assert.equal(url.searchParams.get('query'), '#rain');
			assert.equal(url.searchParams.get('types'), 'audio');
			assert.equal(url.searchParams.get('page'), '2');
			assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer provider-secret');
			assert.equal(init?.redirect, 'manual');
			return Promise.resolve(json(Array.from({ length: 10 }, () => ({ type: 'audio', model: audio }))));
		},
	});
	assert.equal(response.status, 200);
	const body = await response.text();
	assert.equal(body.includes('provider-secret'), false);
	assert.equal((JSON.parse(body) as { data: { hasNext: boolean } }).data.hasNext, true);
});
test('audio.com blocks unauthenticated search, unexpected query keys and oversized provider JSON', async () => {
	const repository = await session();
	assert.equal((await handleAudiocomSearchRequest(context(new Request('https://soundscaper.org/api/audiocom/search')), { repository })).status, 401);
	assert.equal((await handleAudiocomSearchRequest(context(request('search?url=https://evil.test')), { repository })).status, 400);
	const response = await handleAudiocomSearchRequest(context(request('search')), {
		repository, now: () => NOW, fetchImpl: () => Promise.resolve(new Response('[]', { headers: { 'Content-Type': 'application/json', 'Content-Length': '1048577' } })),
	});
	assert.equal(response.status, 502);
});
test('audio.com provider authorization failure invalidates the local session', async () => {
	const repository = await session();
	assert.equal((await handleAudiocomSearchRequest(context(request('search')), { repository, now: () => NOW, fetchImpl: () => Promise.resolve(new Response(null, { status: 401 })) })).status, 401);
	assert.equal(repository.sessions.size, 0);
});
test('audio.com upload streams raw bytes without OAuth headers to the policy and invokes POST success', async () => {
	const repository = await session();
	const calls: string[] = [];
	const response = await handleAudiocomUploadRequest(context(uploadRequest()), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			const url = new URL(String(input));
			calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
			assert.equal(init?.redirect, 'manual');
			if (url.pathname === '/v1/audio/create') {
				assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer provider-secret');
				assert.deepEqual(JSON.parse(String(init?.body)), { title: 'Rain', category: 'recording', description: 'Field', license: 'arr', is_listed: false, is_downloadable: false, mime: 'audio/wav', name: 'rain.wav', size: 4 });
				return json({ audio, url: 'https://s3.audio.com/audio/12345678?signature=opaque', success: 'https://api.audio.com/v1/audio/upload/success?token=success', fail: 'https://api.audio.com/v1/audio/upload/fail?token=fail' }, 201);
			}
			assert.equal(new Headers(init?.headers).has('Authorization'), false);
			if (init?.method === 'PUT') {
				assert.ok(init.body instanceof ReadableStream);
				assert.equal((await new Response(init.body).arrayBuffer()).byteLength, 4);
				assert.equal(new Headers(init.headers).get('Content-Length'), '4');
			}
			return new Response(null, { status: 204 });
		},
	});
	assert.equal(response.status, 201, await response.clone().text());
	assert.deepEqual(calls, ['POST /v1/audio/create', 'PUT /audio/12345678', 'POST /v1/audio/upload/success']);
	const body = await response.text();
	assert.equal(body.includes('signature=opaque'), false);
	assert.equal(body.includes('token=success'), false);
	assert.equal((JSON.parse(body) as { data: { processing: boolean } }).data.processing, true);
});
test('audio.com failed streaming upload invokes the DELETE cleanup hook and never confirms completion', async () => {
	const repository = await session();
	const calls: string[] = [];
	const response = await handleAudiocomUploadRequest(context(uploadRequest(new Uint8Array(5))), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			calls.push(init?.method ?? 'GET');
			if (String(input).endsWith('/v1/audio/create')) return json({ audio, url: 'https://s3.audio.com/audio/upload', success: 'https://api.audio.com/v1/success', fail: 'https://api.audio.com/v1/fail' }, 201);
			if (init?.method === 'PUT' && init.body instanceof ReadableStream) await new Response(init.body).arrayBuffer();
			return new Response(null, { status: 204 });
		},
	});
	assert.equal(response.status, 400);
	assert.deepEqual(calls, ['POST', 'PUT', 'DELETE']);
});
test('audio.com refuses provider policy SSRF before sending file bytes', async () => {
	const repository = await session();
	let calls = 0;
	const response = await handleAudiocomUploadRequest(context(uploadRequest()), {
		repository, now: () => NOW, fetchImpl: () => {
			calls += 1;
			return Promise.resolve(json({ audio, url: 'https://evil.test/upload', success: 'https://api.audio.com/v1/success', fail: 'https://api.audio.com/v1/fail' }, 201));
		},
	});
	assert.equal(response.status, 502);
	assert.equal(calls, 1);
});
test('audio.com preview pins CDN destination and streams ranges without provider credentials', async () => {
	const repository = await session();
	const response = await handleAudiocomPreviewRequest(context(request(`preview?url=${encodeURIComponent('https://s3.audio.com/audio/test.mp3')}`, { headers: { Range: 'bytes=0-3' } })), {
		repository, now: () => NOW, fetchImpl: (_input, init) => {
			const headers = new Headers(init?.headers);
			assert.equal(headers.get('Range'), 'bytes=0-3');
			assert.equal(headers.has('Authorization'), false);
			return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/10' } }));
		},
	});
	assert.equal(response.status, 206);
	assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/10');
	assert.equal((await response.arrayBuffer()).byteLength, 4);
	assert.equal((await handleAudiocomPreviewRequest(context(request('preview?url=https://evil.test/test')), { repository })).status, 400);
});
test('audio.com preview rejects redirects, non-audio and oversized content', async () => {
	for (const upstream of [new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }), new Response('html', { headers: { 'Content-Type': 'text/html' } }), new Response('audio', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '134217729' } })]) {
		const repository = await session();
		assert.equal((await handleAudiocomPreviewRequest(context(request('preview?url=https://s3.audio.com/audio/test.mp3')), { repository, now: () => NOW, fetchImpl: () => Promise.resolve(upstream) })).status, 502);
	}
});
test('audio.com usage exposes the application limit and explicitly excludes project storage', async () => {
	const response = await handleAudiocomUsageRequest(context(request('usage')));
	assert.deepEqual(await response.json(), { data: { maximumUploadBytes: 100000000, providerMaximumUploadBytes: 1073741824, projectStorageSupported: false } });
});

test('audio.com cancelled upload uses a fresh cleanup signal and does not invoke success', async () => {
	const repository = await session();
	const controller = new AbortController();
	const pending = new Request(uploadRequest(), { signal: controller.signal });
	const calls: string[] = [];
	const response = await handleAudiocomUploadRequest(context(pending), {
		repository, now: () => NOW, fetchImpl: (input, init) => {
			calls.push(init?.method ?? 'GET');
			if (String(input).endsWith('/v1/audio/create')) return Promise.resolve(json({ audio, url: 'https://s3.audio.com/audio/upload', success: 'https://api.audio.com/v1/success', fail: 'https://api.audio.com/v1/fail' }, 201));
			if (init?.method === 'PUT') {
				controller.abort();
				return Promise.reject(new DOMException('Cancelled', 'AbortError'));
			}
			assert.equal(init?.method, 'DELETE');
			assert.equal(init.signal?.aborted, false);
			return Promise.resolve(new Response(null, { status: 204 }));
		},
	});
	assert.equal(response.status, 502);
	assert.deepEqual(calls, ['POST', 'PUT', 'DELETE']);
});
