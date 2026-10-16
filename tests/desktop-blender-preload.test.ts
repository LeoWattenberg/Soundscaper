/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createBlenderPreloadBridge } from '../desktop/blender-preload.ts';
import { BLENDER_CHANNELS, validateBlenderBegin, validateBlenderWrite } from '../src/common/editor/blender-contract.ts';

const SESSION = 'a'.repeat(48);
const PUBLICATION = 'b'.repeat(48);
const PROJECT = { sessionId: SESSION, projectId: 'project-1', projectName: 'Music', tracks: [{ id: 'voice', name: 'Voice', startSeconds: 0, durationSeconds: 2, mute: false }] };

test('Blender preload exposes the frozen validated pathless publication API', async () => {
	const calls: Array<{ channel: string; value: unknown }> = [];
	const bridge = createBlenderPreloadBridge({ invoke: (channel, value) => {
		calls.push({ channel, value });
		const responses: Partial<Record<string, unknown>> = {
			[BLENDER_CHANNELS.select]: { sessionId: SESSION },
			[BLENDER_CHANNELS.begin]: { publicationId: PUBLICATION },
			[BLENDER_CHANNELS.commit]: { revision: 1 },
		};
		return Promise.resolve(responses[channel]);
	} });
	assert.equal(Object.isFrozen(bridge), true);
	assert.deepEqual(await bridge.select({ live: true }), { sessionId: SESSION });
	assert.deepEqual(await bridge.begin(PROJECT), { publicationId: PUBLICATION });
	await bridge.write({ sessionId: SESSION, publicationId: PUBLICATION, trackId: 'voice', offset: 0, bytes: Uint8Array.of(1, 2) });
	assert.deepEqual(await bridge.commit({ sessionId: SESSION, publicationId: PUBLICATION }), { revision: 1 });
	await bridge.abort({ sessionId: SESSION, publicationId: PUBLICATION });
	await bridge.stop({ sessionId: SESSION });
	assert.deepEqual(calls.map((call) => call.channel), Object.values(BLENDER_CHANNELS));
});

test('Blender preload rejects forged identities, unexpected responses, and injected request fields', async () => {
	let result: unknown = null;
	let calls = 0;
	const bridge = createBlenderPreloadBridge({ invoke: () => { calls++; return Promise.resolve(result); } });
	assert.equal(await bridge.select({ live: false }), null);
	result = { sessionId: '/tmp/forged' };
	await assert.rejects(bridge.select({ live: true }), /Invalid Blender/iu);
	result = { publicationId: PUBLICATION, path: '/tmp/injected' };
	await assert.rejects(bridge.begin(PROJECT), /response/iu);
	result = { revision: NaN };
	await assert.rejects(bridge.commit({ sessionId: SESSION, publicationId: PUBLICATION }), /revision/iu);
	const before = calls;
	await assert.rejects(bridge.select({ live: true, path: '/tmp/injected' } as { live: boolean }), /fields/iu);
	assert.equal(calls, before);
});

test('Blender contract snapshots chunks and prevents aliased metadata or excessive tracks', () => {
	const bytes = Uint8Array.of(1, 2);
	const request = validateBlenderWrite({ sessionId: SESSION, publicationId: PUBLICATION, trackId: 'voice', offset: 0, bytes });
	bytes[0] = 9;
	assert.deepEqual(request.bytes, Uint8Array.of(1, 2));
	const snapshot = validateBlenderBegin(PROJECT);
	assert.notEqual(snapshot.tracks, PROJECT.tracks);
	assert.notEqual(snapshot.tracks[0], PROJECT.tracks[0]);
	assert.throws(() => validateBlenderBegin({ ...PROJECT, tracks: Array.from({ length: 129 }, (_, index) => ({ ...PROJECT.tracks[0], id: String(index) })) }), /limit/iu);
	assert.throws(() => validateBlenderBegin({ ...PROJECT, tracks: [PROJECT.tracks[0], PROJECT.tracks[0]] }), /unique/iu);
	assert.throws(() => validateBlenderBegin(Object.defineProperty({ ...PROJECT }, 'projectName', { get: () => 'injected' })), /data properties/iu);
	assert.throws(() => validateBlenderBegin({ ...PROJECT, tracks: new Array(1) }), /data properties/iu);
});
