/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAudiocomProjectsRequest, handleAudiocomProjectDownloadRequest } from '../functions/api/audiocom/_shared/project-handlers.ts';
import { encryptOAuthSecret, hashCapability } from '../functions/api/audiocom/_shared/oauth-crypto.ts';
import { encodeBase64Url } from '../functions/api/freesound/_shared/oauth-crypto.ts';
import type { AudiocomOAuthFunctionContext } from '../functions/api/audiocom/_shared/oauth-http.ts';
import { MemoryAudiocomOAuthRepository } from './helpers/audiocom-oauth-memory-repository.ts';
import { normalizeProject } from '../functions/api/audiocom/_shared/project-contracts.ts';

const NOW = Date.UTC(2026, 9, 15);
const TOKEN = 't'.repeat(43);
const GRANT = 'audiocom-user-attempt';
const KEY = `v1:${encodeBase64Url(new Uint8Array(32).fill(13))}`;
const ORIGIN = 'http://127.0.0.1:8088';
const ID = '12345678-1234-4234-8234-123456789abc';
const SNAPSHOT = '87654321-1234-4234-8234-123456789abc';
const file = new TextEncoder().encode('SQLite format 3\0project archive');
const project = { id: ID, name: 'Session', format: 'aup3', transport: 'file', size: file.length, latest_synced_snapshot_id: SNAPSHOT };
const context = (path: string, init: RequestInit = {}): AudiocomOAuthFunctionContext => ({
	request: new Request(`http://127.0.0.1:4321/api/audiocom/${path}`, { ...init, headers: {
		Origin: 'http://127.0.0.1:4321', Authorization: `Bearer ${TOKEN}`, ...init.headers,
	} }),
	env: { AUDIOCOM_OAUTH_MASTER_KEY: KEY, AUDIOCOM_LOCAL_DEVELOPMENT: '1', AUDIOCOM_PROVIDER: 'audiocity', AUDIOCOM_API_ORIGIN: ORIGIN }, params: {},
});
const json = (data: unknown, status = 200): Response => Response.json(data, { status });
async function session(): Promise<MemoryAudiocomOAuthRepository> {
	const repository = new MemoryAudiocomOAuthRepository();
	repository.grants.set(GRANT, { id: GRANT, user: { id: `audiocity-${await hashCapability(ORIGIN)}-attempt`, username: '' },
		accessTokenCiphertext: await encryptOAuthSecret('provider-secret', KEY, `audiocom-oauth:${GRANT}:access`),
		refreshTokenCiphertext: await encryptOAuthSecret('provider-refresh', KEY, `audiocom-oauth:${GRANT}:refresh`),
		accessExpiresAt: NOW + 3600_000, refreshGeneration: 0, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
	const tokenHash = await hashCapability(TOKEN);
	repository.sessions.set(tokenHash, { tokenHash, grantId: GRANT, clientKind: 'desktop', createdAt: NOW, expiresAt: NOW + 86_400_000 });
	return repository;
}
const discovery = () => json({ name: 'Audiocity', url: ORIGIN, features: ['aup3-archives', 'aup4-archives'], limits: { max_upload_bytes: 100000000 } });

test('archive listing requires a project-capable provider and filters to whole-file transport', async () => {
	const repository = await session();
	const response = await handleAudiocomProjectsRequest(context('projects?page=2'), { repository, now: () => NOW,
		fetchImpl: (input, init) => {
			const url = new URL(String(input));
			if (url.pathname === '/.well-known/audiocity') return Promise.resolve(discovery());
			assert.equal(url.pathname, '/project'); assert.equal(url.searchParams.get('transport'), 'file');
			assert.equal(url.searchParams.get('page'), '2');
			assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer provider-secret');
			return Promise.resolve(json({ items: [project], pagination: { page: 2, pages: 3 } }));
		},
	});
	assert.equal(response.status, 200, await response.clone().text());
	assert.deepEqual(await response.json(), { data: { results: [{ id: ID, name: 'Session', format: 'aup3', size: file.length, snapshotId: SNAPSHOT }], page: 2, hasNext: true } });
	const unsupported = await handleAudiocomProjectsRequest({ ...context('projects'), env: { AUDIOCOM_OAUTH_MASTER_KEY: KEY } });
	assert.equal(unsupported.status, 404);
});

test('archive upload streams exact standalone bytes, confirms upload, then completes the snapshot', async () => {
	const repository = await session(); const calls: string[] = [];
	const response = await handleAudiocomProjectsRequest(context('projects?name=Session&format=aup3', { method: 'POST',
		headers: { 'Content-Type': 'application/octet-stream', 'X-Audiocom-Filename': 'Session.aup3', 'X-Audiocom-Content-Length': String(file.length) }, body: file }), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			const url = new URL(String(input)); calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
			if (url.pathname === '/.well-known/audiocity') return discovery();
			if (url.pathname === '/project' && init?.method === 'POST') {
				assert.deepEqual(JSON.parse(String(init.body)), { name: 'Session', format: 'aup3', size: file.length });
				return json({ project: { ...project, latest_synced_snapshot_id: '' }, snapshot: { id: SNAPSHOT }, sync: {
					file: { url: `${ORIGIN}/uploads/${ID}?token=${TOKEN}`, success: `${ORIGIN}/uploads/${ID}/success?token=${TOKEN}`, fail: `${ORIGIN}/uploads/${ID}/fail?token=${TOKEN}` }, blocks: [],
				} }, 201);
			}
			if (url.pathname.startsWith('/uploads/')) {
				assert.equal(new Headers(init?.headers).has('Authorization'), false);
				if (init?.method === 'PUT') assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), file);
				return json({ id: ID, size: file.length });
			}
			if (url.pathname.endsWith('/sync')) return json({ id: SNAPSHOT });
			return json(project);
		},
	});
	assert.equal(response.status, 201, await response.clone().text());
	assert.deepEqual(calls.slice(-4), [`PUT /uploads/${ID}`, `POST /uploads/${ID}/success`, `POST /project/${ID}/snapshot/${SNAPSHOT}/sync`, `GET /project/${ID}`]);
	assert.equal((await response.text()).includes('token=secret'), false);
});

test('archive upload refuses excess size before publication', async () => {
	const oversized = await handleAudiocomProjectsRequest(context('projects?name=Session&format=aup3', { method: 'POST', headers: {
		'Content-Type': 'application/octet-stream', 'X-Audiocom-Filename': 'Session.aup3', 'X-Audiocom-Content-Length': '100000001',
	}, body: file }));
	assert.equal(oversized.status, 413);
});

test('malformed SQLite archives abort the transfer and run cleanup without success or sync', async () => {
	const repository = await session(); const methods: string[] = [];
	const response = await handleAudiocomProjectsRequest(context('projects?name=Session&format=aup3', { method: 'POST',
		headers: { 'Content-Type': 'application/octet-stream', 'X-Audiocom-Filename': 'Session.aup3', 'X-Audiocom-Content-Length': String(file.length) }, body: new Uint8Array(file.length) }), {
		repository, now: () => NOW, fetchImpl: async (input, init) => {
			const url = new URL(String(input));
			if (url.pathname === '/.well-known/audiocity') return discovery();
			methods.push(`${init?.method ?? 'GET'} ${url.pathname}`);
			if (url.pathname === '/project') return json({ project, snapshot: { id: SNAPSHOT }, sync: { blocks: [], file: {
				url: `${ORIGIN}/uploads/${ID}?token=${TOKEN}`, success: `${ORIGIN}/uploads/${ID}/success?token=${TOKEN}`, fail: `${ORIGIN}/uploads/${ID}/fail?token=${TOKEN}`,
			} } }, 201);
			if (init?.method === 'PUT') await new Response(init.body).arrayBuffer();
			return json({});
		},
	});
	assert.equal(response.status, 422);
	assert.deepEqual(methods, ['POST /project', `PUT /uploads/${ID}`, `DELETE /uploads/${ID}/fail`]);
});

test('archive metadata uses the completed generation when a newer revision changes format', () => {
	assert.equal(normalizeProject({ ...project, format: 'aup4', latest_synced_format: 'aup3' }).format, 'aup3');
	assert.equal(normalizeProject({ ...project, format: 'aup4', latest_synced_format: '', latest_synced_snapshot_id: '' }).format, 'aup4');
});

test('archive download resolves authenticated metadata and never forwards credentials to signed media', async () => {
	const repository = await session();
	const response = await handleAudiocomProjectDownloadRequest(context(`projects/download?id=${ID}&snapshotId=${SNAPSHOT}`), {
		repository, now: () => NOW, fetchImpl: (input, init) => {
			const url = new URL(String(input));
			if (url.pathname === '/.well-known/audiocity') return Promise.resolve(discovery());
			if (url.pathname === `/project/${ID}`) return Promise.resolve(json(project));
			if (url.pathname.startsWith('/project/')) return Promise.resolve(json({ id: SNAPSHOT, format: 'aup3', transport: 'file', date_synced: 1, file_size: file.length, blocks: [], file_url: `${ORIGIN}/media/${ID}?expires=1&signature=${TOKEN}` }));
			assert.equal(new Headers(init?.headers).has('Authorization'), false);
			return Promise.resolve(new Response(file, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.length) } }));
		},
	});
	assert.equal(response.status, 200, await response.clone().text());
	assert.match(response.headers.get('Content-Disposition') ?? '', /Session\.aup3/u);
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), file);
});

test('archive download rejects native snapshots and signed URL redirection before transfer', async () => {
	for (const value of [{ transport: 'blocks', format: 'audacity' }, { file_url: 'https://evil.test/archive' }]) {
		const repository = await session(); let transfers = 0;
		const response = await handleAudiocomProjectDownloadRequest(context(`projects/download?id=${ID}&snapshotId=${SNAPSHOT}`), {
			repository, now: () => NOW, fetchImpl: input => {
				const url = new URL(String(input));
				if (url.pathname === '/.well-known/audiocity') return Promise.resolve(discovery());
				if (url.pathname === `/project/${ID}`) return Promise.resolve(json(project));
				if (url.pathname.startsWith('/project/')) return Promise.resolve(json({ id: SNAPSHOT, transport: 'file', format: 'aup3', date_synced: 1, file_size: file.length, file_url: `${ORIGIN}/media/${ID}?expires=1&signature=${TOKEN}`, ...value }));
				transfers++; return Promise.resolve(new Response(file));
			},
		});
		assert.equal(response.status, 502); assert.equal(transfers, 0);
	}
});
