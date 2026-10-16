/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAudiocomOAuthStartRequest, handleAudiocomOAuthCallbackRequest, handleAudiocomOAuthPollRequest } from '../functions/api/audiocom/_shared/oauth-handlers.ts';
import { handleAudiocomUsageRequest } from '../functions/api/audiocom/_shared/handlers.ts';
import { assertAudiocomAuthorizationUrl } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';
import { MemoryAudiocomOAuthRepository } from './helpers/audiocom-oauth-memory-repository.ts';

const previewOrigin = 'https://feat-audio-com-integration.soundscaper-5ki.pages.dev';
const hashOrigin = 'https://31da7261.soundscaper-5ki.pages.dev';
const callback = `${previewOrigin}/api/audiocom/oauth/callback`;
const env = {
	AUDIOCOM_CLIENT_ID: 'preview-client',
	AUDIOCOM_OAUTH_MASTER_KEY: `v1:${Buffer.alloc(32, 9).toString('base64url')}`,
	AUDIOCOM_OAUTH_REDIRECT_URI: callback,
};
const request = (origin: string, path = 'start', body: unknown = { client: 'web' }): Request => new Request(`${origin}/api/audiocom/oauth/${path}`, {
	method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(body),
});

test('Pages hash previews complete PKCE through a configured stable branch callback', async () => {
	const repository = new MemoryAudiocomOAuthRepository();
	const context = { request: request(hashOrigin), env, params: {} };
	const started = await handleAudiocomOAuthStartRequest(context, { repository });
	assert.equal(started.status, 201, await started.clone().text());
	const { data } = await started.json() as { data: { authorizeUrl: string; attemptId: string; handoffToken: string } };
	const authorization = new URL(data.authorizeUrl);
	assert.equal(authorization.searchParams.get('redirect_uri'), callback);
	assert.equal(assertAudiocomAuthorizationUrl(authorization.href, { origin: hashOrigin, protocol: 'https:' }), authorization.href);
	const callbackRequest = new Request(`${callback}?code=provider-code&state=${authorization.searchParams.get('state') ?? ''}`);
	const wrongHost = await handleAudiocomOAuthCallbackRequest({ ...context, request: new Request(callbackRequest.url.replace(previewOrigin, hashOrigin)) }, { repository });
	assert.equal(wrongHost.status, 400);
	const completed = await handleAudiocomOAuthCallbackRequest({ ...context, request: callbackRequest }, {
		repository, fetchImpl: async (_url, init) => {
			assert.equal(new URLSearchParams(String(init?.body)).get('redirect_uri'), callback);
			return Response.json({ token_type: 'Bearer', access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'public' });
		},
	});
	assert.equal(completed.status, 200);
	const polled = await handleAudiocomOAuthPollRequest({ ...context, request: request(hashOrigin, 'poll', { attemptId: data.attemptId, handoffToken: data.handoffToken }) }, { repository });
	assert.equal(polled.status, 200);
	assert.match(polled.headers.get('Set-Cookie') ?? '', /^__Host-audiocom_session=.+; Path=\/;.*Secure; HttpOnly; SameSite=Strict$/u);
	assert.equal((polled.headers.get('Set-Cookie') ?? '').includes('Domain='), false);
});

test('production and foreign editors cannot redirect authorization into preview storage', async () => {
	const response = await handleAudiocomOAuthStartRequest({ request: request('https://soundscaper.org'), env, params: {} }, { repository: new MemoryAudiocomOAuthRepository() });
	assert.equal(response.status, 503);
	const authorization = new URL('https://api.audio.com/auth/authorize');
	authorization.search = new URLSearchParams({ client_id: 'preview', response_type: 'code', scope: 'public', state: 'state', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43), redirect_uri: callback }).toString();
	for (const origin of ['https://soundscaper.org', 'https://evil.pages.dev', 'https://31da7261.soundscaper-5ki.pages.dev.evil.test']) {
		assert.throws(() => assertAudiocomAuthorizationUrl(authorization.href, { origin, protocol: 'https:' }), /callback/iu);
	}
});

test('preview API admission uses the actual Pages project and requires explicit preview OAuth configuration', async () => {
	const usage = await handleAudiocomUsageRequest({ request: new Request(`${hashOrigin}/api/audiocom/usage`), env: {}, params: {} });
	assert.equal(usage.status, 200);
	const unconfigured = await handleAudiocomOAuthStartRequest({ request: request(hashOrigin), env: { ...env, AUDIOCOM_OAUTH_REDIRECT_URI: undefined }, params: {} });
	assert.equal(unconfigured.status, 503);
	for (const origin of ['https://evil.pages.dev', 'https://soundscaper-5ki.pages.dev.evil.test', 'http://31da7261.soundscaper-5ki.pages.dev', 'https://31da7261.soundscaper-5ki.pages.dev:444']) {
		assert.equal((await handleAudiocomUsageRequest({ request: new Request(`${origin}/api/audiocom/usage`), env, params: {} })).status, 404);
	}
});

test('preview callbacks cannot target production, another Pages project, or a malformed callback', async () => {
	for (const redirect of [
		'https://soundscaper.org/api/audiocom/oauth/callback', 'https://evil.pages.dev/api/audiocom/oauth/callback',
		callback.replace('https:', 'http:'), callback.replace('.dev/', '.dev:444/'), `${callback}?extra=1`, `${callback}#fragment`,
		callback.replace('https://', 'https://user@'), callback.replace('/callback', '/other'),
	]) {
		const response = await handleAudiocomOAuthStartRequest({ request: request(hashOrigin), env: { ...env, AUDIOCOM_OAUTH_REDIRECT_URI: redirect }, params: {} }, { repository: new MemoryAudiocomOAuthRepository() });
		assert.equal(response.status, 503, redirect);
		const authorization = new URL('https://api.audio.com/auth/authorize');
		authorization.search = new URLSearchParams({ client_id: 'preview', response_type: 'code', scope: 'public', state: 'state', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43), redirect_uri: redirect }).toString();
		assert.throws(() => assertAudiocomAuthorizationUrl(authorization.href, { origin: hashOrigin, protocol: 'https:' }), /callback/iu, redirect);
	}
});
