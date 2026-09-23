/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	encryptOAuthSecret,
	encodeBase64Url,
	hashCapability,
} from '../functions/api/freesound/_shared/oauth-crypto.ts';
import type {
	FreesoundOAuthEnv,
	FreesoundOAuthFunctionContext,
} from '../functions/api/freesound/_shared/oauth-http.ts';
import { handleFreesoundOAuthSessionRequest } from '../functions/api/freesound/_shared/oauth-handlers.ts';
import {
	handleFreesoundDescribeRequest,
	handleFreesoundOriginalRequest,
	handleFreesoundPendingUploadsRequest,
	handleFreesoundUploadRequest,
	handleFreesoundUsageRequest,
	MAX_FREESOUND_ORIGINAL_BYTES,
	MAX_FREESOUND_UPLOAD_BYTES,
} from '../functions/api/freesound/_shared/protected-handlers.ts';
import { MemoryFreesoundOAuthRepository } from './helpers/freesound-oauth-memory-repository.ts';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const SESSION_TOKEN = 's'.repeat(43);
const SECOND_SESSION_TOKEN = 't'.repeat(43);
const GRANT_ID = 'freesound-user-42';
const MASTER_KEY = `v1:${encodeBase64Url(new Uint8Array(32).fill(11))}`;
const ENV: FreesoundOAuthEnv = {
	FREESOUND_CLIENT_ID: 'client-id',
	FREESOUND_CLIENT_SECRET: 'client-secret',
	FREESOUND_OAUTH_MASTER_KEY: MASTER_KEY,
};

function context(request: Request, params: Record<string, string | string[]> = {}): FreesoundOAuthFunctionContext {
	return { request, env: ENV, params };
}

function authHeaders(extra: HeadersInit = {}): Headers {
	return new Headers({
		Authorization: `Bearer ${SESSION_TOKEN}`,
		Origin: 'soundscaper-app://bundle',
		...Object.fromEntries(new Headers(extra)),
	});
}

async function repositoryWithSession(expired = false): Promise<MemoryFreesoundOAuthRepository> {
	const repository = new MemoryFreesoundOAuthRepository();
	repository.grants.set(GRANT_ID, {
		id: GRANT_ID,
		user: { id: 42, username: 'field-recordist' },
		accessTokenCiphertext: await encryptOAuthSecret(
			'access-token', MASTER_KEY, `freesound-oauth:${GRANT_ID}:access`,
		),
		refreshTokenCiphertext: await encryptOAuthSecret(
			'refresh-token', MASTER_KEY, `freesound-oauth:${GRANT_ID}:refresh`,
		),
		accessExpiresAt: expired ? NOW - 1 : NOW + 60 * 60 * 1_000,
		refreshGeneration: 0,
		refreshLeaseOwner: null,
		refreshLeaseExpiresAt: null,
	});
	repository.sessions.set(await hashCapability(SESSION_TOKEN), {
		tokenHash: await hashCapability(SESSION_TOKEN),
		grantId: GRANT_ID,
		clientKind: 'desktop',
		createdAt: NOW,
		expiresAt: NOW + 86_400_000,
	});
	return repository;
}

async function addSecondSession(repository: MemoryFreesoundOAuthRepository): Promise<void> {
	const tokenHash = await hashCapability(SECOND_SESSION_TOKEN);
	repository.sessions.set(tokenHash, {
		tokenHash,
		grantId: GRANT_ID,
		clientKind: 'desktop',
		createdAt: NOW,
		expiresAt: NOW + 86_400_000,
	});
}

async function sessionConnected(
	repository: MemoryFreesoundOAuthRepository,
	token = SESSION_TOKEN,
): Promise<boolean> {
	const response = await handleFreesoundOAuthSessionRequest(context(new Request(
		'https://soundscaper.org/api/freesound/oauth/session',
		{ headers: { Authorization: `Bearer ${token}` } },
	)), { repository, now: () => NOW });
	return (await response.json() as { data: { connected: boolean } }).data.connected;
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

test('authenticated original download streams the owned response without exposing OAuth tokens', async () => {
	const repository = await repositoryWithSession();
	let upstream: Readonly<{ url: string; init?: RequestInit }> | undefined;
	const response = await handleFreesoundOriginalRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123/original',
		{ headers: authHeaders() },
	), { id: '123' }), {
		repository,
		now: () => NOW,
		fetchImpl: (input, init) => {
			upstream = { url: String(input), init };
			return Promise.resolve(new Response(Uint8Array.of(1, 2, 3, 4), {
				headers: {
					'Content-Type': 'audio/wav',
					'Content-Length': '4',
					'Content-Disposition': 'attachment; filename="rain.wav"',
				},
			}));
		},
	});

	assert.equal(response.status, 200);
	assert(upstream);
	assert.equal(new URL(upstream.url).pathname, '/apiv2/sounds/123/download/');
	assert.equal(new Headers(upstream.init?.headers).get('authorization'), 'Bearer access-token');
	assert.equal(new Headers(upstream.init?.headers).get('accept'), '*/*');
	const serialized = response.clone();
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.of(1, 2, 3, 4));
	assert.equal(response.headers.get('content-disposition'), 'attachment; filename="rain.wav"');
	assert.equal(response.headers.get('x-freesound-original-bytes'), '4');
	assert.doesNotMatch(await serialized.text(), /access-token/u);
});

test('original downloads reject a declared file above the editor import ceiling before reading it', async () => {
	const repository = await repositoryWithSession();
	const response = await handleFreesoundOriginalRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123/original',
		{ headers: authHeaders() },
	), { id: '123' }), {
		repository,
		now: () => NOW,
		fetchImpl: () => Promise.resolve(new Response(new Uint8Array(), {
			headers: {
				'Content-Type': 'audio/wav',
				'Content-Length': String(MAX_FREESOUND_ORIGINAL_BYTES + 1),
			},
		})),
	});
	assert.equal(response.status, 413);
	assert.equal((await response.json() as { error: { code: string } }).error.code, 'original_too_large');
});

test('partial original downloads enforce the total-file ceiling from strict Content-Range metadata', async () => {
	const oversizedRepository = await repositoryWithSession();
	const oversized = await handleFreesoundOriginalRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123/original',
		{ headers: authHeaders({ Range: 'bytes=0-3' }) },
	), { id: '123' }), {
		repository: oversizedRepository,
		now: () => NOW,
		fetchImpl: () => Promise.resolve(new Response(Uint8Array.of(1, 2, 3, 4), {
			status: 206,
			headers: {
				'Content-Type': 'audio/wav',
				'Content-Length': '4',
				'Content-Range': `bytes 0-3/${String(MAX_FREESOUND_ORIGINAL_BYTES + 1)}`,
			},
		})),
	});
	assert.equal(oversized.status, 413);
	assert.equal((await oversized.json() as { error: { code: string } }).error.code, 'original_too_large');

	for (const contentRange of [
		null, 'bytes 0-3/*', 'bytes 4-3/10', 'bytes 0-10/10', 'bytes 0-2/10', 'bytes 0-3/4 extra',
	]) {
		const repository = await repositoryWithSession();
		const response = await handleFreesoundOriginalRequest(context(new Request(
			'https://soundscaper.org/api/freesound/sounds/123/original',
			{ headers: authHeaders({ Range: 'bytes=0-3' }) },
		), { id: '123' }), {
			repository,
			now: () => NOW,
			fetchImpl: () => {
				const headers = new Headers({ 'Content-Type': 'audio/wav', 'Content-Length': '4' });
				if (contentRange !== null) headers.set('Content-Range', contentRange);
				return Promise.resolve(new Response(Uint8Array.of(1, 2, 3, 4), { status: 206, headers }));
			},
		});
		assert.equal(response.status, 502, contentRange ?? 'missing Content-Range');
		assert.equal((await response.json() as { error: { code: string } }).error.code,
			'invalid_upstream_response');
	}

	const validRepository = await repositoryWithSession();
	const valid = await handleFreesoundOriginalRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123/original',
		{ headers: authHeaders({ Range: 'bytes=0-3' }) },
	), { id: '123' }), {
		repository: validRepository,
		now: () => NOW,
		fetchImpl: () => Promise.resolve(new Response(Uint8Array.of(1, 2, 3, 4), {
			status: 206,
			headers: {
				'Content-Type': 'audio/wav',
				'Content-Length': '4',
				'Content-Range': `bytes 0-3/${String(MAX_FREESOUND_ORIGINAL_BYTES)}`,
			},
		})),
	});
	assert.equal(valid.status, 206);
	assert.equal(valid.headers.get('x-freesound-original-bytes'), String(MAX_FREESOUND_ORIGINAL_BYTES));
});

test('raw uploads use a canonical encoded filename and become one server-owned multipart audiofile field', async () => {
	const repository = await repositoryWithSession();
	let multipart = '';
	let upstreamHeaders = new Headers();
	let fixedLength = 0;
	const priorFixedLength = Object.getOwnPropertyDescriptor(globalThis, 'FixedLengthStream');
	class TestFixedLengthStream {
		readonly readable: ReadableStream<Uint8Array>;
		readonly writable: WritableStream<Uint8Array>;
		public constructor(length: number) {
			fixedLength = length;
			const stream = new TransformStream<Uint8Array, Uint8Array>();
			this.readable = stream.readable;
			this.writable = stream.writable;
		}
	}
	Object.defineProperty(globalThis, 'FixedLengthStream', { configurable: true, value: TestFixedLengthStream });
	const bytes = Uint8Array.of(82, 73, 70, 70);
	const request = new Request('https://soundscaper.org/api/freesound/uploads', {
		method: 'POST',
		headers: authHeaders({
			'Content-Type': 'audio/wav',
			'X-Freesound-Content-Length': String(bytes.byteLength),
			'X-Freesound-Filename': encodeURIComponent('Räin take.wav'),
		}),
		body: bytes,
	});
	let response: Response;
	try {
		response = await handleFreesoundUploadRequest(context(request), {
			repository,
			now: () => NOW,
			fetchImpl: async (_input, init) => {
				upstreamHeaders = new Headers(init?.headers);
				multipart = await new Response(init?.body).text();
				return jsonResponse({ detail: 'uploaded', filename: 'Räin_take_2.wav' }, 201);
			},
		});
	} finally {
		if (priorFixedLength) Object.defineProperty(globalThis, 'FixedLengthStream', priorFixedLength);
		else Reflect.deleteProperty(globalThis, 'FixedLengthStream');
	}

	assert.equal(response.status, 201);
	assert.deepEqual(await response.json(), { data: { uploadFilename: 'Räin_take_2.wav' } });
	assert.equal(upstreamHeaders.get('authorization'), 'Bearer access-token');
	assert.match(upstreamHeaders.get('content-type') ?? '', /^multipart\/form-data; boundary=soundscaper-/u);
	assert.equal(fixedLength, Number(upstreamHeaders.get('content-length')));
	assert.match(multipart, /name="audiofile"/u);
	assert.match(multipart, /filename\*=UTF-8''R%C3%A4in%20take\.wav/u);
	assert.match(multipart, /RIFF/u);
	assert.doesNotMatch(multipart, /name="(?:description|license|tags)"/u);
});

test('upload admission rejects non-canonical filename encoding, mismatched media, and oversized bodies', async () => {
	const repository = await repositoryWithSession();
	const cases = [
		{ filename: 'R%c3%a4in.wav', type: 'audio/wav', length: 4, code: 'invalid_upload' },
		{ filename: 'rain.wav', type: 'audio/mpeg', length: 4, code: 'unsupported_audio' },
		{ filename: 'rain.wav', type: 'audio/wav', length: MAX_FREESOUND_UPLOAD_BYTES + 1, code: 'upload_too_large' },
	];
	for (const item of cases) {
		const response = await handleFreesoundUploadRequest(context(new Request(
			'https://soundscaper.org/api/freesound/uploads',
			{
				method: 'POST',
				headers: authHeaders({
					'Content-Type': item.type,
					'Content-Length': String(item.length),
					'X-Freesound-Filename': item.filename,
				}),
				body: Uint8Array.of(1, 2, 3, 4),
			},
		)), { repository, now: () => NOW });
		assert.equal((await response.json() as { error: { code: string } }).error.code, item.code);
	}
	const conflictingLengths = await handleFreesoundUploadRequest(context(new Request(
		'https://soundscaper.org/api/freesound/uploads',
		{
			method: 'POST',
			headers: authHeaders({
				'Content-Type': 'audio/wav',
				'Content-Length': '4',
				'X-Freesound-Content-Length': '3',
				'X-Freesound-Filename': 'rain.wav',
			}),
			body: Uint8Array.of(1, 2, 3, 4),
		},
	)), { repository, now: () => NOW });
	assert.equal((await conflictingLengths.json() as { error: { code: string } }).error.code, 'invalid_upload');
});

test('describe maps owned metadata and license codes to Freesound fields, then reports moderation submission', async () => {
	const repository = await repositoryWithSession();
	let form: URLSearchParams | undefined;
	const response = await handleFreesoundDescribeRequest(context(new Request(
		'https://soundscaper.org/api/freesound/uploads/describe',
		{
			method: 'POST',
			headers: authHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({
				uploadFilename: 'rain.wav',
				title: 'Rain on glass',
				description: 'Recorded beside a window.',
				tags: ['rain', 'window', 'field-recording'],
				categoryId: 'fx-a',
				license: 'cc-by',
			}),
		},
	)), {
		repository,
		now: () => NOW,
		fetchImpl: async (_input, init) => {
			form = new URLSearchParams(String(init?.body));
			return jsonResponse({ detail: 'submitted', id: '987' });
		},
	});

	assert.equal(response.status, 202);
	assert.deepEqual(await response.json(), { data: { soundId: 987, status: 'submitted' } });
	assert(form);
	assert.equal(form.get('upload_filename'), 'rain.wav');
	assert.equal(form.get('name'), 'Rain on glass');
	assert.equal(form.get('bst_category'), 'fx-a');
	assert.equal(form.get('tags'), 'rain window field-recording');
	assert.equal(form.get('license'), 'Attribution');
});

test('pending uploads are normalized to the client contract and never cached', async () => {
	const repository = await repositoryWithSession();
	const response = await handleFreesoundPendingUploadsRequest(context(new Request(
		'https://soundscaper.org/api/freesound/uploads/pending',
		{ headers: authHeaders() },
	)), {
		repository,
		now: () => NOW,
		fetchImpl: () => Promise.resolve(jsonResponse({
			pending_description: ['rain.wav'],
			pending_processing: [{
				id: 7, name: 'Rain', tags: ['rain'], description: 'Wet.',
				created: '2026-09-22T12:00:00Z', license: 'Attribution', processing_state: 'Processing',
			}],
			pending_moderation: [{
				id: 8, name: 'Thunder', tags: ['storm'], description: 'Loud.',
				created: '2026-09-22T12:01:00Z', license: 'Creative Commons 0', images: { waveform_m: null },
			}],
		})),
	});

	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), { data: {
		pendingDescription: ['rain.wav'],
		pendingProcessing: [{
			id: 7, name: 'Rain', tags: ['rain'], description: 'Wet.',
			createdAt: '2026-09-22T12:00:00Z', license: 'Attribution', processingState: 'Processing',
		}],
		pendingModeration: [{
			id: 8, name: 'Thunder', tags: ['storm'], description: 'Loud.',
			createdAt: '2026-09-22T12:01:00Z', license: 'Creative Commons 0',
		}],
	} });
});

test('refresh leases serialize rotating refresh-token use across concurrent authenticated requests', async () => {
	const repository = await repositoryWithSession(true);
	let refreshes = 0;
	const fetchImpl: typeof fetch = async (_input, init) => {
		refreshes += 1;
		assert.equal(new URLSearchParams(String(init?.body)).get('refresh_token'), 'refresh-token');
		await new Promise((resolve) => setTimeout(resolve, 3));
		return jsonResponse({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 86_400 });
	};
	const makeRequest = () => context(new Request('https://soundscaper.org/api/freesound/usage', {
		headers: authHeaders(),
	}));
	const dependencies = {
		repository,
		now: () => NOW,
		fetchImpl,
		pause: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
	};
	const [first, second] = await Promise.all([
		handleFreesoundUsageRequest(makeRequest(), dependencies),
		handleFreesoundUsageRequest(makeRequest(), dependencies),
	]);

	assert.equal(first.status, 200);
	assert.equal(second.status, 200);
	assert.equal(refreshes, 1);
	assert.equal(repository.grants.get(GRANT_ID)?.refreshGeneration, 1);
});

test('terminal refresh failures disconnect only the current server session', async () => {
	for (const status of [400, 401]) {
		const repository = await repositoryWithSession(true);
		await addSecondSession(repository);
		const response = await handleFreesoundUsageRequest(context(new Request(
			'https://soundscaper.org/api/freesound/usage',
			{ headers: authHeaders() },
		)), {
			repository,
			now: () => NOW,
			fetchImpl: () => Promise.resolve(jsonResponse({ detail: 'invalid refresh token' }, status)),
		});

		assert.equal(response.status, 401);
		assert.equal(await sessionConnected(repository), false);
		assert.equal(await sessionConnected(repository, SECOND_SESSION_TOKEN), true);
		assert.equal(repository.grants.has(GRANT_ID), true);
	}
});

test('protected upstream authentication failures disconnect only the current server session', async () => {
	for (const status of [401, 403]) {
		const repository = await repositoryWithSession();
		await addSecondSession(repository);
		const response = await handleFreesoundPendingUploadsRequest(context(new Request(
			'https://soundscaper.org/api/freesound/uploads/pending',
			{ headers: authHeaders() },
		)), {
			repository,
			now: () => NOW,
			fetchImpl: () => Promise.resolve(jsonResponse({ detail: 'invalid access token' }, status)),
		});

		assert.equal(response.status, 401);
		assert.equal(await sessionConnected(repository), false);
		assert.equal(await sessionConnected(repository, SECOND_SESSION_TOKEN), true);
		assert.equal(repository.grants.has(GRANT_ID), true);
	}
});
