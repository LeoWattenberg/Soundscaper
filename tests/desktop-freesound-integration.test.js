import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	DesktopFreesoundSessionStore,
	assertFreesoundAuthorizationUrl,
	createDesktopFreesoundIntegration,
	createDesktopFreesoundProxy,
} from '../desktop/freesound-integration.js';

const APP_ORIGIN = 'soundscaper-app://bundle';
const API_ORIGIN = 'https://soundscaper.org';

test('desktop Freesound authorization accepts only the exact upstream authorize endpoint', () => {
	const valid = 'https://freesound.org/apiv2/oauth2/authorize/?client_id=client&response_type=code&state=opaque&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback';
	assert.equal(assertFreesoundAuthorizationUrl(valid), valid);
	for (const invalid of [
		'https://evil.example/apiv2/oauth2/authorize/?client_id=client&response_type=code&state=opaque',
		'https://freesound.org/apiv2/oauth2/authorize/?client_id=client&response_type=token&state=opaque',
		'https://freesound.org/apiv2/oauth2/authorize/?client_id=client&response_type=code&state=opaque&next=https://evil.example',
		'https://freesound.org/apiv2/oauth2/authorize/?client_id=client&response_type=code&state=opaque&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback',
		'https://user@freesound.org/apiv2/oauth2/authorize/?client_id=client&response_type=code&state=opaque',
	]) assert.throws(() => assertFreesoundAuthorizationUrl(invalid), /authorization URL/u);
});

test('desktop Freesound proxy forces desktop OAuth and keeps its session capability out of the renderer', async () => {
	let sessionToken = null;
	const calls = [];
	const store = {
		get: () => sessionToken,
		set: async (value) => { sessionToken = value; },
		clear: async () => { sessionToken = null; },
	};
	const proxy = createDesktopFreesoundProxy({
		appOrigin: APP_ORIGIN,
		apiOrigin: API_ORIGIN,
		sessionStore: store,
		fetchImpl: async (url, init) => {
			calls.push({ url, init, body: init.body ? await new Response(init.body).text() : null });
			if (String(url).endsWith('/oauth/start')) {
				return Response.json({ data: { authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=x&response_type=code&state=y&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback' } }, { status: 201 });
			}
			if (String(url).endsWith('/oauth/poll')) {
				return Response.json({ data: { status: 'connected', sessionToken: 'a'.repeat(43), user: { id: 1, username: 'sound' } } });
			}
			return Response.json({ data: { connected: true } });
		},
	});

	const started = await proxy(request('/api/freesound/oauth/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: 'Bearer renderer-controlled' },
		body: JSON.stringify({ client: 'web', extra: true }),
	}));
	assert.equal(started.status, 201);
	assert.equal(calls[0].body, '{"client":"desktop"}');
	assert.equal(new Headers(calls[0].init.headers).get('authorization'), null);
	assert.equal(new Headers(calls[0].init.headers).get('origin'), APP_ORIGIN);

	const polled = await proxy(request('/api/freesound/oauth/poll', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ attemptId: 'attempt', handoffToken: 'handoff' }),
	}));
	assert.deepEqual(await polled.json(), { data: { status: 'connected', user: { id: 1, username: 'sound' } } });
	assert.equal(sessionToken, 'a'.repeat(43));

	await proxy(request('/api/freesound/oauth/session'));
	assert.equal(new Headers(calls[2].init.headers).get('authorization'), `Bearer ${'a'.repeat(43)}`);
	assert.equal(calls[2].url, `${API_ORIGIN}/api/freesound/oauth/session`);
});

test('desktop Freesound proxy enforces its exact route and upload header allowlists', async () => {
	const calls = [];
	const proxy = createDesktopFreesoundProxy({
		appOrigin: APP_ORIGIN,
		apiOrigin: API_ORIGIN,
		sessionStore: { get: () => 'b'.repeat(43), set: async () => {}, clear: async () => {} },
		fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }); },
	});
	assert.equal((await proxy(request('/api/freesound/unknown'))).status, 404);
	assert.equal((await proxy(request('/api/freesound/uploads?injected=1', { method: 'POST' }))).status, 400);
	const upload = await proxy(request('/api/freesound/uploads', {
		method: 'POST',
		headers: {
			'Content-Type': 'audio/wav', 'X-Freesound-Content-Length': '4', 'X-Freesound-Filename': 'clip.wav',
			Cookie: 'renderer-cookie', 'X-Forwarded-For': '127.0.0.1',
		},
		body: new Uint8Array([1, 2, 3, 4]),
	}));
	assert.equal(upload.status, 204);
	const headers = new Headers(calls[0].init.headers);
	assert.equal(headers.get('x-freesound-filename'), 'clip.wav');
	assert.equal(headers.get('content-length'), '4');
	assert.equal(headers.get('cookie'), null);
	assert.equal(headers.get('x-forwarded-for'), null);
	assert.equal(headers.get('authorization'), `Bearer ${'b'.repeat(43)}`);
});

test('desktop Freesound session persistence uses safeStorage and falls back to memory on basic_text', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-freesound-session-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const sessionPath = join(root, 'freesound-session.json');
	const safeStorage = fakeSafeStorage('keychain');
	const first = new DesktopFreesoundSessionStore({ filePath: sessionPath, platform: 'darwin', safeStorage });
	await first.load();
	await first.set('c'.repeat(43));
	const serialized = await readFile(sessionPath, 'utf8');
	assert.doesNotMatch(serialized, /c{20}/u);
	const second = new DesktopFreesoundSessionStore({ filePath: sessionPath, platform: 'darwin', safeStorage });
	await second.load();
	assert.equal(second.get(), 'c'.repeat(43));

	const memoryPath = join(root, 'memory-only.json');
	const memory = new DesktopFreesoundSessionStore({ filePath: memoryPath, platform: 'linux', safeStorage: fakeSafeStorage('basic_text') });
	await memory.load();
	await memory.set('d'.repeat(43));
	assert.equal(memory.get(), 'd'.repeat(43));
	await assert.rejects(() => access(memoryPath));
});

test('desktop Freesound integration opens only validated authorization URLs', async () => {
	const opened = [];
	const handlers = new Map();
	const integration = await createDesktopFreesoundIntegration({
		appOrigin: APP_ORIGIN,
		apiOrigin: API_ORIGIN,
		channels: { openFreesoundAuthorization: 'open' },
		fetchImpl: async () => new Response(null, { status: 500 }),
		filePath: '/unused',
		handle: (channel, listener) => handlers.set(channel, listener),
		platform: 'linux',
		productId: 'soundscaper',
		safeStorage: fakeSafeStorage('basic_text'),
		shell: { openExternal: async (url) => { opened.push(url); } },
	});
	const valid = 'https://freesound.org/apiv2/oauth2/authorize/?client_id=x&response_type=code&state=y&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback';
	assert.equal(await handlers.get('open')(null, valid), true);
	assert.deepEqual(opened, [valid]);
	await assert.rejects(() => handlers.get('open')(null, 'https://evil.example/'), /authorization URL/u);
	assert.equal(typeof integration.proxy, 'function');
});

function request(path, init = undefined) {
	return new Request(`${APP_ORIGIN}/_desktop/freesound${path}`, init);
}

function fakeSafeStorage(backend) {
	return {
		getSelectedStorageBackend: () => backend,
		isEncryptionAvailable: () => true,
		encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
		decryptStringAsync: async (value) => ({ result: value.toString('utf8').replace(/^encrypted:/u, ''), shouldReEncrypt: false }),
	};
}
