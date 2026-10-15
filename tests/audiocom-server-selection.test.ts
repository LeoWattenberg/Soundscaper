/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAudiocomOAuthStartRequest, handleAudiocomOAuthCallbackRequest, handleAudiocomOAuthPollRequest, handleAudiocomOAuthSessionRequest } from '../functions/api/audiocom/_shared/oauth-handlers.ts';
import { handleAudiocomSearchRequest, handleAudiocomUsageRequest, handleAudiocomPreviewRequest } from '../functions/api/audiocom/_shared/handlers.ts';
import { MemoryAudiocomOAuthRepository } from './helpers/audiocom-oauth-memory-repository.ts';
import type { AudiocomOAuthFunctionContext } from '../functions/api/audiocom/_shared/oauth-http.ts';

const EDITOR = 'https://soundscaper.org';
const CUSTOM = 'https://recordings.example';
const CALLBACK = `${EDITOR}/api/audiocom/oauth/callback`;
const NOW = Date.UTC(2026, 9, 15);
const env = { AUDIOCOM_CLIENT_ID: 'official-client', AUDIOCOM_CLIENT_SECRET: 'official-secret', AUDIOCOM_OAUTH_MASTER_KEY: `v1:${Buffer.alloc(32, 3).toString('base64url')}` };
interface Attempt { attemptId: string; handoffToken: string; authorizeUrl: string }
function context(path: string, server?: string, init: RequestInit = {}): AudiocomOAuthFunctionContext {
	const headers = new Headers(init.headers);
	if (server) headers.set('X-Audiocom-Api-Origin', server);
	if (init.method === 'POST') { headers.set('Origin', EDITOR); headers.set('Content-Type', 'application/json'); }
	return { request: new Request(`${EDITOR}/api/audiocom/${path}`, { ...init, headers }), env, params: {} };
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const grant = (): Response => Response.json({ token_type: 'Bearer', expires_in: 31_536_000, access_token: 'private-access', refresh_token: 'private-refresh', scope: 'public projects' });
async function start(repository: MemoryAudiocomOAuthRepository): Promise<Attempt> {
	const started = await handleAudiocomOAuthStartRequest(context('oauth/start', CUSTOM, post({ client: 'web' })), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			assert.equal(String(input), `${CUSTOM}/auth/client`);
			assert.equal(new Headers(init?.headers).has('Authorization'), false);
			const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
			assert.equal(request.token_endpoint_auth_method, 'none');
			assert.deepEqual(request.redirect_uris, [CALLBACK]);
			assert.equal(String(init?.body).includes('official-secret'), false);
			return Response.json({ client_id: 'custom-client', token_endpoint_auth_method: 'none', redirect_uris: [CALLBACK] }, { status: 201 });
		},
	});
	assert.equal(started.status, 201, await started.clone().text());
	return (await started.json() as { data: Attempt }).data;
}
async function connected(): Promise<{ repository: MemoryAudiocomOAuthRepository; cookie: string }> {
	const repository = new MemoryAudiocomOAuthRepository();
	const attempt = await start(repository);
	const authorization = new URL(attempt.authorizeUrl);
	assert.equal(authorization.origin, CUSTOM);
	const callback = await handleAudiocomOAuthCallbackRequest(context(`oauth/callback?code=code&state=${authorization.searchParams.get('state') ?? ''}`), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			assert.equal(String(input), `${CUSTOM}/auth/token`);
			const fields = new URLSearchParams(String(init?.body));
			assert.equal(fields.get('client_id'), 'custom-client');
			assert.equal(fields.get('redirect_uri'), CALLBACK);
			assert.equal(fields.has('client_secret'), false);
			return grant();
		},
	});
	assert.equal(callback.status, 200, await callback.clone().text());
	const poll = await handleAudiocomOAuthPollRequest(context('oauth/poll', CUSTOM, post({ attemptId: attempt.attemptId, handoffToken: attempt.handoffToken })), { repository, now: () => NOW });
	assert.equal(poll.status, 200, await poll.clone().text());
	const cookie = poll.headers.get('Set-Cookie')?.split(';')[0] ?? '';
	assert.ok(cookie);
	return { repository, cookie };
}

test('user-selected server registers a separate client and callback uses the persisted issuer without a preference header', async () => {
	const { repository, cookie } = await connected();
	const searched = await handleAudiocomSearchRequest(context('search?q=tone', CUSTOM, { headers: { Cookie: cookie } }), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			assert.equal(new URL(String(input)).origin, CUSTOM);
			assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-access');
			return Response.json([]);
		},
	});
	assert.equal(searched.status, 200, await searched.text());
});

test('changing the selected server never forwards the previous grant or refresh credential', async () => {
	const { repository, cookie } = await connected();
	for (const selected of ['https://api.audio.com', 'https://another.example']) {
		let calls = 0;
		const response = await handleAudiocomSearchRequest(context('search?q=tone', selected, { headers: { Cookie: cookie } }), {
			repository, now: () => NOW + 8 * 86_400_000, fetchImpl: async () => { calls++; return Response.json([]); },
		});
		assert.equal(response.status, 401);
		assert.equal(calls, 0);
	}
	const disconnected = await handleAudiocomOAuthSessionRequest(context('oauth/session', 'https://api.audio.com', { headers: { Cookie: cookie } }), { repository, now: () => NOW });
	assert.deepEqual(await disconnected.json(), { data: { connected: false } });
	assert.equal(repository.sessions.size, 0, 'switching server signs out of the abandoned connection');
});

test('refresh uses the custom registration bound to the grant and never the default client secret', async () => {
	const { repository, cookie } = await connected();
	const response = await handleAudiocomSearchRequest(context('search?q=tone', CUSTOM, { headers: { Cookie: cookie } }), {
		repository, now: () => NOW + 8 * 86_400_000, fetchImpl: async (input, init) => {
			if (new URL(String(input)).pathname === '/auth/token') {
				const fields = new URLSearchParams(String(init?.body));
				assert.equal(new URL(String(input)).origin, CUSTOM);
				assert.equal(fields.get('client_id'), 'custom-client');
				assert.equal(fields.get('refresh_token'), 'private-refresh');
				assert.equal(fields.has('client_secret'), false);
				return grant();
			}
			return Response.json([]);
		},
	});
	assert.equal(response.status, 200, await response.text());
});

test('HTML audio previews without preference headers use the authenticated custom issuer', async () => {
	const { repository, cookie } = await connected();
	const media = `${CUSTOM}/media/34c792f3-f4bb-44e8-8b0a-314210b4d933?expires=1792080000&signature=${'s'.repeat(43)}`;
	const response = await handleAudiocomPreviewRequest(context(`preview?url=${encodeURIComponent(media)}`, undefined, { headers: { Cookie: cookie } }), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			assert.equal(String(input), media);
			assert.equal(new Headers(init?.headers).has('Authorization'), false);
			return new Response('audio', { headers: { 'Content-Type': 'audio/wav' } });
		},
	});
	assert.equal(response.status, 200, await response.clone().text());
	assert.equal(await response.text(), 'audio');
});

test('explicit official server overrides a legacy deployment-selected alternate backend', async () => {
	const input = context('usage', 'https://api.audio.com');
	const response = await handleAudiocomUsageRequest({ ...input, env: { ...env, AUDIOCOM_PROVIDER: 'audiocity', AUDIOCOM_API_ORIGIN: CUSTOM } });
	assert.equal(response.status, 200);
	const { data } = await response.json() as { data: { provider: { apiOrigin: string } } };
	assert.equal(data.provider.apiOrigin, 'https://api.audio.com');
});

test('server selection rejects malformed, local, internal and non-HTTPS destinations before network work', async () => {
	for (const origin of ['http://recordings.example', 'https://recordings.example/path', 'https://user:secret@recordings.example', 'https://recordings.example?secret=1', 'https://127.0.0.1', 'https://[::1]', 'https://metadata.google.internal', 'https://localhost', 'https://localhost.', 'https://metadata.google.internal.', 'https://api.audio.com.']) {
		let calls = 0;
		const response = await handleAudiocomOAuthStartRequest(context('oauth/start', origin, post({ client: 'web' })), { repository: new MemoryAudiocomOAuthRepository(), fetchImpl: async () => { calls++; return Response.json({}); } });
		assert.equal(response.status, 400, origin);
		assert.equal(calls, 0);
	}
});

test('an accidental local-development flag on a public deployment cannot admit loopback servers', async () => {
	const input = context('oauth/start', 'http://127.0.0.1:8088', post({ client: 'web' }));
	const response = await handleAudiocomOAuthStartRequest({ ...input, env: { ...env, AUDIOCOM_LOCAL_DEVELOPMENT: '1' } }, { repository: new MemoryAudiocomOAuthRepository() });
	assert.equal(response.status, 400);
});

test('missing local OAuth storage configuration cannot create a remote client registration', async () => {
	const input = context('oauth/start', CUSTOM, post({ client: 'web' }));
	let calls = 0;
	const response = await handleAudiocomOAuthStartRequest({ ...input, env: { ...env, AUDIOCOM_OAUTH_MASTER_KEY: undefined } }, {
		repository: new MemoryAudiocomOAuthRepository(), fetchImpl: async () => { calls++; return Response.json({}); },
	});
	assert.equal(response.status, 503);
	assert.equal(calls, 0);
});

test('custom registration does not follow redirects or accept a changed callback or confidential client', async () => {
	for (const reply of [
		new Response(null, { status: 302, headers: { Location: 'https://another.example/auth/client' } }),
		Response.json({ client_id: 'client', token_endpoint_auth_method: 'none', redirect_uris: ['https://another.example/callback'] }),
		Response.json({ client_id: 'client', token_endpoint_auth_method: 'client_secret_post', redirect_uris: [CALLBACK] }),
	]) {
		const repository = new MemoryAudiocomOAuthRepository();
		let calls = 0;
		const response = await handleAudiocomOAuthStartRequest(context('oauth/start', CUSTOM, post({ client: 'web' })), {
			repository, fetchImpl: async (input, init) => {
				calls++; assert.equal(String(input), `${CUSTOM}/auth/client`); assert.equal(init?.redirect, 'manual');
				assert.ok(init?.signal instanceof AbortSignal); return reply;
			},
		});
		assert.equal(response.status, 502);
		assert.equal(calls, 1);
		assert.equal(repository.attempts.size, 0);
	}
});
