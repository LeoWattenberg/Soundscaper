/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAudiocomPanelSession,
	audiocomPanelSession,
	type AudiocomApiClient,
	type AudiocomUploadDraft,
} from '../src/common/editor/controller/import/audiocom-panel-session.ts';

const DRAFT: AudiocomUploadDraft = {
	title: 'Forest', description: '', category: 'recording', license: 'arr',
	visibility: 'unlisted', downloadable: false, rightsConfirmed: true,
};
const RESULT = {
	id: '123', title: 'Forest', authorName: 'Recorder', username: 'recorder',
	url: 'https://audio.com/recorder/audio/forest', description: '', license: 'arr',
	isDownloadable: false, durationSeconds: 3, previewUrl: '/api/audiocom/preview?url=test',
};

function client(overrides: Partial<AudiocomApiClient> = {}): AudiocomApiClient {
	return {
		session: async () => ({ connected: true }), disconnect: async () => undefined,
		startOAuth: async () => ({ attemptId: 'a', handoffToken: 'b', authorizeUrl: 'https://api.audio.com/auth/authorize', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
		pollOAuth: async () => ({ connected: true }), reserveAuthorization: () => ({ open: async () => undefined, close: () => undefined }),
		search: async ({ page }) => ({ results: [RESULT], page, hasNext: false }),
		upload: async () => ({ audio: RESULT, processing: true }), ...overrides,
	};
}

test('restores an account, searches, and drops stale searches even when fetch ignores abort', async () => {
	let release!: (value: { results: typeof RESULT[]; page: number; hasNext: boolean }) => void;
	const session = createAudiocomPanelSession({ client: client({ search: ({ query, page }) => query === 'old'
		? new Promise(resolve => { release = resolve; })
		: Promise.resolve({ results: [{ ...RESULT, title: query }], page, hasNext: false }) }) });
	await session.initialize();
	assert.equal(session.getSnapshot().auth.status, 'connected');
	const old = session.search({ query: 'old', page: 1 });
	await session.search({ query: 'new', page: 1 });
	release({ results: [RESULT], page: 1, hasNext: true });
	await old;
	assert.equal(session.getSnapshot().search.results[0].title, 'new');
	session.dispose();
});

test('requires rights and keeps project files out of the audio upload queue', async () => {
	const session = createAudiocomPanelSession({ client: client() });
	await session.initialize();
	assert.throws(() => session.enqueueFiles([new File(['project'], 'edit.aup4')]), /audio|project|format/iu);
	const [id] = session.enqueueFiles([new File(['RIFF'], 'forest.wav', { type: 'audio/wav' })]);
	await assert.rejects(session.publish(id, { ...DRAFT, rightsConfirmed: false }), /rights/iu);
	assert.equal(session.getSnapshot().uploadQueue.items[0].status, 'draft');
	await session.publish(id, DRAFT);
	assert.equal(session.getSnapshot().uploadQueue.items[0].status, 'processing');
	assert.equal(session.getSnapshot().uploadQueue.items[0].url, RESULT.url);
	assert.equal(session.getSnapshot().uploadQueue.active, false);
	session.dispose();
});

test('cancelling an upload fences late completion and clears queue/account data on disconnect', async () => {
	let release!: (value: { audio: typeof RESULT; processing: boolean }) => void;
	let signal: AbortSignal | undefined;
	const session = createAudiocomPanelSession({ client: client({ upload: (_file, _draft, requestedSignal) => {
		signal = requestedSignal;
		return new Promise(resolve => { release = resolve; });
	} }) });
	await session.initialize();
	const [id] = session.enqueueFiles([new File(['RIFF'], 'forest.wav', { type: 'audio/wav' })]);
	const uploading = session.publish(id, DRAFT);
	assert.equal(session.getSnapshot().uploadQueue.items[0].status, 'uploading');
	session.cancel(id);
	assert.equal(signal?.aborted, true);
	release({ audio: RESULT, processing: true });
	await uploading;
	assert.equal(session.getSnapshot().uploadQueue.items[0].status, 'cancelled');
	await session.disconnect();
	assert.deepEqual(session.getSnapshot().uploadQueue.items, []);
	assert.equal(session.getSnapshot().auth.status, 'disconnected');
	session.dispose();
});

test('a hidden panel releases previews and disposal is idempotent', async () => {
	const calls: string[] = [];
	const session = createAudiocomPanelSession({ client: client(), createAudio: () => ({
		pause: () => calls.push('pause'), play: async () => { calls.push('play'); },
		load: () => calls.push('load'), src: '', volume: 1,
		addEventListener: () => undefined, removeEventListener: () => undefined,
	}) });
	await session.initialize();
	await session.search({ query: 'forest', page: 1 });
	await session.preview('123');
	assert.equal(session.getSnapshot().previewingId, '123');
	session.setActive(false);
	assert.equal(session.getSnapshot().previewingId, null);
	assert.ok(calls.includes('pause'));
	session.dispose();
	session.dispose();
});

test('owner sessions retain queues through panel remounts and release on controller disposal', async () => {
	let notify = (): void => undefined;
	let disposed = false;
	let unsubscribed = false;
	const owner = {
		getSnapshot: () => ({ disposed }),
		subscribe: (listener: () => void) => { notify = listener; return () => { unsubscribed = true; }; },
	};
	const session = audiocomPanelSession(owner, { client: client() });
	await session.initialize();
	session.enqueueFiles([new File(['RIFF'], 'forest.wav', { type: 'audio/wav' })]);
	session.setActive(false);
	assert.equal(audiocomPanelSession(owner), session);
	assert.equal(audiocomPanelSession(owner).getSnapshot().uploadQueue.items.length, 1);
	disposed = true; notify();
	assert.equal(unsubscribed, true);
	assert.equal(session.getSnapshot().uploadQueue.items.length, 0);
});

test('a failed disconnect retains a visible account action so revocation can be retried', async () => {
	let calls = 0;
	const session = createAudiocomPanelSession({ client: client({ disconnect: async () => {
		if (++calls === 1) throw new Error('Network unavailable');
	} }) });
	await session.initialize();
	await session.disconnect();
	assert.equal(session.getSnapshot().auth.status, 'connected');
	assert.match(session.getSnapshot().auth.errorMessage ?? '', /Network unavailable/u);
	await session.disconnect();
	assert.equal(session.getSnapshot().auth.status, 'disconnected');
	session.dispose();
});


test('changing the selected server disposes stale work, clears queues, and replaces the owner session', async () => {
	let aborted: AbortSignal | undefined;
	let release!: (value: { results: typeof RESULT[]; page: number; hasNext: boolean }) => void;
	let unsubscribed = 0;
	const owner = { getSnapshot: () => ({ disposed: false }), subscribe: () => () => { unsubscribed++; } };
	const previous = audiocomPanelSession(owner, { client: client({ search: (_request, signal) => {
		aborted = signal; return new Promise(resolve => { release = resolve; });
	} }) });
	await previous.initialize();
	previous.enqueueFiles([new File(['RIFF'], 'forest.wav', { type: 'audio/wav' })]);
	const searching = previous.search({ query: 'forest', page: 1 });
	const changed = audiocomPanelSession(owner, { apiOrigin: 'https://audio.example.org', client: client({ session: async () => ({ connected: false }) }) });
	assert.notEqual(changed, previous);
	assert.equal(aborted?.aborted, true);
	assert.equal(unsubscribed, 1);
	assert.deepEqual(changed.getSnapshot().uploadQueue.items, []);
	release({ results: [RESULT], page: 1, hasNext: false }); await searching;
	assert.equal(changed.getSnapshot().search.results.length, 0);
	await changed.initialize(); assert.equal(changed.getSnapshot().auth.status, 'disconnected');
	assert.equal(audiocomPanelSession(owner, { apiOrigin: 'https://audio.example.org' }), changed);
	const restored = audiocomPanelSession(owner, { client: client({ session: async () => ({ connected: false }) }) });
	assert.notEqual(restored, previous); assert.notEqual(restored, changed);
	restored.dispose();
});
