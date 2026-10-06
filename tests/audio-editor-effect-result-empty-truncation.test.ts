/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness, requireBatch, target } from './helpers/effect-result-service-fixture.ts';
import { prepareExactClipEffectResultCommands } from '../src/common/editor/controller/effects/internal/effect-result-clip-commands.ts';

test('a zero-frame Truncate Silence result deletes the occupied selection without writing an empty source', async () => {
	const { events, service } = createHarness();
	await service.persistAudacityEffectResults([
		{ target: target('track'), channels: [new Float32Array(0)] },
	], 'audacity-truncate-silence');
	assert.equal(events.sourcesOpened.length, 0);
	assert.deepEqual(events.rangeDeletes, [{ trackIds: ['track'], startFrame: 10, endFrame: 14, rippleMode: 'track' }]);
	assert.deepEqual(requireBatch(events.commits[0]?.command).commands.map(command => command.type), [
		'range/ripple-delete', 'selection/set',
	]);
});

test('a macro result can retain the same valid zero-frame removal without an individual effect type', async () => {
	const { events, service } = createHarness();
	await service.persistAudacityEffectResults([
		{ target: target('track'), channels: [new Float32Array(0)] },
	], null);
	assert.equal(events.rangeDeletes.length, 1);
	assert.equal(events.sourcesOpened.length, 0);
});

test('mixed empty and nonempty related clips retain the existing duration-ratio refusal', () => {
	assert.throws(() => prepareExactClipEffectResultCommands({ clips: [
		{ id: 'silent', groupId: 'group' }, { id: 'audible', groupId: 'group' },
	], tracks: [] }, [
		{ target: { clipId: 'silent' }, frameCount: 0 },
		{ target: { clipId: 'audible' }, frameCount: 4 },
	], () => { throw new Error('Sources must not be planned after refusal.'); }), /inconsistent effect duration ratios/u);
});

test('a zero-frame exact clip result removes that clip and clears its selection', async () => {
	const { events, service } = createHarness();
	await service.persistAudacityEffectResults([
		{ target: target('track', { clipId: 'silent-clip' }), channels: [new Float32Array(0)] },
	], 'audacity-truncate-silence');
	const batch = requireBatch(events.commits[0]?.command);
	assert.deepEqual(batch.commands, [
		{ type: 'clip/remove-many', clipIds: ['silent-clip'], rippleMode: 'track' },
		{ type: 'selection/set', startFrame: 0, endFrame: 0, trackIds: ['track'], clipIds: [], frequencyRange: null },
	]);
	assert.equal(events.sourcesOpened.length, 0);
	assert.equal(events.rangeDeletes.length, 0);
});
