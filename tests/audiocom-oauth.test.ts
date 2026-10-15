/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAudiocomOAuthStartRequest, handleAudiocomOAuthCallbackRequest, handleAudiocomOAuthPollRequest, handleAudiocomOAuthSessionRequest, accessTokenForSession } from '../functions/api/audiocom/_shared/oauth-handlers.ts';
import { hashCapability } from '../functions/api/audiocom/_shared/oauth-crypto.ts';
import { encodeBase64Url } from '../functions/api/freesound/_shared/oauth-crypto.ts';
import type { AudiocomOAuthFunctionContext } from '../functions/api/audiocom/_shared/oauth-http.ts';
import { MemoryAudiocomOAuthRepository } from './helpers/audiocom-oauth-memory-repository.ts';

const NOW = Date.UTC(2026, 9, 15);
const env = { AUDIOCOM_CLIENT_ID: 'client', AUDIOCOM_OAUTH_MASTER_KEY: `v1:${encodeBase64Url(new Uint8Array(32).fill(9))}` };
interface Attempt { readonly attemptId: string; readonly handoffToken: string; readonly authorizeUrl: string }
const context = (request: Request): AudiocomOAuthFunctionContext => ({ request, env, params: {} });
const post = (path: string, value: unknown, desktop = false): Request => new Request(`https://soundscaper.org/api/audiocom/${path}`, {
	method: 'POST', headers: { Origin: desktop ? 'soundscaper-app://bundle' : 'https://soundscaper.org', 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});
const json = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
async function connected(desktop = false): Promise<{ repository: MemoryAudiocomOAuthRepository; token: string; attempt: Attempt }> {
	const repository = new MemoryAudiocomOAuthRepository();
	const response = await handleAudiocomOAuthStartRequest(context(post('oauth/start', { client: desktop ? 'desktop' : 'web' }, desktop)), { repository, now: () => NOW });
	assert.equal(response.status, 201);
	const { data: attempt } = await response.json() as { data: Attempt };
	const authorize = new URL(attempt.authorizeUrl);
	assert.equal(authorize.origin, 'https://api.audio.com');
	assert.equal(authorize.searchParams.get('scope'), 'public');
	assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
	assert.equal(authorize.searchParams.has('code_verifier'), false);
	const callback = await handleAudiocomOAuthCallbackRequest(context(new Request(`https://soundscaper.org/api/audiocom/oauth/callback?code=code&state=${authorize.searchParams.get('state') ?? ''}`)), {
		repository, now: () => NOW,
		fetchImpl: async (input, init) => {
			assert.equal(String(input), 'https://api.audio.com/auth/token');
			const fields = new URLSearchParams(String(init?.body));
			assert.equal(fields.get('code'), 'code');
			assert.equal(await hashCapability(fields.get('code_verifier') ?? ''), authorize.searchParams.get('code_challenge'));
			assert.equal(fields.has('client_secret'), false);
			return json({ token_type: 'Bearer', scope: 'public', access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: 3600 });
		},
	});
	assert.equal(callback.status, 200, await callback.text());
	const poll = await handleAudiocomOAuthPollRequest(context(post('oauth/poll', { attemptId: attempt.attemptId, handoffToken: attempt.handoffToken }, desktop)), { repository, now: () => NOW });
	assert.equal(poll.status, 200);
	const body = await poll.text();
	assert.equal(body.includes('secret-access'), false);
	assert.equal(body.includes('secret-refresh'), false);
	assert.equal(body.includes('user'), false);
	const data = JSON.parse(body) as { data: { sessionToken?: string } };
	const token = desktop ? data.data.sessionToken ?? '' : /^__Host-audiocom_session=([^;]+)/u.exec(poll.headers.get('set-cookie') ?? '')?.[1] ?? '';
	assert.ok(token);
	if (!desktop) assert.match(poll.headers.get('set-cookie') ?? '', /Secure; HttpOnly; SameSite=Strict/u);
	const serialized = JSON.stringify([...repository.grants.values()]);
	assert.equal(serialized.includes('secret-access'), false);
	assert.equal(serialized.includes('secret-refresh'), false);
	return { repository, token, attempt };
}

test('audio.com web OAuth uses encrypted PKCE and HttpOnly sessions without leaking provider credentials', async () => { await connected(); });
test('audio.com desktop handoff yields only an opaque app capability', async () => { await connected(true); });
test('audio.com session restores and disconnect removes the authorization', async () => {
	const { repository, token } = await connected();
	const response = await handleAudiocomOAuthSessionRequest(context(new Request('https://soundscaper.org/api/audiocom/oauth/session', { headers: { Cookie: `__Host-audiocom_session=${token}` } })), { repository, now: () => NOW });
	assert.deepEqual(await response.json(), { data: { connected: true } });
	const disconnected = await handleAudiocomOAuthSessionRequest(context(new Request('https://soundscaper.org/api/audiocom/oauth/session', { method: 'DELETE', headers: { Cookie: `__Host-audiocom_session=${token}`, Origin: 'https://soundscaper.org' } })), { repository, now: () => NOW });
	assert.equal(disconnected.status, 200);
	assert.equal(repository.grants.size, 0);
});
test('audio.com refuses foreign mutation origins and preview sign-in', async () => {
	const repository = new MemoryAudiocomOAuthRepository();
	const foreign = new Request('https://soundscaper.org/api/audiocom/oauth/start', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{"client":"web"}' });
	assert.equal((await handleAudiocomOAuthStartRequest(context(foreign), { repository })).status, 403);
	const preview = new Request('https://preview.soundscaper.pages.dev/api/audiocom/oauth/start', { method: 'POST', headers: { Origin: 'https://preview.soundscaper.pages.dev', 'Content-Type': 'application/json' }, body: '{"client":"web"}' });
	assert.equal((await handleAudiocomOAuthStartRequest(context(preview), { repository })).status, 503);
});
test('audio.com pending attempts require the matching handoff secret', async () => {
	const repository = new MemoryAudiocomOAuthRepository();
	const started = await handleAudiocomOAuthStartRequest(context(post('oauth/start', { client: 'web' })), { repository, now: () => NOW });
	const { data } = await started.json() as { data: Attempt };
	assert.equal((await handleAudiocomOAuthPollRequest(context(post('oauth/poll', { attemptId: data.attemptId, handoffToken: 'x'.repeat(43) })), { repository, now: () => NOW })).status, 404);
	assert.equal((await handleAudiocomOAuthPollRequest(context(post('oauth/poll', { attemptId: data.attemptId, handoffToken: data.handoffToken })), { repository, now: () => NOW })).status, 202);
});
test('audio.com refresh serializes rotation and preserves encrypted provider credentials', async () => {
	const { repository, token } = await connected();
	const request = new Request('https://soundscaper.org/api/audiocom/search', { headers: { Cookie: `__Host-audiocom_session=${token}` } });
	let refreshes = 0;
	const dependencies = { repository, now: () => NOW + 3_590_000, fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
		refreshes += 1;
		const fields = new URLSearchParams(String(init?.body));
		assert.equal(fields.get('refresh_token'), 'secret-refresh');
		return json({ token_type: 'Bearer', access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
	} };
	const results = await Promise.all([accessTokenForSession(context(request), dependencies), accessTokenForSession(context(request), dependencies)]);
	assert.equal(refreshes, 1);
	assert.ok(results.every(result => result.accessToken === 'rotated-access'));
});

test('audio.com callback cannot be replayed and expired attempts cannot be polled', async () => {
	const { repository, attempt } = await connected();
	const state = new URL(attempt.authorizeUrl).searchParams.get('state') ?? '';
	const replay = await handleAudiocomOAuthCallbackRequest(context(new Request(`https://soundscaper.org/api/audiocom/oauth/callback?code=code&state=${state}`)), { repository, now: () => NOW });
	assert.equal(replay.status, 409);
	const expired = await handleAudiocomOAuthPollRequest(context(post('oauth/poll', { attemptId: attempt.attemptId, handoffToken: attempt.handoffToken })), { repository, now: () => NOW + 600_001 });
	assert.equal(expired.status, 410);
});
test('audio.com refuses cross-site fetches and ambiguous or mismatched session transports', async () => {
	const { repository, token } = await connected();
	const crossSite = new Request(post('oauth/start', { client: 'web' }), { headers: { Origin: 'https://soundscaper.org', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' } });
	assert.equal((await handleAudiocomOAuthStartRequest(context(crossSite), { repository })).status, 403);
	for (const headers of [new Headers({ Authorization: `Bearer ${token}`, Cookie: `__Host-audiocom_session=${token}` }), new Headers({ Authorization: `Bearer ${token}` })]) {
		await assert.rejects(accessTokenForSession(context(new Request('https://soundscaper.org/api/audiocom/search', { headers })), { repository, now: () => NOW }), /Connect to/u);
	}
});

test('audio.com rejects nonstandard production callback ports', async () => {
	const repository = new MemoryAudiocomOAuthRepository();
	const request = post('oauth/start', { client: 'web' });
	const response = await handleAudiocomOAuthStartRequest({ request, env: { ...env, AUDIOCOM_OAUTH_REDIRECT_URI: 'https://soundscaper.org:8443/api/audiocom/oauth/callback' }, params: {} }, { repository, now: () => NOW });
	assert.equal(response.status, 503);
});
