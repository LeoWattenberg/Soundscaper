/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AudiocomApiError, assertAudiocomAuthorizationUrl, createAudiocomApiClient } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';

const location = { origin: 'https://soundscaper.org', protocol: 'https:' };
const result = {
	id: '123', title: 'Forest', authorName: 'Recorder', username: 'recorder',
	url: 'https://audio.com/recorder/audio/forest', description: '', license: 'arr',
	isDownloadable: false, durationSeconds: 3,
	previewUrl: '/api/audiocom/preview?url=https%3A%2F%2Fs3.audio.com%2Faudio%2F123.mp3',
};
const authorization = (): URL => new URL(`https://api.audio.com/auth/authorize?${new URLSearchParams({
	client_id: 'client', redirect_uri: 'https://soundscaper.org/api/audiocom/oauth/callback',
	response_type: 'code', state: 'random', scope: 'public', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256',
})}`);

test('accepts only the registered authorization target and callback with PKCE', () => {
	assert.equal(assertAudiocomAuthorizationUrl(authorization().href, location), authorization().href);
	for (const [key, value] of [['redirect_uri', 'https://attacker.test/callback'], ['scope', 'private'], ['code_challenge_method', 'plain']]) {
		const url = authorization(); url.searchParams.set(key, value);
		assert.throws(() => assertAudiocomAuthorizationUrl(url.href, location), /authorization/iu);
	}
	const duplicate = authorization(); duplicate.searchParams.append('state', 'duplicate');
	assert.throws(() => assertAudiocomAuthorizationUrl(duplicate.href, location), /authorization/iu);
	const foreign = authorization(); foreign.hostname = 'attacker.test';
	assert.throws(() => assertAudiocomAuthorizationUrl(foreign.href, location), /authorization/iu);
});

test('uses same-origin credentialed control calls and consumes the connected polling contract', async () => {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const client = createAudiocomApiClient({ location, fetch: async (url, init) => {
		requests.push({ url: String(url), init });
		return Response.json({ data: { status: 'connected' } });
	} });
	assert.deepEqual(await client.pollOAuth('attempt', 'handoff'), { connected: true });
	assert.equal(requests[0].url, 'https://soundscaper.org/api/audiocom/oauth/poll');
	assert.equal(requests[0].init?.credentials, 'include');
	assert.equal(requests[0].init?.redirect, 'error');
	assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { attemptId: 'attempt', handoffToken: 'handoff' });
});

test('keeps file bytes as a Blob and preserves opt-in visibility and download metadata', async () => {
	let captured: { url: string; init?: RequestInit } | undefined;
	const file = new File(['RIFF'], 'forest take.wav', { type: 'audio/wav' });
	const client = createAudiocomApiClient({ location, fetch: async (url, init) => {
		captured = { url: String(url), init };
		return Response.json({ data: { audio: result, processing: true } });
	} });
	await client.upload(file, { title: 'Forest', description: '', category: 'recording', license: 'arr', visibility: 'unlisted', downloadable: false, rightsConfirmed: true });
	assert.equal(captured?.init?.body, file);
	const headers = new Headers(captured?.init?.headers);
	assert.equal(headers.get('X-Audiocom-Filename'), 'forest%20take.wav');
	assert.equal(headers.get('X-Audiocom-Content-Length'), '4');
	assert.equal(new URL(captured!.url).searchParams.get('listed'), '0');
	assert.equal(new URL(captured!.url).searchParams.get('downloadable'), '0');
});

test('resolves previews through the desktop protocol and rejects foreign preview links', async () => {
	const client = createAudiocomApiClient({ location: { origin: 'soundscaper-app://bundle', protocol: 'soundscaper-app:' },
		fetch: async () => Response.json({ data: { results: [result], page: 1, hasNext: false } }),
	});
	const page = await client.search({ query: 'forest', page: 1 });
	assert.match(page.results[0].previewUrl ?? '', /^soundscaper-app:\/\/bundle\/_desktop\/audiocom\/api\/audiocom\/preview\?/u);
	const malicious = createAudiocomApiClient({ location, fetch: async () => Response.json({
		data: { results: [{ ...result, previewUrl: 'https://attacker.test/audio.mp3' }], page: 1, hasNext: false },
	}) });
	await assert.rejects(malicious.search({ query: 'forest', page: 1 }), /preview/iu);
});

test('preserves an authentication failure even when an intermediary returns HTML', async () => {
	const client = createAudiocomApiClient({ location, fetch: async () => new Response('<html>Sign in</html>', {
		status: 401, headers: { 'Content-Type': 'text/html' },
	}) });
	await assert.rejects(client.search({ query: 'forest', page: 1 }), error => error instanceof AudiocomApiError && error.status === 401);
});

test('uses only the configured Audiocity issuer and accepts its UUID content links', async () => {
	const origin = 'http://127.0.0.1:8088';
	const localLocation = { origin: 'http://127.0.0.1:4325', protocol: 'http:' };
	const authorize = authorization(); authorize.host = '127.0.0.1:8088'; authorize.protocol = 'http:';
	authorize.searchParams.set('redirect_uri', `${localLocation.origin}/api/audiocom/oauth/callback`);
	authorize.searchParams.set('scope', 'public projects');
	const id = 'd621f281-7974-444e-b969-b84272cda0d3';
	const opened: string[] = [];
	const client = createAudiocomApiClient({ apiOrigin: origin, location: localLocation, reserveAuthorization: () => ({ open: url => { opened.push(url); }, close() {} }),
		fetch: async input => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/usage')) return Response.json({ data: { provider: { kind: 'audiocity', apiOrigin: origin, webOrigin: origin, scope: 'public projects' } } });
			if (path.endsWith('/start')) return Response.json({ data: { attemptId: 'attempt', handoffToken: 'handoff', authorizeUrl: authorize.href, expiresAt: new Date(Date.now() + 60_000).toISOString() } });
			return Response.json({ data: { results: [{ ...result, id, url: `${origin}/public/audio/${id}` }], page: 1, hasNext: false } });
		},
	});
	const attempt = await client.startOAuth();
	await client.reserveAuthorization().open(attempt.authorizeUrl);
	assert.deepEqual(opened, [authorize.href]);
	assert.equal((await client.search({ query: 'forest', page: 1 })).results[0].id, id);
	assert.equal((await client.search({ query: 'forest', page: 1 })).results[0].url, `${origin}/public/audio/${id}`);
});

test('rejects a local authorization issuer that differs from server configuration', async () => {
	const localLocation = { origin: 'http://127.0.0.1:4325', protocol: 'http:' };
	const authorize = authorization(); authorize.host = '127.0.0.1:9099'; authorize.protocol = 'http:';
	authorize.searchParams.set('redirect_uri', `${localLocation.origin}/api/audiocom/oauth/callback`);
	authorize.searchParams.set('scope', 'public projects');
	const client = createAudiocomApiClient({ apiOrigin: 'http://127.0.0.1:8088', location: localLocation, fetch: async input => Response.json({ data: String(input).endsWith('/usage')
		? { provider: { kind: 'audiocity', apiOrigin: 'http://127.0.0.1:8088', webOrigin: 'http://127.0.0.1:8088', scope: 'public projects' } }
		: { attemptId: 'attempt', handoffToken: 'handoff', authorizeUrl: authorize.href, expiresAt: new Date().toISOString() } }) });
	await assert.rejects(client.startOAuth(), /authorization/iu);
});

test('cancelling one provider lookup does not cancel the next restored-session search', async () => {
	let lookups = 0;
	let lookupStarted!: () => void;
	const started = new Promise<void>(resolve => { lookupStarted = resolve; });
	const first = new AbortController();
	const client = createAudiocomApiClient({ location, fetch: async (input, init) => {
		if (String(input).endsWith('/usage') && ++lookups === 1) {
			lookupStarted();
			return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('Cancelled lookup.')), { once: true }));
		}
		return Response.json({ data: { results: [result], page: 1, hasNext: false } });
	} });
	const cancelled = assert.rejects(client.search({ query: 'forest', page: 1 }, first.signal), /Cancelled lookup/u);
	await started;
	const next = client.search({ query: 'forest again', page: 1 });
	await new Promise<void>(resolve => setImmediate(resolve));
	first.abort();
	await cancelled;
	assert.equal((await next).results[0].title, 'Forest');
});


test('defaults every proxy control request to audio.com and never fetches the selected server directly', async () => {
	for (const apiOrigin of [undefined, 'https://audio.example.org']) {
		const calls: { url: string; origin: string | null }[] = [];
		const client = createAudiocomApiClient({ apiOrigin, location, fetch: async (input, init) => {
			calls.push({ url: String(input), origin: new Headers(init?.headers).get('X-Audiocom-Api-Origin') });
			return Response.json({ data: { connected: false } });
		} });
		await client.session(); await client.disconnect();
		assert.deepEqual(calls.map(call => call.origin), [apiOrigin ?? 'https://api.audio.com', apiOrigin ?? 'https://api.audio.com']);
		assert(calls.every(call => new URL(call.url).origin === location.origin));
	}
});

test('rejects provider metadata for another preference before authorizing or uploading', async () => {
	const paths: string[] = [];
	const client = createAudiocomApiClient({ apiOrigin: 'https://audio.example.org', location, fetch: async input => {
		paths.push(new URL(String(input)).pathname);
		return Response.json({ data: { provider: { kind: 'audiocom', apiOrigin: 'https://api.audio.com', webOrigin: 'https://audio.com', scope: 'public' } } });
	} });
	await assert.rejects(client.startOAuth(), /origin|server/iu);
	assert.deepEqual(paths, ['/api/audiocom/usage']);
});

test('a local editor accepts an IPv6 loopback provider saved in Advanced preferences', async () => {
	const apiOrigin = 'http://[::1]:8088'; let selected: string | null = null;
	const client = createAudiocomApiClient({ apiOrigin, location: { origin: 'http://localhost:4325', protocol: 'http:' },
		fetch: async (_input, init) => { selected = new Headers(init?.headers).get('X-Audiocom-Api-Origin'); return Response.json({ data: { connected: false } }); },
	});
	assert.deepEqual(await client.session(), { connected: false }); assert.equal(selected, apiOrigin);
	const hosted = createAudiocomApiClient({ apiOrigin, location, fetch: async () => Response.json({ error: { message: 'A local editor is required.' } }, { status: 400 }) });
	await assert.rejects(hosted.session(), error => error instanceof AudiocomApiError && error.status === 400);
});
