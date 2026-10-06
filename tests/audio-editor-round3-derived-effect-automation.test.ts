/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { copyDerivedTrackEffectAutomation } from '../src/common/editor/derived-track-effect-automation.ts';
import type { ParameterAddress } from '../src/common/editor/parameter-address.ts';

function lane(address: ParameterAddress, id = 'frequency') {
	return normalizeAutomationLaneV21({ id, address, timebase: 'absolute-samples',
		points: [{ id: `${id}-start`, position: 0, value: 1000 }, { id: `${id}-end`, position: 48000, value: 500 }],
		segments: [{ kind: 'linear' }],
	});
}
const frequency = lane({ kind: 'effect', strip: { kind: 'track', id: 'stereo' },
	effectId: 'filter', parameterId: 'frequency' });
function ids() {
	let next = 0;
	return (prefix: string) => `${prefix}-${++next}`;
}

test('restoring the left split processor restores its existing effect lane and point identities', () => {
	const [command] = copyDerivedTrackEffectAutomation({ automationLanes: [frequency] }, 'stereo', 'stereo',
		new Map([['filter', 'filter']]), ids());
	assert.equal(command?.type, 'automation-lane/set');
	if (command?.type !== 'automation-lane/set') throw new Error('Missing restored curve.');
	assert.equal(command.expected, null);
	assert.deepEqual(command.lane, frequency);
});

test('the right split processor gets independent lane identities and the copied effect address', () => {
	const [command] = copyDerivedTrackEffectAutomation({ automationLanes: [frequency] }, 'stereo', 'right',
		new Map([['filter', 'right-filter']]), ids());
	if (command?.type !== 'automation-lane/set') throw new Error('Missing copied curve.');
	const copied = normalizeAutomationLaneV21(command.lane);
	assert.deepEqual(copied.address, { kind: 'effect', strip: { kind: 'track', id: 'right' },
		effectId: 'right-filter', parameterId: 'frequency' });
	assert.notEqual(copied.id, frequency.id);
	assert.ok(copied.points.every((point, index) => point.id !== frequency.points[index]?.id));
	assert.deepEqual(copied.points.map(({ position, value }) => ({ position, value })),
		frequency.points.map(({ position, value }) => ({ position, value })));
	assert.deepEqual(copied.segments, frequency.segments);
	assert.equal(frequency.address.kind, 'effect');
	assert.equal(frequency.address.kind === 'effect' && frequency.address.effectId, 'filter');
});

test('only the copied source track effects are admitted; strip, routing and other tracks stay owned', () => {
	const project = { automationLanes: [frequency,
		lane({ kind: 'effect', strip: { kind: 'track', id: 'other' }, effectId: 'filter', parameterId: 'frequency' }, 'other'),
		lane({ kind: 'effect', strip: { kind: 'track', id: 'stereo' }, effectId: 'removed', parameterId: 'frequency' }, 'removed'),
		lane({ kind: 'strip', strip: { kind: 'track', id: 'stereo' }, parameterId: 'gain' }, 'volume'),
		lane({ kind: 'edge', edgeId: 'route', parameterId: 'level' }, 'route'),
	] };
	assert.equal(copyDerivedTrackEffectAutomation(project, 'stereo', 'right',
		new Map([['filter', 'right-filter']]), ids()).length, 1);
});

test('musical effect curves retain exact beat positions, interpolation and element identity', () => {
	const musical = normalizeAutomationLaneV21({ ...frequency, timebase: 'musical-beats',
		address: { kind: 'effect', strip: { kind: 'track', id: 'stereo' }, effectId: 'eq', elementId: 'band-1', parameterId: 'gain' },
		points: [{ id: 'start', position: { num: 1, den: 3 }, value: -3 },
			{ id: 'end', position: { num: 7, den: 3 }, value: 3 }],
	});
	const [command] = copyDerivedTrackEffectAutomation({ automationLanes: [musical] }, 'stereo', 'right',
		new Map([['eq', 'right-eq']]), ids());
	if (command?.type !== 'automation-lane/set') throw new Error('Missing copied musical curve.');
	const copied = normalizeAutomationLaneV21(command.lane);
	assert.equal(copied.timebase, 'musical-beats');
	assert.deepEqual(copied.points.map(point => point.position), musical.points.map(point => point.position));
	assert.equal(copied.address.kind === 'effect' && copied.address.elementId, 'band-1');
});
