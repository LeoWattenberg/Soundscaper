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
