/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFreesoundApiClient,
	createFreesoundClientTransport,
	FreesoundApiError,
	type FreesoundApiClient,
} from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import {
	createFreesoundPanelSession,
	freesoundPanelSession,
	requestFreesoundClipUpload,
} from '../src/common/editor/ui/workspace/freesound-panel-session.ts';

test('the browser Freesound transport keeps OAuth cookies same-origin', async () => {
	const requests: Array<readonly [RequestInfo | URL, RequestInit | undefined]> = [];
	const transport = createFreesoundClientTransport({
		location: { protocol: 'https:', origin: 'https://preview.soundscaper.pages.dev' },
		fetch: async (input, init) => {
			requests.push([input, init]);
			return Response.json({ data: { connected: false } });
		},
	});
	await transport.request('/api/freesound/oauth/session');
	await transport.request('/api/freesound/sounds/42/original');
	assert.equal(requests[0]?.[0], 'https://preview.soundscaper.pages.dev/api/freesound/oauth/session');
	assert.equal(requests[0]?.[1]?.credentials, 'include');
	assert.equal(requests[1]?.[0], 'https://preview.soundscaper.pages.dev/api/freesound/sounds/42/original');
	assert.equal(requests[1]?.[1]?.credentials, 'include');
});

test('the desktop transport resolves only through the custom protocol seam', async () => {
	const requested: string[] = [];
	const opened: string[] = [];
	const transport = createFreesoundClientTransport({
		location: { protocol: 'soundscaper-app:', origin: 'null' },
		scope: {
			soundscaperDesktop: { v1: {
				openFreesoundAuthorization: (url: string) => { opened.push(url); },
			} },
			soundscaper: {
				openFreesoundAuthorization: () => assert.fail('legacy bridges must not be trusted'),
			},
		},
		fetch: async (input) => {
			requested.push(String(input));
			return Response.json({ data: { connected: false } });
		},
	});
	await transport.request('/api/freesound/oauth/session');
	await transport.request('/api/freesound/sounds/42/original');
	assert.deepEqual(requested, [
		'soundscaper-app://bundle/_desktop/freesound/api/freesound/oauth/session',
		'soundscaper-app://bundle/_desktop/freesound/api/freesound/sounds/42/original',
	]);
	await assert.rejects(
		transport.request('/api/other/resource'),
		/Freesound API path/u,
	);
	const authorization = 'https://freesound.org/apiv2/oauth2/authorize/?client_id=x&response_type=code&state=signed-state&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback';
	await transport.openAuthorization(authorization);
	assert.deepEqual(opened, [authorization]);

	const legacyOnly = createFreesoundClientTransport({
		location: { protocol: 'soundscaper-app:', origin: 'null' },
		scope: { soundscaper: { openFreesoundAuthorization: () => undefined } },
		fetch: async () => Response.json({ data: { connected: false } }),
	});
	assert.throws(() => { void legacyOnly.openAuthorization(authorization); }, /desktop OAuth bridge/u);
});

test('web OAuth reserves a synchronous popup handle before navigating it', async () => {
	const events: string[] = [];
	const child = {
		opener: {} as unknown,
		location: { replace: (url: string) => events.push(`navigate:${url}`) },
		close: () => events.push('close'),
	} as unknown as Window;
	const transport = createFreesoundClientTransport({
		location: { protocol: 'https:', origin: 'https://soundscaper.org' },
		fetch: async () => Response.json({ data: { connected: false } }),
		scope: {
			open: (url: string, target: string, features?: string) => {
				events.push(`open:${url}:${target}:${String(features)}`);
				return child;
			},
		},
	});
	const reservation = transport.reserveAuthorization?.();
	assert.ok(reservation);
	assert.equal(events[0], 'open:about:blank:_blank:undefined');
	assert.equal(child.opener, null);
	const authorization = 'https://freesound.org/apiv2/oauth2/authorize/?client_id=x&response_type=code&state=signed-state&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback';
	await reservation.open(authorization);
	assert.equal(events[1], `navigate:${authorization}`);
});

test('loopback OAuth accepts only the callback on the running local web origin', async () => {
	const navigations: string[] = [];
	const child = {
		opener: {} as unknown,
		location: { replace: (url: string) => navigations.push(url) },
		close: () => undefined,
	} as unknown as Window;
	const authorizeUrl = 'https://freesound.org/apiv2/oauth2/authorize/?client_id=x&response_type=code&state=local-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A4322%2Fapi%2Ffreesound%2Foauth%2Fcallback';
	const transport = createFreesoundClientTransport({
		location: { protocol: 'http:', origin: 'http://127.0.0.1:4322' },
		scope: { open: () => child },
		fetch: async () => Response.json({ data: {
			attemptId: 'attempt-local', handoffToken: 'handoff-local', authorizeUrl,
			expiresAt: '2030-01-01T00:00:00Z',
		} }),
	});
	const client = createFreesoundApiClient(transport, 'web');
	const attempt = await client.startOAuth();
	const reservation = client.reserveAuthorization();
	await reservation.open(attempt.authorizeUrl);
	assert.deepEqual(navigations, [authorizeUrl]);
	assert.throws(() => reservation.open(authorizeUrl.replace('127.0.0.1%3A4322', 'localhost%3A4323')),
		/authorization URL/u);
});

test('panel connect reserves authorization during the initiating user turn', async () => {
	const events: string[] = [];
	const client: FreesoundApiClient = {
		platform: 'web',
		session: async () => ({ connected: false }),
		startOAuth: async () => {
			events.push('start');
			return {
				attemptId: 'attempt-a', handoffToken: 'handoff-a',
				authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=x&response_type=code&state=signed-state&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback',
				expiresAt: '2030-01-01T00:00:00Z',
			};
		},
		pollOAuth: async (attemptId, handoffToken) => {
			events.push(`poll:${attemptId}:${handoffToken}`);
			return { connected: true, user: { id: 7, username: 'field-recorder' } };
		},
		disconnect: async () => undefined,
		upload: async () => ({ uploadFilename: 'unused.wav' }),
		describe: async () => ({ status: 'submitted' }),
		pending: async () => [],
		usage: async () => ({
			maximumUploadBytes: 100_000_000, maximumOriginalBytes: 134_217_728,
			acceptedUploadExtensions: [], licenses: [],
		}),
		openAuthorization: async () => undefined,
		reserveAuthorization: () => {
			events.push('reserve');
			return {
				open: (url) => { events.push(`open:${url}`); },
				close: () => events.push('close'),
			};
		},
	};
	const session = createFreesoundPanelSession(client, {
		now: () => Date.parse('2029-01-01T00:00:00Z'),
		wait: async () => undefined,
	});
	const connecting = session.connect();
	assert.deepEqual(events.slice(0, 2), ['reserve', 'start']);
	await connecting;
	assert.equal(session.getSnapshot().auth.status, 'connected');
	assert.ok(events[2]?.startsWith('open:https://freesound.org/'));
	assert.equal(events[3], 'poll:attempt-a:handoff-a');
});

test('OAuth polling carries the in-memory handoff capability and normalizes structured pending uploads', async () => {
	const bodies: string[] = [];
	const responses = [
		new Response(JSON.stringify({ data: { status: 'pending' } }), {
			status: 202, headers: { 'Content-Type': 'application/json' },
		}),
		Response.json({ data: {
			pendingDescription: ['raw-a.wav'],
			pendingProcessing: [{ id: 7, name: 'Processing', tags: ['field'], description: '', createdAt: '2026-01-01', license: 'Attribution' }],
			pendingModeration: [{ id: 8, name: 'Moderating', tags: [], description: 'Ready', createdAt: '2026-01-01', license: 'Attribution' }],
		} }),
	];
	const client = createFreesoundApiClient({
		request: async (_path, init) => {
			if (typeof init?.body === 'string') bodies.push(init.body);
			return responses.shift()!;
		},
		openAuthorization: () => undefined,
	});
	assert.equal(await client.pollOAuth('attempt-a', 'handoff-a'), null);
	assert.equal(bodies[0], JSON.stringify({ attemptId: 'attempt-a', handoffToken: 'handoff-a' }));
	assert.deepEqual((await client.pending()).map(({ status, soundId }) => ({ status, soundId })), [
		{ status: 'pending_description', soundId: undefined },
		{ status: 'pending_processing', soundId: 7 },
		{ status: 'pending_moderation', soundId: 8 },
	]);
});

test('the API client normalizes auth, upload and describe responses', async () => {
	const requests: Array<readonly [string, RequestInit | undefined]> = [];
	const responses = [
		Response.json({ data: { connected: true, user: { id: 7, username: 'field-recorder' } } }),
		Response.json({ data: { attemptId: 'attempt-a', handoffToken: 'handoff-a', authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=x&response_type=code&state=signed-state&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback', expiresAt: '2030-01-01T00:00:00Z' } }),
		Response.json({ data: { uploadFilename: 'remote.wav' } }),
		Response.json({ data: { soundId: 9, status: 'pending_moderation' } }),
	];
	const client = createFreesoundApiClient({
		request: async (path, init) => {
			requests.push([path, init]);
			return responses.shift()!;
		},
		openAuthorization: () => undefined,
	});

	assert.deepEqual(await client.session(), {
		connected: true, user: { id: 7, username: 'field-recorder' },
	});
	assert.equal((await client.startOAuth('web')).attemptId, 'attempt-a');
	assert.deepEqual(await client.upload(new File(['x'], 'tone.wav', { type: 'audio/wav' })), {
		uploadFilename: 'remote.wav',
	});
	assert.deepEqual(await client.describe({
		uploadFilename: 'remote.wav', title: 'Tone', description: 'Tone.', tags: ['tone'],
		categoryId: 'is-e', license: 'cc-by',
	}), { soundId: 9, status: 'pending_moderation' });
	assert.equal(requests[1]?.[1]?.body, JSON.stringify({ client: 'web' }));
	assert.equal(requests[2]?.[1]?.headers instanceof Headers, true);
	assert.equal((requests[2]?.[1]?.headers as Headers).get('X-Freesound-Filename'), 'tone.wav');
	assert.equal((requests[2]?.[1]?.headers as Headers).get('X-Freesound-Content-Length'), '1');
});

test('session state requires an explicit connected flag and usage matches the server limits', async () => {
	const responses = [
		Response.json({ data: { connected: false, user: { id: 7, username: 'stale-user' } } }),
		Response.json({ data: {
			maximumUploadBytes: 100_000_000,
			maximumOriginalBytes: 134_217_728,
			acceptedUploadExtensions: ['wav', 'aif', 'aiff', 'flac', 'ogg', 'mp3'],
			licenses: ['cc0', 'cc-by', 'cc-by-nc'],
		} }),
	];
	const client = createFreesoundApiClient({
		request: async () => responses.shift()!,
		openAuthorization: () => undefined,
	});
	assert.deepEqual(await client.session(), { connected: false });
	assert.deepEqual(await client.usage(), {
		maximumUploadBytes: 100_000_000,
		maximumOriginalBytes: 134_217_728,
		acceptedUploadExtensions: ['wav', 'aif', 'aiff', 'flac', 'ogg', 'mp3'],
		licenses: ['cc0', 'cc-by', 'cc-by-nc'],
	});
});

test('authentication failures retain their owned status and disconnect the active panel session', async () => {
	const api = createFreesoundApiClient({
		request: async () => Response.json({ error: {
			code: 'authentication_expired', message: 'Reconnect Freesound to continue.',
		} }, { status: 401 }),
		openAuthorization: () => undefined,
	});
	await assert.rejects(api.upload(new File(['x'], 'expired.wav', { type: 'audio/wav' })), (error) => {
		assert.ok(error instanceof FreesoundApiError);
		assert.equal(error.status, 401);
		assert.equal(error.code, 'authentication_expired');
		return true;
	});

	const client: FreesoundApiClient = {
		platform: 'web',
		session: async () => ({ connected: true, user: { username: 'expired-user' } }),
		startOAuth: async () => { throw new Error('unused'); },
		pollOAuth: async () => null,
		disconnect: async () => undefined,
		upload: async () => { throw new FreesoundApiError(401, 'authentication_expired', 'Reconnect Freesound.'); },
		describe: async () => ({ status: 'submitted' }),
		pending: async () => [],
		usage: async () => ({ maximumUploadBytes: 100_000_000, maximumOriginalBytes: 134_217_728,
			acceptedUploadExtensions: [], licenses: [] }),
		openAuthorization: async () => undefined,
		reserveAuthorization: () => ({ open: () => undefined, close: () => undefined }),
	};
	const panel = createFreesoundPanelSession(client);
	await panel.initialize();
	panel.enqueueFiles([new File(['x'], 'expired.wav', { type: 'audio/wav' })]);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	assert.equal(panel.getSnapshot().auth.status, 'disconnected');
	assert.match(panel.getSnapshot().auth.errorMessage ?? '', /Reconnect Freesound/u);
	assert.equal(panel.getSnapshot().uploadQueue.items[0]?.status, 'failed');
});

test('a menu-requested clip waits for authentication, reveals uploads, and enters the owned queue', async () => {
	const owner = {};
	const requested = requestFreesoundClipUpload(owner, {
		projectId: 'project-a', clipId: 'clip-a', clipTitle: 'Menu clip',
	});
	const duplicateRequest = requestFreesoundClipUpload(owner, {
		projectId: 'project-a', clipId: 'clip-a', clipTitle: 'Menu clip',
	});
	assert.equal(duplicateRequest, requested);
	const client: FreesoundApiClient = {
		platform: 'web',
		session: async () => ({ connected: true, user: { username: 'menu-uploader' } }),
		startOAuth: async () => { throw new Error('unused'); },
		pollOAuth: async () => null,
		disconnect: async () => undefined,
		upload: async () => ({ uploadFilename: 'menu-clip.wav' }),
		describe: async () => ({ status: 'submitted' }),
		pending: async () => [],
		usage: async () => ({ maximumUploadBytes: 100_000_000, maximumOriginalBytes: 134_217_728,
			acceptedUploadExtensions: [], licenses: [] }),
		openAuthorization: async () => undefined,
		reserveAuthorization: () => ({ open: () => undefined, close: () => undefined }),
	};
	const panel = freesoundPanelSession(owner, client, {
		materializeClip: async () => ({
			file: new File(['clip'], 'Menu clip.wav', { type: 'audio/wav' }),
			clipTitle: 'Menu clip',
		}),
		createId: () => 'menu-upload',
	});
	await panel.initialize();
	await requested;
	for (let attempt = 0; attempt < 10 && panel.getSnapshot().uploadQueue.active; attempt += 1) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	const snapshot = panel.getSnapshot();
	assert.equal(snapshot.uploadRevealRevision, 1);
	assert.equal(snapshot.uploadQueue.items[0]?.title, 'Menu clip');
	assert.equal(snapshot.uploadQueue.items[0]?.status, 'ready-to-publish');
	assert.equal(snapshot.uploadQueue.items.length, 1);
});

test('a menu request while signed out fails visibly instead of transferring after a later sign-in', async () => {
	const owner = {};
	const client: FreesoundApiClient = {
		platform: 'web',
		session: async () => ({ connected: false }),
		startOAuth: async () => { throw new Error('unused'); },
		pollOAuth: async () => null,
		disconnect: async () => undefined,
		upload: async () => ({ uploadFilename: 'unexpected.wav' }),
		describe: async () => ({ status: 'submitted' }),
		pending: async () => [],
		usage: async () => ({ maximumUploadBytes: 100_000_000, maximumOriginalBytes: 134_217_728,
			acceptedUploadExtensions: [], licenses: [] }),
		openAuthorization: async () => undefined,
		reserveAuthorization: () => ({ open: () => undefined, close: () => undefined }),
	};
	const panel = freesoundPanelSession(owner, client);
	await panel.initialize();
	await assert.rejects(requestFreesoundClipUpload(owner, {
		projectId: 'project-a', clipId: 'clip-a', clipTitle: 'Signed-out clip',
	}), /Connect to Freesound/u);
	assert.deepEqual(panel.getSnapshot().uploadQueue.items, []);
});

test('menu requests against a loading session share one bounded deferred intent', async () => {
	const owner = {};
	const client: FreesoundApiClient = {
		platform: 'web',
		session: async () => await new Promise(() => undefined),
		startOAuth: async () => { throw new Error('unused'); },
		pollOAuth: async () => null,
		disconnect: async () => undefined,
		upload: async () => ({ uploadFilename: 'unexpected.wav' }),
		describe: async () => ({ status: 'submitted' }),
		pending: async () => [],
		usage: async () => ({ maximumUploadBytes: 100_000_000, maximumOriginalBytes: 134_217_728,
			acceptedUploadExtensions: [], licenses: [] }),
		openAuthorization: async () => undefined,
		reserveAuthorization: () => ({ open: () => undefined, close: () => undefined }),
	};
	const panel = freesoundPanelSession(owner, client, { menuUploadRequestTimeoutMilliseconds: 1 });
	const reference = { projectId: 'project-a', clipId: 'clip-a', clipTitle: 'Waiting clip' };
	const first = requestFreesoundClipUpload(owner, reference);
	const duplicate = requestFreesoundClipUpload(owner, reference);
	assert.equal(duplicate, first);
	await assert.rejects(first, /connect before uploading/u);
	assert.deepEqual(panel.getSnapshot().uploadQueue.items, []);
	assert.equal(panel.getSnapshot().uploadRevealRevision, 0);
});
