/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAraPluginRpc } from '../desktop/native-helper-ara-rpc.js';

const source = Object.freeze({ sourceId: 'clip-1', name: 'Voice', sampleRate: 48_000, channelCount: 2,
	frameCount: 4, sourceStartSeconds: 0, playbackStartSeconds: 2, durationSeconds: 4 / 48_000 });
function fixture(supported = true) {
	const calls: string[] = [];
	let analyzing = false;
	const instance = {};
	const rpc = createAraPluginRpc({
		araCapabilities: (value: unknown) => { assert.equal(value, instance); calls.push('capabilities'); return { supported }; },
		configureAra: (value: unknown, clip: unknown) => { assert.equal(value, instance); assert.deepEqual(clip, source); calls.push('configure'); return true; },
		writeAraPcm: (_value: unknown, chunk: Readonly<{ startFrame: number; channels: readonly Float32Array[] }>) => {
			calls.push(`write:${String(chunk.startFrame)}`); return true;
		},
		bindAra: () => { calls.push('bind'); return true; },
		renderAra: (_value: unknown, request: Readonly<{ startFrame: number; frameCount: number; channelCount: number }>) => {
			calls.push('render');
			if (analyzing) throw Object.assign(new Error('analysis pending'), { code: 'ara-analysis-incomplete' });
			return { channels: Array.from({ length: request.channelCount }, () => new Float32Array(request.frameCount).fill(0.25)), latencyFrames: 0 };
		},
	}, instance);
	let sequence = 0;
	const send = (kind: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> => rpc({ protocolVersion: 1,
		kind, requestId: `request-${String(++sequence)}`, ...payload });
	return { send, calls, analyzing(value: boolean) { analyzing = value; } };
}

test('ARA helper reports unavailable VST3 extension without configuring or uploading source PCM', async () => {
	const { send, calls } = fixture(false);
	assert.deepEqual(await send('ara-capabilities'), {
		protocolVersion: 1, kind: 'ara-capabilities', requestId: 'request-1', supported: false,
	});
	assert.deepEqual(calls, ['capabilities']);
});

test('ARA helper binds contiguous complete source upload and preserves edit session through analysis retry', async () => {
	const f = fixture();
	await f.send('ara-configure', { source });
	await assert.rejects(f.send('ara-bind'), /incomplete/u);
	await f.send('ara-write', { startFrame: 0, channels: [new Float32Array([1, 2]), new Float32Array([-1, -2])] });
	await assert.rejects(f.send('ara-write', { startFrame: 0, channels: [new Float32Array(2), new Float32Array(2)] }), /contiguous/u);
	await f.send('ara-write', { startFrame: 2, channels: [new Float32Array([3, 4]), new Float32Array([-3, -4])] });
	await f.send('ara-bind');
	f.analyzing(true);
	const waiting = await f.send('ara-render', { startFrame: 0, frameCount: 4 });
	assert.equal(waiting.analysisPending, true);
	f.analyzing(false);
	const rendered = await f.send('ara-render', { startFrame: 0, frameCount: 4 });
	assert.equal(rendered.startFrame, 0);
	assert.deepEqual(rendered.channels, [new Float32Array(4).fill(0.25), new Float32Array(4).fill(0.25)]);
	assert.deepEqual(f.calls, ['configure', 'write:0', 'write:2', 'bind', 'render', 'render']);
	await assert.rejects(f.send('ara-write', { startFrame: 4, channels: [new Float32Array(1), new Float32Array(1)] }), /unbound/u);
});

test('ARA helper rejects malformed geometry and unsafe PCM before invoking native operations', async () => {
	for (const changed of [{ frameCount: 300_000_000 }, { durationSeconds: 1 }, { playbackStartSeconds: -1 }, { sourceStartSeconds: 1 }, { name: '\0' }, { name: '' }]) {
		const f = fixture();
		await assert.rejects(f.send('ara-configure', { source: { ...source, ...changed } }), /ARA/u);
		assert.deepEqual(f.calls, []);
	}
	const f = fixture();
	await f.send('ara-configure', { source });
	const shared = new Float32Array(new SharedArrayBuffer(8));
	const aliased = new Float32Array(2);
	for (const channels of [[new Float32Array([NaN]), new Float32Array(1)], [shared, new Float32Array(2)], [aliased, aliased]]) {
		await assert.rejects(f.send('ara-write', { startFrame: 0, channels }), /ARA/u);
	}
	assert.deepEqual(f.calls, ['configure']);
});
