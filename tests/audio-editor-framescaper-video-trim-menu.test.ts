/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperVideoTrimMenuItems,
	createFramescaperVideoTrimMenuModel,
	type FramescaperVideoTrimMenuPlanner,
} from '../src/common/editor/ui/framescaper-video-trim-menu-model.ts';

const COPY = Object.freeze({
	trimLeftToPlayhead: 'Trim left edge to playhead',
	trimRightToPlayhead: 'Trim right edge to playhead',
});

const PLAYHEAD_SAMPLE = 38_400;

test('Framescaper derives both enabled edge items from changed planner results', () => {
	const requests: unknown[] = [];
	const planner: FramescaperVideoTrimMenuPlanner = (request) => {
		requests.push(request);
		return changedPlan(request.edge);
	};
	const model = createFramescaperVideoTrimMenuModel(input(), { planTrim: planner });

	assert.deepEqual(model, {
		left: {
			id: 'trim-left-edge-to-playhead',
			label: 'Trim left edge to playhead',
			disabled: false,
			request: {
				activeClipId: 'video-clip',
				edge: 'left',
				requestedBoundarySample: PLAYHEAD_SAMPLE,
			},
		},
		right: {
			id: 'trim-right-edge-to-playhead',
			label: 'Trim right edge to playhead',
			disabled: false,
			request: {
				activeClipId: 'video-clip',
				edge: 'right',
				requestedBoundarySample: PLAYHEAD_SAMPLE,
			},
		},
	});
	assert.deepEqual(requests, [
		{
			activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: PLAYHEAD_SAMPLE,
		},
		{
			activeClipId: 'video-clip', edge: 'right', requestedBoundarySample: PLAYHEAD_SAMPLE,
		},
	]);
});

test('writability, selection, and playhead gates keep the menu inert without planning', () => {
	for (const [name, overrides] of [
		['blocked', { editingBlocked: true }],
		['missing selection', { selectedClipId: null }],
		['empty selection', { selectedClipId: '' }],
		['missing playhead', { playheadSample: null }],
		['negative playhead', { playheadSample: -1 }],
		['fractional playhead', { playheadSample: 1.5 }],
		['unsafe playhead', { playheadSample: Number.MAX_SAFE_INTEGER + 1 }],
	] as const) {
		let calls = 0;
		const model = createFramescaperVideoTrimMenuModel(input(overrides), {
			planTrim: () => {
				calls += 1;
				return changedPlan('left');
			},
		});
		assert.equal(model.left?.disabled, true, name);
		assert.equal(model.left?.request, null, name);
		assert.equal(model.right?.disabled, true, name);
		assert.equal(model.right?.request, null, name);
		assert.equal(calls, 0, name);
	}
});

test('no-op and refusal disable only the affected edge and never duplicate planner rules', () => {
	const plannedEdges: string[] = [];
	const noopRight = createFramescaperVideoTrimMenuModel(input(), {
		planTrim: (request) => {
			plannedEdges.push(request.edge);
			return request.edge === 'left' ? changedPlan('left') : noopPlan('right');
		},
	});
	assert.equal(noopRight.left?.disabled, false);
	assert.deepEqual(noopRight.left?.request, {
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: PLAYHEAD_SAMPLE,
	});
	assert.equal(noopRight.right?.disabled, true);
	assert.equal(noopRight.right?.request, null);
	assert.deepEqual(plannedEdges, ['left', 'right']);

	const refusedLeft = createFramescaperVideoTrimMenuModel(input(), {
		planTrim: (request) => {
			if (request.edge === 'left') throw new RangeError('composition refuses the trim');
			return changedPlan('right');
		},
	});
	assert.equal(refusedLeft.left?.disabled, true);
	assert.equal(refusedLeft.left?.request, null);
	assert.equal(refusedLeft.right?.disabled, false);
	assert.deepEqual(refusedLeft.right?.request, {
		activeClipId: 'video-clip', edge: 'right', requestedBoundarySample: PLAYHEAD_SAMPLE,
	});
});

test('menu items are frozen and dispatch the exact request that was presented', () => {
	const calls: unknown[] = [];
	const actions = {
		commitTrim: (request: unknown) => {
			calls.push(request);
			return `trim-${String((request as { edge?: unknown }).edge)}`;
		},
	};
	const model = createFramescaperVideoTrimMenuModel(input(), {
		planTrim: (request) => changedPlan(request.edge),
	});
	const items = createFramescaperVideoTrimMenuItems(
		model,
		actions,
	);

	assert.equal(items.left?.onClick(), 'trim-left');
	assert.equal(items.right?.onClick(), 'trim-right');
	assert.deepEqual(calls, [{
		activeClipId: 'video-clip', edge: 'left', requestedBoundarySample: PLAYHEAD_SAMPLE,
	}, {
		activeClipId: 'video-clip', edge: 'right', requestedBoundarySample: PLAYHEAD_SAMPLE,
	}]);
	assert.notEqual(calls[0], calls[1]);
	assert.ok(Object.isFrozen(items));
	assert.ok(Object.isFrozen(items.left));
	assert.ok(Object.isFrozen(items.right));
});

test('disabled no-op and refusal items do not dispatch', () => {
	const calls: unknown[] = [];
	const model = createFramescaperVideoTrimMenuModel(input(), {
		planTrim: (request) => {
			if (request.edge === 'left') return noopPlan('left');
			throw new RangeError('source handles exhausted');
		},
	});
	const items = createFramescaperVideoTrimMenuItems(model, {
		commitTrim: (request: unknown) => calls.push(request),
	});

	assert.equal(items.left?.disabled, true);
	assert.equal(items.right?.disabled, true);
	assert.equal(items.left?.onClick(), undefined);
	assert.equal(items.right?.onClick(), undefined);
	assert.deepEqual(calls, []);
});

test('Soundscaper receives no trim menu model or bound items and never invokes the planner', () => {
	let plannerCalls = 0;
	const planner: FramescaperVideoTrimMenuPlanner = () => {
		plannerCalls += 1;
		return changedPlan('left');
	};
	const model = createFramescaperVideoTrimMenuModel(
		input({ productId: 'soundscaper' }),
		{ planTrim: planner },
	);
	const items = createFramescaperVideoTrimMenuItems(
		model,
		{ commitTrim: () => assert.fail('Soundscaper trim item dispatched') },
	);

	assert.deepEqual(model, { left: null, right: null });
	assert.deepEqual(items, { left: null, right: null });
	assert.equal(plannerCalls, 0);
	assert.ok(Object.isFrozen(model));
	assert.ok(Object.isFrozen(items));
});

test('models and nested requests are frozen without mutating menu input', () => {
	const value = input();
	const before = structuredClone(value);
	const model = createFramescaperVideoTrimMenuModel(
		value,
		{ planTrim: (request) => changedPlan(request.edge) },
	);

	assert.deepEqual(value, before);
	assert.ok(Object.isFrozen(model));
	assert.ok(Object.isFrozen(model.left));
	assert.ok(Object.isFrozen(model.left?.request));
	assert.ok(Object.isFrozen(model.right));
	assert.ok(Object.isFrozen(model.right?.request));
});

function input(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		productId: 'framescaper',
		selectedClipId: 'video-clip',
		playheadSample: PLAYHEAD_SAMPLE,
		editingBlocked: false,
		copy: COPY,
		...overrides,
	};
}

function changedPlan(edge: 'left' | 'right') {
	return Object.freeze({
		kind: 'transform' as const,
		edge,
		transforms: Object.freeze([Object.freeze({ clipId: 'video-clip' })]),
	});
}

function noopPlan(edge: 'left' | 'right') {
	return Object.freeze({
		kind: 'noop' as const,
		edge,
		transforms: Object.freeze([]),
	});
}
