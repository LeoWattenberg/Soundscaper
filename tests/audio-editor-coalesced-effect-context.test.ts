/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tryPrepareCoalescedEffectContext } from '../src/common/editor/controller/effects/internal/coalesced-effect-context.ts';

test('one admitted range supplies exact owned selection and clipped neighboring channels', async () => {
	for (const [startFrame, endFrame, projectEnd] of [[220, 224, 500], [0, 4, 50], [46, 50, 50]]) {
		const calls: number[][] = [];
		const target = { track: { id: 'track' }, startFrame, endFrame, channelCount: 2, clipIds: ['clip'] };
		const result = await tryPrepareCoalescedEffectContext(target, 128, 128, projectEnd, 1_000_000,
			async (track, from, to, channelCount, clipIds) => {
				assert.equal(track, 'track'); assert.deepEqual(clipIds, ['clip']);
				calls.push([from, to]);
				return Array.from({ length: channelCount }, (_, channel) => Float32Array.from(
					{ length: to - from }, (_, frame) => (from + frame + channel) / 1_000));
			});
		assert.ok(result);
		assert.deepEqual(calls, [[Math.max(0, startFrame - 128), Math.min(projectEnd, endFrame + 128)]]);
		assert.deepEqual(result.channels[0], Float32Array.from({ length: endFrame - startFrame }, (_, index) => (startFrame + index) / 1_000));
		assert.equal(result.context.beforeChannels[0]!.length, Math.min(startFrame, 128));
		assert.equal(result.context.afterChannels?.[0]!.length, Math.min(projectEnd - endFrame, 128));
		const all = [...result.channels, ...result.context.beforeChannels, ...result.context.afterChannels ?? []];
		assert.equal(new Set(all.map((channel) => channel.buffer)).size, all.length);
		for (const channel of all) assert.equal(channel.byteLength, channel.buffer.byteLength, 'worker inputs own exact spans');
	}
});

test('one-sided preroll does not read following audio and tight memory admission keeps the original path', async () => {
	const target = { track: { id: 'track' }, startFrame: 220, endFrame: 224, channelCount: 1 };
	let calls = 0;
	const render = async (_track: string, from: number, to: number) => {
		calls += 1;
		assert.deepEqual([from, to], [92, 224]);
		return [new Float32Array(to - from)];
	};
	assert.equal(await tryPrepareCoalescedEffectContext(target, 128, 0, 500, 527, render), null);
	assert.equal(calls, 0);
	const result = await tryPrepareCoalescedEffectContext(target, 128, 0, 500, 528, render);
	assert.ok(result);
	assert.equal(calls, 1);
	assert.equal(result.context.afterChannels, undefined);
	assert.equal(await tryPrepareCoalescedEffectContext(target, 128, 0, 500, 1_000, async () => null), null);
});
