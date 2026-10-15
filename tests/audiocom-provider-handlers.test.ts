/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAudiocomOAuthStartRequest, handleAudiocomOAuthCallbackRequest, handleAudiocomOAuthPollRequest, handleAudiocomOAuthSessionRequest } from '../functions/api/audiocom/_shared/oauth-handlers.ts';
import { handleAudiocomUploadRequest, handleAudiocomPreviewRequest, handleAudiocomUsageRequest, handleAudiocomSearchRequest } from '../functions/api/audiocom/_shared/handlers.ts';
import { hashCapability } from '../functions/api/audiocom/_shared/oauth-crypto.ts';
import { encodeBase64Url } from '../functions/api/freesound/_shared/oauth-crypto.ts';
import type { AudiocomOAuthFunctionContext, AudiocomOAuthEnv } from '../functions/api/audiocom/_shared/oauth-http.ts';
import { MemoryAudiocomOAuthRepository } from './helpers/audiocom-oauth-memory-repository.ts';

const NOW = Date.UTC(2026, 9, 15);
const ORIGIN = 'http://127.0.0.1:8088';
const EDITOR = 'http://127.0.0.1:4322';
const ID = '34c792f3-f4bb-44e8-8b0a-314210b4d933';
const SIGNATURE = 's'.repeat(43);
const ENV = { AUDIOCOM_PROVIDER: 'audiocity', AUDIOCOM_API_ORIGIN: ORIGIN, AUDIOCOM_LOCAL_DEVELOPMENT: '1', AUDIOCOM_CLIENT_ID: 'registered-client', AUDIOCOM_OAUTH_MASTER_KEY: `v1:${encodeBase64Url(new Uint8Array(32).fill(17))}` };
const context = (request: Request, env: AudiocomOAuthEnv = ENV): AudiocomOAuthFunctionContext => ({ request, env, params: {} });
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function request(path: string, token?: string, init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set('Origin', 'soundscaper-app://bundle');
	if (token) headers.set('Authorization', `Bearer ${token}`);
	return new Request(`${EDITOR}/api/audiocom/${path}`, { ...init, headers });
}
interface Attempt { readonly attemptId: string; readonly handoffToken: string; readonly authorizeUrl: string }
async function start(repository: MemoryAudiocomOAuthRepository): Promise<Attempt> {
	const response = await handleAudiocomOAuthStartRequest(context(request('oauth/start', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"client":"desktop"}' })), { repository, now: () => NOW });
	assert.equal(response.status, 201, await response.clone().text());
	return (await response.json() as { data: Attempt }).data;
}
async function connected(): Promise<{ token: string; repository: MemoryAudiocomOAuthRepository; attempt: Attempt }> {
	const repository = new MemoryAudiocomOAuthRepository();
	const attempt = await start(repository);
	const authorize = new URL(attempt.authorizeUrl);
	assert.equal(authorize.origin, ORIGIN);
	assert.equal(authorize.searchParams.get('scope'), 'public projects');
	assert.equal(authorize.searchParams.get('redirect_uri'), `${EDITOR}/api/audiocom/oauth/callback`);
	const callback = await handleAudiocomOAuthCallbackRequest(context(request(`oauth/callback?code=code&state=${authorize.searchParams.get('state') ?? ''}`)), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			assert.equal(String(input), `${ORIGIN}/auth/token`);
			const fields = new URLSearchParams(String(init?.body));
			assert.equal(fields.get('client_id'), 'registered-client');
			assert.equal(await hashCapability(fields.get('code_verifier') ?? ''), authorize.searchParams.get('code_challenge'));
			return json({ token_type: 'Bearer', scope: 'public projects', access_token: 'private-provider-access', refresh_token: 'private-provider-refresh', expires_in: 3600 });
		},
	});
	assert.equal(callback.status, 200, await callback.text());
	const poll = await handleAudiocomOAuthPollRequest(context(request('oauth/poll', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: attempt.attemptId, handoffToken: attempt.handoffToken }) })), { repository, now: () => NOW });
	assert.equal(poll.status, 200, await poll.clone().text());
	const token = (await poll.json() as { data: { sessionToken: string } }).data.sessionToken;
	return { repository, token, attempt };
}
const audio = { id: ID, title: 'Rain', username: 'recorder', author_name: 'Recorder', slug: 'rain', description: '', license: 'arr', is_downloadable: false, play: { duration: 1000, url: '' } };

test('Audiocity performs provider-pinned PKCE OAuth and rejects sessions after an origin change', async () => {
	const { repository, token } = await connected();
	for (const env of [{ ...ENV, AUDIOCOM_API_ORIGIN: 'http://127.0.0.1:8099' }, { ...ENV, AUDIOCOM_PROVIDER: undefined, AUDIOCOM_API_ORIGIN: undefined }]) {
		const restored = await handleAudiocomOAuthSessionRequest(context(request('oauth/session', token), env), { repository, now: () => NOW });
		assert.deepEqual(await restored.json(), { data: { connected: false } });
		let calls = 0;
		const searched = await handleAudiocomSearchRequest(context(request('search?q=rain', token), env), { repository, now: () => NOW, fetchImpl: () => { calls++; return Promise.resolve(json([])); } });
		assert.equal(searched.status, 401);
		assert.equal(calls, 0);
	}
});
test('Audiocity callback exchanges only at its persisted issuer after deployment configuration changes', async () => {
	const repository = new MemoryAudiocomOAuthRepository();
	const attempt = await start(repository);
	let calls = 0;
	const callback = await handleAudiocomOAuthCallbackRequest(context(request(`oauth/callback?code=code&state=${new URL(attempt.authorizeUrl).searchParams.get('state') ?? ''}`), { ...ENV, AUDIOCOM_API_ORIGIN: 'http://127.0.0.1:8099' }), { repository, now: () => NOW, fetchImpl: (input, init) => {
		calls++;
		assert.equal(String(input), `${ORIGIN}/auth/token`);
		assert.equal(new URLSearchParams(String(init?.body)).get('client_id'), 'registered-client');
		return Promise.resolve(json({ token_type: 'Bearer', scope: 'public projects', access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }));
	} });
	assert.equal(callback.status, 200);
	assert.equal(calls, 1);
});
test('Audiocity usage discovers archive capabilities and limits only at the configured origin', async () => {
	const response = await handleAudiocomUsageRequest(context(request('usage')), { fetchImpl: (input, init) => {
		assert.equal(String(input), `${ORIGIN}/.well-known/audiocity`);
		assert.equal(new Headers(init?.headers).has('Authorization'), false);
		return Promise.resolve(json({ name: 'Audiocity', url: ORIGIN, features: ['audio-uploads', 'aup3-archives', 'aup4-archives'], limits: { max_upload_bytes: 50000000 } }));
	} });
	assert.equal(response.status, 200);
	const { data } = await response.json() as { data: { projectFormats: string[]; projectStorageSupported: boolean; maximumUploadBytes: number; providerMaximumUploadBytes: number } };
	assert.deepEqual(data.projectFormats, ['aup3', 'aup4']);
	assert.equal(data.projectStorageSupported, true);
	assert.equal(data.maximumUploadBytes, 50000000);
	assert.equal(data.providerMaximumUploadBytes, 50000000);
	const invalid = await handleAudiocomUsageRequest(context(request('usage')), { fetchImpl: () => Promise.resolve(json({ name: 'Audiocity', url: 'https://evil.test', features: ['aup3-archives'], limits: { max_upload_bytes: 100 } })) });
	assert.equal(invalid.status, 502);
});
test('Audiocity transfers signed raw audio and previews on one origin without forwarding OAuth credentials', async () => {
	const { repository, token } = await connected();
	const uploaded = request('uploads?title=Rain&category=recording&license=arr&listed=1&downloadable=0', token, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Audiocom-Filename': 'rain.wav', 'X-Audiocom-Content-Length': '4' }, body: new Uint8Array([1, 2, 3, 4]) });
	const calls: string[] = [];
	const media = `${ORIGIN}/media/${ID}?expires=1792080000&signature=${SIGNATURE}`;
	const response = await handleAudiocomUploadRequest(context(uploaded), { repository, now: () => NOW, fetchImpl: async (input, init) => {
		const url = new URL(String(input));
		assert.equal(url.origin, ORIGIN);
		calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
		if (url.pathname === '/v1/audio/create') {
			assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-provider-access');
			return json({ audio, url: `${ORIGIN}/uploads/${ID}?token=${SIGNATURE}`, success: `${ORIGIN}/uploads/${ID}/success?token=${SIGNATURE}`, fail: `${ORIGIN}/uploads/${ID}/fail?token=${SIGNATURE}` }, 201);
		}
		if (url.pathname === '/v1/audio/view') {
			assert.equal(url.searchParams.get('id'), ID);
			assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-provider-access');
			return json({ ...audio, status: 'ready', play: { duration: 1500, url: media } });
		}
		assert.equal(new Headers(init?.headers).has('Authorization'), false);
		if (init?.method === 'PUT') {
			assert.equal(init.signal, uploaded.signal);
			assert.ok(init.body instanceof ReadableStream);
			assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
		}
		return new Response(null, { status: 204 });
	} });
	assert.equal(response.status, 201, await response.clone().text());
	assert.deepEqual(calls, ['POST /v1/audio/create', `PUT /uploads/${ID}`, `POST /uploads/${ID}/success`, 'GET /v1/audio/view']);
	const result = await response.json() as { data: { audio: { durationSeconds: number; previewUrl: string }; processing: boolean } };
	assert.equal(result.data.processing, false);
	assert.equal(result.data.audio.durationSeconds, 1.5);
	assert.equal(result.data.audio.previewUrl, `/api/audiocom/preview?url=${encodeURIComponent(media)}`);
	const preview = request(`preview?url=${encodeURIComponent(media)}`, token, { headers: { Range: 'bytes=0-3' } });
	const played = await handleAudiocomPreviewRequest(context(preview), { repository, now: () => NOW, fetchImpl: (input, init) => {
		assert.equal(String(input), media);
		assert.equal(init?.signal, preview.signal);
		assert.equal(new Headers(init?.headers).has('Authorization'), false);
		assert.equal(new Headers(init?.headers).get('Range'), 'bytes=0-3');
		return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'Content-Type': 'audio/wav', 'Content-Range': 'bytes 0-3/4' } }));
	} });
	assert.equal(played.status, 206);
	assert.equal((await played.arrayBuffer()).byteLength, 4);
});

test('Audiocity previews an original application/ogg source while the public provider keeps CDN MIME pins', async () => {
	const { repository, token } = await connected();
	const media = `${ORIGIN}/media/${ID}?expires=1792080000&signature=${SIGNATURE}`;
	const response = await handleAudiocomPreviewRequest(context(request(`preview?url=${encodeURIComponent(media)}`, token)), { repository, now: () => NOW, fetchImpl: () => Promise.resolve(new Response(new Uint8Array(4), { headers: { 'Content-Type': 'application/ogg' } })) });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Content-Type'), 'application/ogg');
	await response.arrayBuffer();
});

test('a committed Audiocity upload remains successful when its optional metadata refresh is unavailable', async () => {
	const { repository, token } = await connected();
	const upload = request('uploads?title=Rain&category=recording&license=arr&listed=0&downloadable=0', token, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Audiocom-Filename': 'rain.wav', 'X-Audiocom-Content-Length': '4' }, body: new Uint8Array(4) });
	const calls: string[] = [];
	const response = await handleAudiocomUploadRequest(context(upload), { repository, now: () => NOW, fetchImpl: async (input, init) => {
		const url = new URL(String(input));
		calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
		if (url.pathname === '/v1/audio/create') return json({ audio, url: `${ORIGIN}/uploads/${ID}?token=${SIGNATURE}`, success: `${ORIGIN}/uploads/${ID}/success?token=${SIGNATURE}`, fail: `${ORIGIN}/uploads/${ID}/fail?token=${SIGNATURE}` }, 201);
		if (url.pathname === '/v1/audio/view') return new Response(null, { status: 503 });
		if (init?.body instanceof ReadableStream) await new Response(init.body).arrayBuffer();
		return new Response(null, { status: 204 });
	} });
	assert.equal(response.status, 201);
	const result = await response.json() as { data: { audio: { id: string; url: string }; processing: boolean } };
	assert.equal(result.data.processing, false);
	assert.equal(result.data.audio.id, ID);
	assert.equal(result.data.audio.url, `${ORIGIN}/public/audio/${ID}`);
	assert.deepEqual(calls, ['POST /v1/audio/create', `PUT /uploads/${ID}`, `POST /uploads/${ID}/success`, 'GET /v1/audio/view']);
});
