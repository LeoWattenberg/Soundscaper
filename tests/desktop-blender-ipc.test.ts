/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { registerBlenderIpc } from '../desktop/blender-ipc.ts';
import { BLENDER_CHANNELS, type BlenderManifest } from '../src/common/editor/blender-contract.ts';

const WAVE = Uint8Array.from(Buffer.from('524946462400000057415645666d7420100000000100010080bb000000770100020010006461746100000000', 'hex'));
const PROJECT = { projectId: 'project-1', projectName: 'Dialogue', tracks: [{ id: 'track-1', name: 'Voice', startSeconds: 1.5, durationSeconds: 0, mute: false }] };

test('desktop Blender publications atomically export numbered immutable media revisions', async () => {
	const fixture = await setup();
	try {
		const { sessionId } = await fixture.invoke('select', { live: false }) as { sessionId: string };
		const publication = await fixture.invoke('begin', { sessionId, ...PROJECT }) as { publicationId: string };
		await assert.rejects(fixture.invoke('commit', { sessionId, ...publication }), /WAV/iu);
		await fixture.invoke('write', { sessionId, ...publication, trackId: 'track-1', offset: 0, bytes: WAVE.slice(0, 12) });
		await assert.rejects(fixture.invoke('write', { sessionId, ...publication, trackId: 'track-1', offset: 0, bytes: WAVE }), /offset/iu);
		await fixture.invoke('write', { sessionId, ...publication, trackId: 'track-1', offset: 12, bytes: WAVE.slice(12) });
		assert.deepEqual(await fixture.invoke('commit', { sessionId, ...publication }), { revision: 1 });
		const directory = await fixture.directory();
		const first = JSON.parse(await readFile(join(directory, 'soundscaper.json'), 'utf8')) as BlenderManifest;
		assert.equal(first.tracks[0]!.startSeconds, 1.5);
		assert.deepEqual(await readFile(join(directory, first.tracks[0]!.fileName)), Buffer.from(WAVE));
		const second = await fixture.invoke('begin', { sessionId, ...PROJECT }) as { publicationId: string };
		await fixture.invoke('write', { sessionId, ...second, trackId: 'track-1', offset: 0, bytes: WAVE });
		assert.deepEqual(await fixture.invoke('commit', { sessionId, ...second }), { revision: 2 });
		const latest = JSON.parse(await readFile(join(directory, 'soundscaper.json'), 'utf8')) as BlenderManifest;
		assert.notEqual(latest.tracks[0]!.fileName, first.tracks[0]!.fileName);
		assert.deepEqual(await readFile(join(directory, first.tracks[0]!.fileName)), Buffer.from(WAVE));
		assert.equal((await readdir(directory)).some((name) => name.startsWith('.publication-')), false);
	} finally { await fixture.dispose(); }
});

test('desktop Blender loopback IPC requires its bearer token and rejects browser origins', async () => {
	const fixture = await setup();
	try {
		const { sessionId } = await fixture.invoke('select', { live: true }) as { sessionId: string };
		const directory = await fixture.directory();
		const live = JSON.parse(await readFile(join(directory, 'live.json'), 'utf8')) as { host: string; port: number; token: string };
		assert.equal(live.host, '127.0.0.1');
		if (process.platform !== 'win32') assert.equal((await stat(join(directory, 'live.json'))).mode & 0o777, 0o600);
		const address = `http://${live.host}:${String(live.port)}`;
		const headers = { Authorization: `Bearer ${live.token}` };
		assert.equal((await fetch(`${address}/snapshot?after=0`)).status, 403);
		assert.equal((await fetch(`${address}/snapshot?after=0`, { headers: { ...headers, Origin: 'https://example.test' } })).status, 403);
		assert.equal((await fetch(`${address}/../soundscaper.json`, { headers })).status, 404);
		assert.equal((await fetch(`${address}/snapshot?after=0`, { headers })).status, 204);
		const publication = await fixture.invoke('begin', { sessionId, ...PROJECT }) as { publicationId: string };
		await fixture.invoke('write', { sessionId, ...publication, trackId: 'track-1', offset: 0, bytes: WAVE });
		await fixture.invoke('commit', { sessionId, ...publication });
		const response = await fetch(`${address}/snapshot?after=0`, { headers });
		assert.equal(response.status, 200);
		assert.equal((await response.json() as BlenderManifest).revision, 1);
		assert.equal((await fetch(`${address}/snapshot?after=1`, { headers })).status, 204);
		await fixture.invoke('stop', { sessionId });
		await assert.rejects(readFile(join(directory, 'live.json')), { code: 'ENOENT' });
		await assert.rejects(fetch(`${address}/snapshot?after=0`, { headers }));
		assert.ok(await readFile(join(directory, 'soundscaper.json')));
	} finally { await fixture.dispose(); }
});

test('desktop Blender IPC binds sessions to renderer owners and cleans revoked staging', async () => {
	const fixture = await setup();
	try {
		const { sessionId } = await fixture.invoke('select', { live: false }) as { sessionId: string };
		await assert.rejects(fixture.invoke('begin', { sessionId, ...PROJECT }, {}), /owner/iu);
		const publication = await fixture.invoke('begin', { sessionId, ...PROJECT }) as { publicationId: string };
		await fixture.invoke('write', { sessionId, ...publication, trackId: 'track-1', offset: 0, bytes: WAVE });
		const directory = await fixture.directory();
		await fixture.service.revokeOwner(fixture.owner);
		await assert.rejects(fixture.invoke('commit', { sessionId, ...publication }), /owner|session/iu);
		assert.deepEqual(await readdir(directory), []);
	} finally { await fixture.dispose(); }
});

test('desktop Blender IPC validates bounded closed metadata and handles chooser cancellation', async () => {
	const fixture = await setup();
	try {
		await assert.rejects(fixture.invoke('select', { live: true, path: '/tmp/injected' }), /fields/iu);
		const { sessionId } = await fixture.invoke('select', { live: false }) as { sessionId: string };
		await assert.rejects(fixture.invoke('begin', { sessionId, ...PROJECT, tracks: [{ ...PROJECT.tracks[0], durationSeconds: Infinity }] }), /duration/iu);
		const publication = await fixture.invoke('begin', { sessionId, ...PROJECT }) as { publicationId: string };
		await assert.rejects(fixture.invoke('write', { sessionId, ...publication, trackId: 'track-1', offset: 0, bytes: new Uint8Array(4 * 1024 * 1024 + 1) }), /chunk/iu);
		await fixture.invoke('abort', { sessionId, ...publication });
		assert.deepEqual(await readdir(await fixture.directory()), []);
		fixture.cancel();
		assert.equal(await fixture.invoke('select', { live: false }), null);
	} finally { await fixture.dispose(); }
});

test('desktop Blender stop cancels already queued writes and commits before publication', async () => {
	const fixture = await setup();
	try {
		const { sessionId } = await fixture.invoke('select', { live: false }) as { sessionId: string };
		const publication = await fixture.invoke('begin', { sessionId, ...PROJECT }) as { publicationId: string };
		const results = await Promise.allSettled([
			fixture.invoke('write', { sessionId, ...publication, trackId: 'track-1', offset: 0, bytes: WAVE }),
			fixture.invoke('commit', { sessionId, ...publication }),
			fixture.invoke('stop', { sessionId }),
		]);
		assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected', 'fulfilled']);
		assert.deepEqual(await readdir(await fixture.directory()), []);
	} finally { await fixture.dispose(); }
});

test('desktop Blender rejects excess queued chunks to bound pending memory', async () => {
	const fixture = await setup();
	try {
		const { sessionId } = await fixture.invoke('select', { live: false }) as { sessionId: string };
		const publication = await fixture.invoke('begin', { sessionId, ...PROJECT }) as { publicationId: string };
		const results = await Promise.allSettled(Array.from({ length: 5 }, () => fixture.invoke('write', {
			sessionId, ...publication, trackId: 'track-1', offset: 0, bytes: WAVE,
		})));
		const last = results[4]!;
		assert.equal(last.status, 'rejected');
		if (last.status === 'rejected') assert.match(String(last.reason), /queue/iu);
		await fixture.invoke('abort', { sessionId, ...publication });
	} finally { await fixture.dispose(); }
});

test('desktop Blender rejects truncated WAV declarations before publishing a manifest', async () => {
	const fixture = await setup();
	try {
		const { sessionId } = await fixture.invoke('select', { live: false }) as { sessionId: string };
		const publication = await fixture.invoke('begin', { sessionId, ...PROJECT }) as { publicationId: string };
		const incomplete = Uint8Array.from(WAVE);
		incomplete[4] = 128;
		await fixture.invoke('write', { sessionId, ...publication, trackId: 'track-1', offset: 0, bytes: incomplete });
		await assert.rejects(fixture.invoke('commit', { sessionId, ...publication }), /WAV/iu);
		await assert.rejects(readFile(join(await fixture.directory(), 'soundscaper.json')), { code: 'ENOENT' });
	} finally { await fixture.dispose(); }
});

test('desktop Blender export copies its bundled receiver beside the manifest', async () => {
	const fixture = await setup('receiver source');
	try {
		await fixture.invoke('select', { live: false });
		assert.equal(await readFile(join(await fixture.directory(), 'soundscaper_blender.py'), 'utf8'), 'receiver source');
	} finally { await fixture.dispose(); }
});

test('desktop Blender IPC refuses admission after disposal and removes every handler once', async () => {
	const fixture = await setup();
	try {
		const handler = fixture.handler('select');
		await fixture.service.dispose();
		await fixture.service.dispose();
		assert.deepEqual(fixture.removed, Object.values(BLENDER_CHANNELS));
		await assert.rejects(handler(fixture.owner, { live: true }), /owner/iu);
		assert.deepEqual(await readdir(fixture.parent), []);
	} finally { await fixture.dispose(); }
});

async function setup(addonText?: string) {
	const parent = await mkdtemp(join(tmpdir(), 'soundscaper-blender-test-'));
	const owner = {};
	let canceled = false;
	const removed: string[] = [];
	const handlers = new Map<string, (event: unknown, value: unknown) => Promise<unknown>>();
	const addonPath = addonText === undefined ? undefined : join(parent, 'bundled-source.py');
	if (addonPath) await writeFile(addonPath, addonText!);
	const service = registerBlenderIpc({
		handle: (channel, handler) => { handlers.set(channel, handler); },
		removeHandler: (channel) => { removed.push(channel); handlers.delete(channel); },
		ownerFor: (event) => event as object,
		isOwnerCurrent: () => true,
		windowFor: () => null,
		dialog: { showOpenDialog: async () => ({ canceled, filePaths: [parent] }) },
		...(addonPath ? { addonPath } : {}),
	});
	return {
		owner, service, parent, removed,
		cancel: () => { canceled = true; },
		handler: (method: keyof typeof BLENDER_CHANNELS) => handlers.get(BLENDER_CHANNELS[method])!,
		invoke: (method: keyof typeof BLENDER_CHANNELS, value: unknown, event: object = owner) => handlers.get(BLENDER_CHANNELS[method])!(event, value),
		directory: async () => join(parent, (await readdir(parent)).find((name) => name.startsWith('Soundscaper-Blender-'))!),
		dispose: async () => { await service.dispose(); await rm(parent, { recursive: true, force: true }); },
	};
}
