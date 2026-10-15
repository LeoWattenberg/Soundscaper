/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudiocomProjectArchives, type AudiocomProjectArchiveClient } from '../src/common/editor/controller/import/audiocom-project-archives.ts';
import { createAudiocomProjectArchiveClient } from '../src/common/editor/controller/import/internal/audiocom-project-archive-client.ts';
import { AudiocomApiError } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';

const ID = '12345678-1234-4234-8234-123456789abc';
const item = { id: ID, name: 'Session', format: 'aup3' as const, size: 32, snapshotId: ID };
const file = new File(['SQLite format 3\0project archive'], 'Session.aup3');
const client = (overrides: Partial<AudiocomProjectArchiveClient> = {}): AudiocomProjectArchiveClient => ({
	capabilities: () => Promise.resolve({ formats: ['aup3', 'aup4'], maximumBytes: 100000000 }),
	list: page => Promise.resolve({ results: [item], page, hasNext: false }),
	upload: () => Promise.resolve(item), download: () => Promise.resolve(file), ...overrides,
});

test('project archives remain hidden until advertised and reset on account disconnection', async () => {
	const session = createAudiocomProjectArchives({ client: client() });
	assert.equal(session.getSnapshot().supported, false);
	await session.setConnected(true); assert.equal(session.getSnapshot().supported, true);
	await session.refresh(1); assert.deepEqual(session.getSnapshot().results, [item]);
	await session.setConnected(false); assert.equal(session.getSnapshot().supported, false);
	assert.deepEqual(session.getSnapshot().results, []); session.dispose(); session.dispose();
});

test('project upload validates a standalone format before sending bytes and refreshes completed list', async () => {
	const sent: File[] = [];
	const session = createAudiocomProjectArchives({ client: client({ upload: selected => { sent.push(selected); return Promise.resolve(item); } }) });
	await session.setConnected(true);
	await session.upload(new File(['audio'], 'not-a-project.wav'));
	assert.equal(sent.length, 0); assert.match(session.getSnapshot().errorMessage ?? '', /AUP3|AUP4/u);
	await session.upload(file); assert.deepEqual(sent, [file]); assert.deepEqual(session.getSnapshot().results, [item]);
	assert.equal(session.getSnapshot().status, 'ready'); session.dispose();
});

test('download hands the archive to the ordinary file service with its matching project extension', async () => {
	const saves: unknown[] = [];
	const session = createAudiocomProjectArchives({ client: client(), saveFile: request => { saves.push(request); return Promise.resolve(); } });
	await session.setConnected(true); await session.download(item);
	assert.equal(saves.length, 1);
	assert.equal((saves[0] as { suggestedName: string }).suggestedName, 'Session.aup3');
	assert.equal((saves[0] as { blob: Blob }).blob, file);
	session.dispose();
});

test('account changes fence an old archive list and abort the request', async () => {
	let resolve: (value: Awaited<ReturnType<AudiocomProjectArchiveClient['list']>>) => void = () => {};
	let signal: AbortSignal | undefined;
	const session = createAudiocomProjectArchives({ client: client({ list: (_page, selected) => {
		signal = selected; return new Promise(done => { resolve = done; });
	} }) });
	await session.setConnected(true); const pending = session.refresh(1);
	await session.setConnected(false); resolve({ results: [item], page: 1, hasNext: false }); await pending;
	assert.equal(signal?.aborted, true); assert.deepEqual(session.getSnapshot().results, []); session.dispose();
});

test('archive authentication expiry clears private results and resets the shared account exactly once', async () => {
	let expired = false; let accountResets = 0;
	const session = createAudiocomProjectArchives({ client: client({ list: page => expired
		? Promise.reject(new AudiocomApiError(401, 'Reconnect to continue.')) : Promise.resolve({ results: [item], page, hasNext: false }) }),
		onAuthenticationExpired: () => { accountResets += 1; } });
	await session.setConnected(true); await session.refresh(1); assert.equal(session.getSnapshot().results.length, 1);
	expired = true; await session.refresh(1); await session.refresh(1);
	assert.equal(accountResets, 1); assert.deepEqual(session.getSnapshot().results, []);
	assert.equal(session.getSnapshot().supported, false); session.dispose();
});

test('cancelled and failed archive uploads explain a possible unfinished server project', async () => {
	let rejectUpload: (reason: Error) => void = () => {};
	let uploadSignal: AbortSignal | undefined;
	const session = createAudiocomProjectArchives({ client: client({ upload: (_file, _name, signal) => {
		uploadSignal = signal; return new Promise((_done, reject) => { rejectUpload = reject; });
	} }) });
	await session.setConnected(true); const pending = session.upload(file);
	for (let index = 0; index < 10 && !uploadSignal; index++) await Promise.resolve();
	session.cancel(); rejectUpload(new Error('Cancelled')); await pending;
	assert.equal(uploadSignal?.aborted, true); assert.match(session.getSnapshot().errorMessage ?? '', /unfinished project/u);
	session.dispose();
	const failed = createAudiocomProjectArchives({ client: client({ upload: () => Promise.reject(new Error('Storage unavailable.')) }) });
	await failed.setConnected(true); await failed.upload(file);
	assert.match(failed.getSnapshot().errorMessage ?? '', /Storage unavailable.*unfinished project/u); failed.dispose();
});

test('archive transport keeps raw files, validates download headers, and enforces byte limits', async () => {
	let body: BodyInit | null | undefined;
	const api = createAudiocomProjectArchiveClient({ location: { origin: 'http://127.0.0.1:4321', protocol: 'http:' }, fetch: async (input, init) => {
		const url = String(input); body = init?.body;
		if (url.includes('/usage')) return Response.json({ data: { projectStorageSupported: true, projectFormats: ['aup3'], maximumUploadBytes: 100000000 } });
		if (url.includes('/download')) return new Response(file, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) } });
		return Response.json({ data: item });
	} });
	assert.deepEqual(await api.capabilities(), { formats: ['aup3'], maximumBytes: 100000000 });
	await api.upload(file, 'Session'); assert.equal(body, file);
	assert.equal((await api.download({ ...item, size: file.size })).size, file.size);
	const bad = createAudiocomProjectArchiveClient({ fetch: () => Promise.resolve(new Response(file, { headers: { 'Content-Length': '100000001' } })) });
	await assert.rejects(bad.download(item), /size|limit/iu);
});

test('archive authentication errors retain their status for incomplete or non-JSON error bodies', async () => {
	for (const response of [new Response('<html>Sign in</html>', { status: 401 }), Response.json({ message: 'Sign in' }, { status: 401 }), new Response(null, { status: 401 })]) {
		const api = createAudiocomProjectArchiveClient({ fetch: () => Promise.resolve(response) });
		await assert.rejects(api.list(1), error => error instanceof AudiocomApiError && error.status === 401);
	}
});

test('archive provider metadata applies the same editor-origin policy as OAuth', async () => {
	const provider = { kind: 'audiocity', apiOrigin: 'http://127.0.0.1:8088', webOrigin: 'http://127.0.0.1:8088', scope: 'public projects' };
	const metadata = () => Promise.resolve(Response.json({ data: { provider, projectStorageSupported: true, projectFormats: ['aup3'], maximumUploadBytes: 100000000 } }));
	const local = createAudiocomProjectArchiveClient({ location: { origin: 'http://127.0.0.1:4321', protocol: 'http:' }, fetch: metadata });
	assert.equal((await local.capabilities()).provider?.webOrigin, provider.webOrigin);
	const remote = createAudiocomProjectArchiveClient({ location: { origin: 'https://soundscaper.org', protocol: 'https:' }, fetch: metadata });
	await assert.rejects(remote.capabilities(), /origin/iu);
});
