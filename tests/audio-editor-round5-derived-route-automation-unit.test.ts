/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { copyDerivedTrackRouteAutomation } from '../src/common/editor/derived-track-route-automation.ts';

function ids() {
	let next = 0;
	return (prefix: string) => `${prefix}-${++next}`;
}

const lane = normalizeAutomationLaneV21({ id: 'route-ride',
	address: { kind: 'edge', edgeId: 'source-route', parameterId: 'level' }, timebase: 'musical-beats',
	points: [{ id: 'start', position: { num: 1, den: 3 }, value: 0.75 },
		{ id: 'end', position: { num: 7, den: 3 }, value: 0.5 }],
	segments: [{ kind: 'bezier', control1: { position: { num: 2, den: 3 }, value: 0.25 },
		control2: { position: { num: 5, den: 3 }, value: 0.8 } }],
});

test('derived routing keeps exact musical positions and interpolation with independent identities', () => {
	const [command] = copyDerivedTrackRouteAutomation({ automationLanes: [lane] }, { automationLanes: [lane] },
		[{ sourceEdgeId: 'source-route', targetEdgeId: 'copied-route' }], ids());
	assert.ok(command?.type === 'automation-lane/set');
	const copied = normalizeAutomationLaneV21(command.lane);
	assert.deepEqual(copied.address, { kind: 'edge', edgeId: 'copied-route', parameterId: 'level' });
	assert.notEqual(copied.id, lane.id);
	assert.ok(copied.points.every((point, index) => point.id !== lane.points[index]?.id));
	assert.equal(copied.timebase, lane.timebase);
	assert.deepEqual(copied.points.map(({ position, value }) => ({ position, value })),
		lane.points.map(({ position, value }) => ({ position, value })));
	assert.deepEqual(copied.segments, lane.segments);
});

test('a removed and restored edge recovers its lane identities; existing staged curves remain authoritative', () => {
	const copies = [{ sourceEdgeId: 'source-route', targetEdgeId: 'source-route' }];
	const [command] = copyDerivedTrackRouteAutomation({ automationLanes: [lane] }, { automationLanes: [] }, copies, ids());
	assert.ok(command?.type === 'automation-lane/set');
	assert.deepEqual(command.lane, lane);
	const edited = normalizeAutomationLaneV21({ ...lane,
		points: lane.points.map(point => ({ ...point, value: 0.25 })) });
	assert.deepEqual(copyDerivedTrackRouteAutomation({ automationLanes: [lane] },
		{ automationLanes: [edited] }, copies, ids()), []);
	assert.deepEqual(copyDerivedTrackRouteAutomation({ automationLanes: [lane] }, { automationLanes: [] },
		[{ sourceEdgeId: 'unrelated-route', targetEdgeId: 'copied-route' }], ids()), []);
});
