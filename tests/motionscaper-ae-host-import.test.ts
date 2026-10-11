/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { importMotionAeHostPlan, type MotionAeImportHost } from '../src/common/editor/motion-ae-host-import.ts';
import type { MotionAeImportPlan } from '../src/common/editor/motion-ae-host-import-plan.ts';
const plan: MotionAeImportPlan = { transferId: 'transfer', muteAudio: false, footage: [], warnings: [], color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 }, compositions: [{ id: 'comp', name: 'Comp', width: 64, height: 64,
	pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0], layers: ['top', 'bottom'].map((id) => ({ id, name: id, kind: 'null', sourceId: null,
		parentId: id === 'top' ? 'bottom' : null, startTime: 0, inPoint: 0, outPoint: 1, stretch: 100, enabled: true, threeD: false, properties: [], text: null, shapes: null, masks: [], matte: null })) }] };
test('AE import verifies media before mutation, creates layers in reverse order and binds parents after creation', () => {
	const calls: string[] = [];
	const host: MotionAeImportHost = { checkCancelled: () => {}, verifyMedia: () => { calls.push('verify'); }, begin: () => { calls.push('begin'); return {
		footage: () => {}, composition: (comp) => { calls.push(comp.id); }, layer: (_comp, layer) => { calls.push(layer.id); },
		parent: (layer) => { calls.push('parent:' + layer.id); }, properties: () => {}, finish: () => { calls.push('finish'); }, rollback: () => { calls.push('rollback'); },
	}; } };
	importMotionAeHostPlan(plan, host); assert.deepEqual(calls, ['verify', 'begin', 'comp', 'bottom', 'top', 'parent:top', 'finish']);
});
test('AE import rolls back only created objects and keeps cleanup failure with the primary failure', () => {
	let removed = 0;
	const host: MotionAeImportHost = { checkCancelled: () => {}, verifyMedia: () => {}, begin: () => ({ footage: () => {}, composition: () => { throw new Error('creation failed'); },
		layer: () => {}, parent: () => {}, properties: () => {}, finish: () => {}, rollback: () => { removed++; throw new Error('removal failed'); },
	}) };
	assert.throws(() => importMotionAeHostPlan(plan, host), /creation failed.*removal failed/u); assert.equal(removed, 1);
});
