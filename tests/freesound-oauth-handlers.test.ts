/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeBase64Url } from '../functions/api/freesound/_shared/oauth-crypto.ts';
import {
	handleFreesoundOAuthCallbackRequest,
	handleFreesoundOAuthPollRequest,
	handleFreesoundOAuthSessionRequest,
	handleFreesoundOAuthStartRequest,
} from '../functions/api/freesound/_shared/oauth-handlers.ts';
import type {
	FreesoundOAuthEnv,
	FreesoundOAuthFunctionContext,
} from '../functions/api/freesound/_shared/oauth-http.ts';
import { MemoryFreesoundOAuthRepository } from './helpers/freesound-oauth-memory-repository.ts';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const MASTER_KEY = `v1:${encodeBase64Url(new Uint8Array(32).fill(7))}`;
const ENV: FreesoundOAuthEnv = {
	FREESOUND_CLIENT_ID: 'client-id',
	FREESOUND_CLIENT_SECRET: 'client-secret',
	FREESOUND_OAUTH_MASTER_KEY: MASTER_KEY,
};

interface StartedOAuth {
	readonly attemptId: string;
	readonly handoffToken: string;
	readonly authorizeUrl: string;
	readonly expiresAt: string;
}

function context(request: Request): FreesoundOAuthFunctionContext {
	return { request, env: ENV, params: {} };
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function post(url: string, value: unknown): Request {
	return new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://soundscaper.org' },
		body: JSON.stringify(value),
	});
}

function desktopPost(url: string, value: unknown): Request {
	return new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'soundscaper-app://bundle' },
		body: JSON.stringify(value),
	});
}

function oauthFetch(
	accessToken = 'access-token',
	refreshToken = 'refresh-token',
): { readonly fetchImpl: typeof fetch; readonly requests: Request[] } {
	const requests: Request[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		const url = new URL(request.url);
		if (url.pathname === '/apiv2/oauth2/access_token/') {
			assert.equal(request.method, 'POST');
			const form = new URLSearchParams(await request.text());
			assert.equal(form.get('client_id'), 'client-id');
			assert.equal(form.get('client_secret'), 'client-secret');
			assert.equal(form.get('grant_type'), 'authorization_code');
			assert.equal(form.get('code'), 'one-time-code');
			return jsonResponse({ access_token: accessToken, refresh_token: refreshToken, expires_in: 86_400 });
		}
		if (url.pathname === '/apiv2/me/') {
			assert.equal(request.headers.get('authorization'), `Bearer ${accessToken}`);
			return jsonResponse({ unique_id: 42, username: 'field-recordist' });
		}
		throw new Error(`Unexpected upstream request: ${url.pathname}`);
	};
	return { fetchImpl, requests };
}

async function start(
	repository: MemoryFreesoundOAuthRepository,
	client: 'web' | 'desktop' = 'web',
): Promise<StartedOAuth> {
	const response = await handleFreesoundOAuthStartRequest(context((client === 'desktop' ? desktopPost : post)(
		'https://soundscaper.org/api/freesound/oauth/start',
		{ client },
	)), { repository, now: () => NOW });
	assert.equal(response.status, 201);
	return (await response.json() as { data: StartedOAuth }).data;
}

async function callback(
	repository: MemoryFreesoundOAuthRepository,
	started: StartedOAuth,
	fetchImpl: typeof fetch,
): Promise<Response> {
	const state = new URL(started.authorizeUrl).searchParams.get('state');
	assert(state);
	return handleFreesoundOAuthCallbackRequest(context(new Request(
		`https://soundscaper.org/api/freesound/oauth/callback?code=one-time-code&state=${encodeURIComponent(state)}`,
	)), { repository, now: () => NOW, fetchImpl });
}

test('web OAuth keeps state and handoff separate, then establishes an HttpOnly session through polling', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const started = await start(repository);
	const authorization = new URL(started.authorizeUrl);

	assert.equal(authorization.origin, 'https://freesound.org');
	assert.equal(authorization.pathname, '/apiv2/oauth2/authorize/');
	assert.equal(authorization.searchParams.get('client_id'), 'client-id');
	assert.equal(authorization.searchParams.get('response_type'), 'code');
	assert.equal(authorization.searchParams.get('redirect_uri'), 'https://soundscaper.org/api/freesound/oauth/callback');
	assert.notEqual(authorization.searchParams.get('state'), started.handoffToken);
	assert.equal(JSON.stringify([...repository.attempts.values()]).includes(started.handoffToken), false);

	const pending = await handleFreesoundOAuthPollRequest(context(post(
		'https://soundscaper.org/api/freesound/oauth/poll',
		{ attemptId: started.attemptId, handoffToken: started.handoffToken },
	)), { repository, now: () => NOW });
	assert.equal(pending.status, 202);
	assert.deepEqual(await pending.json(), { data: { status: 'pending' } });

	const upstream = oauthFetch();
	const completed = await callback(repository, started, upstream.fetchImpl);
	assert.equal(completed.status, 200);
	assert.match(await completed.text(), /Freesound connected/u);
	assert.equal(upstream.requests.length, 2);

	const polled = await handleFreesoundOAuthPollRequest(context(post(
		'https://soundscaper.org/api/freesound/oauth/poll',
		{ attemptId: started.attemptId, handoffToken: started.handoffToken },
	)), { repository, now: () => NOW });
	assert.equal(polled.status, 200);
	assert.deepEqual(await polled.json(), {
		data: { status: 'connected', user: { id: 42, username: 'field-recordist' } },
	});
	const cookie = polled.headers.get('set-cookie');
	assert(cookie);
	assert.match(cookie, /^__Host-freesound_session=[A-Za-z0-9_-]+;/u);
	assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/u);
	assert.doesNotMatch(cookie, /access-token|refresh-token/u);

	const session = await handleFreesoundOAuthSessionRequest(context(new Request(
		'https://soundscaper.org/api/freesound/oauth/session',
		{ headers: { Cookie: cookie.split(';', 1)[0] ?? '' } },
	)), { repository, now: () => NOW });
	assert.deepEqual(await session.json(), {
		data: { connected: true, user: { id: 42, username: 'field-recordist' } },
	});
});

test('desktop polling returns only the opaque Soundscaper session bearer and remains retryable', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const started = await start(repository, 'desktop');
	const upstream = oauthFetch();
	assert.equal((await callback(repository, started, upstream.fetchImpl)).status, 200);
	const request = () => context(desktopPost(
		'https://soundscaper.org/api/freesound/oauth/poll',
		{ attemptId: started.attemptId, handoffToken: started.handoffToken },
	));

	const first = await handleFreesoundOAuthPollRequest(request(), { repository, now: () => NOW });
	const second = await handleFreesoundOAuthPollRequest(request(), { repository, now: () => NOW });
	const firstData = (await first.json() as { data: { sessionToken: string } }).data;
	const secondData = (await second.json() as { data: { sessionToken: string } }).data;

	assert.match(firstData.sessionToken, /^[A-Za-z0-9_-]{43}$/u);
	assert.equal(secondData.sessionToken, firstData.sessionToken);
	assert.equal(first.headers.get('set-cookie'), null);
	assert.doesNotMatch(JSON.stringify(firstData), /access-token|refresh-token/u);
});

test('wrong handoff capabilities and expired attempts fail without disclosing their state', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const started = await start(repository);
	const wrong = await handleFreesoundOAuthPollRequest(context(post(
		'https://soundscaper.org/api/freesound/oauth/poll',
		{ attemptId: started.attemptId, handoffToken: 'x'.repeat(43) },
	)), { repository, now: () => NOW });
	assert.equal(wrong.status, 404);
	assert.equal((await wrong.json() as { error: { code: string } }).error.code, 'authorization_not_found');

	const expired = await handleFreesoundOAuthPollRequest(context(post(
		'https://soundscaper.org/api/freesound/oauth/poll',
		{ attemptId: started.attemptId, handoffToken: started.handoffToken },
	)), { repository, now: () => NOW + 10 * 60 * 1_000 });
	assert.equal(expired.status, 410);
});

test('reconnecting the same Freesound user rotates one canonical grant without invalidating existing sessions', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const first = await start(repository);
	assert.equal((await callback(repository, first, oauthFetch('access-1', 'refresh-1').fetchImpl)).status, 200);
	const firstPoll = await handleFreesoundOAuthPollRequest(context(post(
		'https://soundscaper.org/api/freesound/oauth/poll',
		{ attemptId: first.attemptId, handoffToken: first.handoffToken },
	)), { repository, now: () => NOW });
	const firstCookie = firstPoll.headers.get('set-cookie');
	assert(firstCookie);

	const second = await start(repository);
	assert.equal((await callback(repository, second, oauthFetch('access-2', 'refresh-2').fetchImpl)).status, 200);
	assert.equal(repository.grants.size, 1);
	assert.equal([...repository.grants.keys()][0], 'freesound-user-42');
	assert.equal(repository.grants.get('freesound-user-42')?.refreshGeneration, 1);

	const oldSession = await handleFreesoundOAuthSessionRequest(context(new Request(
		'https://soundscaper.org/api/freesound/oauth/session',
		{ headers: { Cookie: firstCookie.split(';', 1)[0] ?? '' } },
	)), { repository, now: () => NOW });
	assert.equal((await oldSession.json() as { data: { connected: boolean } }).data.connected, true);
});

test('mutating OAuth endpoints reject untrusted or missing browser origins before storage access', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	for (const request of [
		new Request('https://soundscaper.org/api/freesound/oauth/start', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: 'web' }),
		}),
		new Request('https://soundscaper.org/api/freesound/oauth/start', {
			method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
			body: JSON.stringify({ client: 'web' }),
		}),
	]) {
		const response = await handleFreesoundOAuthStartRequest(context(request), { repository, now: () => NOW });
		assert.equal(response.status, 403);
	}
	assert.equal(repository.attempts.size, 0);
});

test('a web origin cannot request a desktop handoff bearer', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const response = await handleFreesoundOAuthStartRequest(context(post(
		'https://soundscaper.org/api/freesound/oauth/start',
		{ client: 'desktop' },
	)), { repository, now: () => NOW });
	assert.equal(response.status, 403);
	assert.equal((await response.json() as { error: { code: string } }).error.code, 'client_origin_mismatch');
	assert.equal(repository.attempts.size, 0);
});

test('isolated Pages previews fail closed instead of writing state that the production callback cannot read', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const response = await handleFreesoundOAuthStartRequest(context(new Request(
		'https://feature.soundscaper.pages.dev/api/freesound/oauth/start',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: 'https://feature.soundscaper.pages.dev' },
			body: JSON.stringify({ client: 'web' }),
		},
	)), { repository, now: () => NOW });
	assert.equal(response.status, 503);
	assert.equal((await response.json() as { error: { code: string } }).error.code, 'oauth_unavailable_in_preview');
	assert.equal(repository.attempts.size, 0);
});

test('OAuth denial is terminal and callback state cannot be replayed', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const started = await start(repository);
	const state = new URL(started.authorizeUrl).searchParams.get('state');
	assert(state);
	const deniedUrl = `https://soundscaper.org/api/freesound/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`;
	const first = await handleFreesoundOAuthCallbackRequest(context(new Request(deniedUrl)), {
		repository,
		now: () => NOW,
	});
	assert.equal(first.status, 200);
	assert.match(await first.text(), /cancelled/u);
	const replay = await handleFreesoundOAuthCallbackRequest(context(new Request(deniedUrl)), {
		repository,
		now: () => NOW,
	});
	assert.equal(replay.status, 409);
});

test('OAuth callback enforces one result while admitting Freesound original_path', async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const started = await start(repository);
	const state = new URL(started.authorizeUrl).searchParams.get('state');
	assert(state);
	const callbackUrl = new URL('https://soundscaper.org/api/freesound/oauth/callback');
	callbackUrl.searchParams.set('state', state);
	callbackUrl.searchParams.set('code', 'one-time-code');
	callbackUrl.searchParams.set('error', 'access_denied');
	let response = await handleFreesoundOAuthCallbackRequest(context(new Request(callbackUrl)), {
		repository,
		now: () => NOW,
	});
	assert.equal(response.status, 400);

	callbackUrl.searchParams.delete('error');
	callbackUrl.searchParams.delete('code');
	callbackUrl.searchParams.set('error_description', 'Denied without an OAuth error');
	response = await handleFreesoundOAuthCallbackRequest(context(new Request(callbackUrl)), {
		repository,
		now: () => NOW,
	});
	assert.equal(response.status, 400);

	callbackUrl.searchParams.delete('error_description');
	callbackUrl.searchParams.set('code', 'one-time-code');
	callbackUrl.searchParams.append('original_path', '/first');
	callbackUrl.searchParams.append('original_path', '/second');
	response = await handleFreesoundOAuthCallbackRequest(context(new Request(callbackUrl)), {
		repository,
		now: () => NOW,
	});
	assert.equal(response.status, 400);

	callbackUrl.searchParams.delete('original_path');
	callbackUrl.searchParams.set('original_path', `/${'x'.repeat(2_048)}`);
	response = await handleFreesoundOAuthCallbackRequest(context(new Request(callbackUrl)), {
		repository,
		now: () => NOW,
	});
	assert.equal(response.status, 400);

	callbackUrl.searchParams.set('original_path', '/apiv2/oauth2/logout_and_authorize/');
	response = await handleFreesoundOAuthCallbackRequest(context(new Request(callbackUrl)), {
		repository,
		now: () => NOW,
		fetchImpl: oauthFetch().fetchImpl,
	});
	assert.equal(response.status, 200);
});
