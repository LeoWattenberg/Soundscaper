/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	DesktopAudiocomSessionStore, createDesktopAudiocomProxy, createDesktopAudiocomIntegration,
} from '../desktop/audiocom-integration.ts';
import { assertAudiocomAuthorizationUrl } from '../desktop/audiocom-authorization.ts';

const APP_ORIGIN = 'soundscaper-app://bundle';
const API_ORIGIN = 'https://soundscaper.org';
const AUTHORIZE = 'https://api.audio.com/auth/authorize?client_id=client&response_type=code&state=opaque&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Faudiocom%2Foauth%2Fcallback&scope=public&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256';

test('desktop audio.com authorization enforces issuer, callback and PKCE parameters', () => {
	assert.equal(assertAudiocomAuthorizationUrl(AUTHORIZE), AUTHORIZE);
	for (const invalid of [
		AUTHORIZE.replace('api.audio.com', 'audio.com'),
		AUTHORIZE.replace('response_type=code', 'response_type=token'),
		AUTHORIZE.replace('code_challenge_method=S256', 'code_challenge_method=plain'),
		AUTHORIZE.replace('scope=public', 'scope=public&scope=other'),
		AUTHORIZE.replace('soundscaper.org%2Fapi', 'evil.example%2Fapi'),
		`${AUTHORIZE}&next=https://evil.example`, `${AUTHORIZE}#fragment`,
	]) assert.throws(() => assertAudiocomAuthorizationUrl(invalid), /authorization URL/u);
});

test('desktop audio.com proxy forces desktop OAuth and hides the encrypted session capability', async () => {
	let token: string | null = null;
	const calls: { url: string; headers: Headers; body: string | null }[] = [];
	const proxy = createDesktopAudiocomProxy({ appOrigin: APP_ORIGIN, apiOrigin: API_ORIGIN,
		sessionStore: { get: () => token, set: async (value) => { token = value; }, clear: async () => { token = null; } },
		fetchImpl: async (url, init) => {
			calls.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body ? await new Response(init.body).text() : null });
			return Response.json({ data: String(url).endsWith('/poll') ? { status: 'connected', sessionToken: 'a'.repeat(43) } : { connected: true } });
		},
	});
	await proxy(request('/oauth/start', { method: 'POST', body: '{"client":"web"}', headers: { Authorization: 'Bearer renderer' } }));
	assert.equal(calls[0]?.body, '{"client":"desktop"}');
	assert.equal(calls[0]?.headers.get('authorization'), null);
	const polled = await proxy(request('/oauth/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"attemptId":"attempt","handoffToken":"handoff"}' }));
	assert.deepEqual(await polled.json(), { data: { status: 'connected' } });
	assert.equal(token, 'a'.repeat(43));
	await proxy(request('/library?page=2'));
	assert.equal(calls[2]?.url, `${API_ORIGIN}/api/audiocom/library?page=2`);
	assert.equal(calls[2]?.headers.get('authorization'), `Bearer ${'a'.repeat(43)}`);
	assert.equal(calls[2]?.headers.get('origin'), APP_ORIGIN);
	await proxy(request('/oauth/session', { method: 'DELETE' }));
	assert.equal(token, null);
});

test('desktop audio.com proxy restricts routes and uploads and drops renderer-controlled headers', async () => {
	const calls: Headers[] = [];
	const proxy = createDesktopAudiocomProxy({ appOrigin: APP_ORIGIN, apiOrigin: API_ORIGIN,
		sessionStore: { get: () => null, set: async () => {}, clear: async () => {} },
		fetchImpl: async (_url, init) => { calls.push(new Headers(init?.headers)); return new Response(null, { status: 204 }); },
	});
	assert.equal((await proxy(request('/unknown'))).status, 404);
	assert.equal((await proxy(request('/search?q=birds&page=1&evil=x'))).status, 400);
	assert.equal((await proxy(request('/search?q=birds&q=music'))).status, 400);
	assert.equal((await proxy(request('/oauth/session?injected=1'))).status, 400);
	assert.equal((await proxy(request('/uploads', { method: 'GET' }))).status, 405);
	assert.equal((await proxy(new Request(`https://evil.example/_desktop/audiocom/api/audiocom/usage`))).status, 404);
	const headers = { 'Content-Type': 'audio/wav', 'X-Audiocom-Content-Length': '4', 'X-Audiocom-Filename': 'clip.wav', Cookie: 'renderer', 'X-Forwarded-For': 'renderer' };
	const upload = await proxy(request('/uploads?title=Bird&listed=0&downloadable=0', { method: 'POST', headers, body: new Uint8Array([1, 2, 3, 4]) }));
	assert.equal(upload.status, 204);
	assert.equal(calls[0]?.get('content-length'), '4');
	assert.equal(calls[0]?.get('x-audiocom-content-length'), '4');
	assert.equal(calls[0]?.get('x-audiocom-filename'), 'clip.wav');
	assert.equal(calls[0]?.get('cookie'), null);
	assert.equal(calls[0]?.get('x-forwarded-for'), null);
	assert.equal((await proxy(request('/uploads', { method: 'POST', headers: { ...headers, 'X-Audiocom-Content-Length': '100000001' }, body: new Uint8Array([1]) }))).status, 400);
	assert.equal((await proxy(request('/uploads', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-sqlite3' }, body: new Uint8Array([1]) }))).status, 400);
});

test('desktop audio.com stores sessions with safeStorage and uses memory when secure storage is unavailable', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-audiocom-session-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const safeStorage = {
		isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
		encryptString: (value: string) => Buffer.from(Buffer.from(value).toString('base64')),
		decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString(),
	};
	const filePath = join(root, 'session.json');
	const first = new DesktopAudiocomSessionStore({ filePath, platform: 'darwin', safeStorage });
	await first.load(); await first.set('b'.repeat(43));
	assert.doesNotMatch(await readFile(filePath, 'utf8'), /b{20}/u);
	const restored = new DesktopAudiocomSessionStore({ filePath, platform: 'darwin', safeStorage });
	await restored.load(); assert.equal(restored.get(), 'b'.repeat(43));
	await restored.clear(); assert.equal(restored.get(), null); await assert.rejects(() => access(filePath));
	const memoryPath = join(root, 'memory.json');
	const memory = new DesktopAudiocomSessionStore({ filePath: memoryPath, platform: 'linux', safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' } });
	await memory.load(); await memory.set('c'.repeat(43));
	assert.equal(memory.get(), 'c'.repeat(43)); await assert.rejects(() => access(memoryPath));
});

function request(path: string, init?: RequestInit): Request {
	return new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom${path}`, init);
}


test('desktop audio.com preview streams ranges without exposing credentials or upstream cookies', async () => {
	let forwarded: Headers | undefined;
	const proxy = createDesktopAudiocomProxy({ appOrigin: APP_ORIGIN, apiOrigin: API_ORIGIN,
		sessionStore: { get: () => 'd'.repeat(43), set: async () => {}, clear: async () => {} },
		fetchImpl: async (_url, init) => {
			forwarded = new Headers(init?.headers);
			assert.equal(init?.redirect, 'error');
			return new Response(new Uint8Array([1, 2, 3]), { status: 206,
				headers: { 'Content-Range': 'bytes 0-2/12', 'Accept-Ranges': 'bytes', 'Set-Cookie': 'secret=token', 'Content-Type': 'audio/mpeg' },
			});
		},
	});
	const response = await proxy(request('/preview?url=https%3A%2F%2Fexample.audio.com%2Fpreview.mp3', { headers: { Range: 'bytes=0-2' } }));
	assert.equal(response.status, 206);
	assert.equal(forwarded?.get('range'), 'bytes=0-2');
	assert.equal(forwarded?.get('authorization'), `Bearer ${'d'.repeat(43)}`);
	assert.equal(response.headers.get('content-range'), 'bytes 0-2/12');
	assert.equal(response.headers.get('accept-ranges'), 'bytes');
	assert.equal(response.headers.get('set-cookie'), null);
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
	assert.equal((await proxy(request('/preview?url=x', { headers: { Range: 'bytes=0-2,4-6' } }))).status, 400);
});

test('desktop audio.com clears rejected sessions and rejects oversized OAuth control messages', async () => {
	let cleared = false;
	let calls = 0;
	const proxy = createDesktopAudiocomProxy({ appOrigin: APP_ORIGIN, apiOrigin: API_ORIGIN,
		sessionStore: { get: () => 'd'.repeat(43), set: async () => {}, clear: async () => { cleared = true; } },
		fetchImpl: async () => { calls += 1; return new Response(null, { status: 401 }); },
	});
	assert.equal((await proxy(request('/usage'))).status, 401);
	assert.equal(cleared, true);
	assert.equal((await proxy(request('/oauth/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(128 * 1024 + 1) }))).status, 400);
	assert.equal(calls, 1);
});

test('desktop audio.com uses the system browser only for verified authorization URLs and excludes Framescaper', async () => {
	const opened: string[] = [];
	const handlers = new Map<string, (event: unknown, value: unknown) => Promise<boolean>>();
	const options = {
		appOrigin: APP_ORIGIN, apiOrigin: API_ORIGIN, filePath: '/unused', platform: 'linux',
		channels: { openAudiocomAuthorization: 'open', openAudiocomLink: 'link' },
		safeStorage: { isEncryptionAvailable: () => false },
		handle: (channel: string, listener: (event: unknown, value: unknown) => Promise<boolean>) => { handlers.set(channel, listener); },
		shell: { openExternal: async (url: string) => { opened.push(url); } },
	};
	assert.equal((await createDesktopAudiocomIntegration({ ...options, productId: 'framescaper' })).proxy, null);
	assert.equal(handlers.size, 0);
	assert.equal(typeof (await createDesktopAudiocomIntegration({ ...options, productId: 'soundscaper' })).proxy, 'function');
	const authorize = handlers.get('open');
	assert.ok(authorize);
	assert.equal(await authorize(null, AUTHORIZE), true);
	assert.deepEqual(opened, [AUTHORIZE]);
	await assert.rejects(() => authorize(null, 'https://evil.example/'), /authorization URL/u);
	const link = handlers.get('link');
	assert.ok(link);
	assert.equal(await link(null, 'https://audio.com/user/audio/field-take'), true);
	assert.equal(opened.at(-1), 'https://audio.com/user/audio/field-take');
	await assert.rejects(() => link(null, 'https://evil.example/'), /audio.com link/u);
});
