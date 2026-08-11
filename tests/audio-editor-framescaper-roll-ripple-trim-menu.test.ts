/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperRollRippleTrimMenuItems,
	createFramescaperRollRippleTrimMenuModel,
	type FramescaperRollRippleTrimMenuPlanner,
} from '../src/common/editor/ui/framescaper-roll-ripple-trim-menu-model.ts';

const PLAYHEAD_SAMPLE = 38_400;
const COPY = Object.freeze({
	rollLeftToPlayhead: 'Roll left edge to playhead',
	rollRightToPlayhead: 'Roll right edge to playhead',
	rippleLeftToPlayhead: 'Ripple left edge to playhead',
	rippleRightToPlayhead: 'Ripple right edge to playhead',
});

test('Framescaper exposes four planner-enabled roll and ripple requests', () => {
	const requests: unknown[] = [];
	const planner: FramescaperRollRippleTrimMenuPlanner = (request) => {
		requests.push(request);
		return Object.freeze({ kind: 'transform' });
	};
	const model = createFramescaperRollRippleTrimMenuModel(input(), { planTrim: planner });

	assert.deepEqual(model, {
		rollLeft: itemModel('roll-left-edge-to-playhead', COPY.rollLeftToPlayhead, 'roll', 'left'),
		rollRight: itemModel('roll-right-edge-to-playhead', COPY.rollRightToPlayhead, 'roll', 'right'),
		rippleLeft: itemModel('ripple-left-edge-to-playhead', COPY.rippleLeftToPlayhead, 'ripple', 'left'),
		rippleRight: itemModel('ripple-right-edge-to-playhead', COPY.rippleRightToPlayhead, 'ripple', 'right'),
	});
	assert.deepEqual(requests, [
		request('roll', 'left'),
		request('roll', 'right'),
		request('ripple', 'left'),
		request('ripple', 'right'),
	]);
});

test('each live planner result solely owns that action disabled state', () => {
	const calls: string[] = [];
	const model = createFramescaperRollRippleTrimMenuModel(input(), {
		planTrim: (value) => {
			calls.push(`${value.mode}:${value.edge}`);
			if (value.mode === 'roll' && value.edge === 'right') return Object.freeze({ kind: 'noop' });
			if (value.mode === 'ripple' && value.edge === 'left') throw new RangeError('locked suffix');
			return Object.freeze({ kind: 'transform' });
		},
	});

	assert.equal(model.rollLeft?.disabled, false);
	assert.deepEqual(model.rollLeft?.request, request('roll', 'left'));
	assert.equal(model.rollRight?.disabled, true);
	assert.equal(model.rollRight?.request, null);
	assert.equal(model.rippleLeft?.disabled, true);
	assert.equal(model.rippleLeft?.request, null);
	assert.equal(model.rippleRight?.disabled, false);
	assert.deepEqual(model.rippleRight?.request, request('ripple', 'right'));
	assert.deepEqual(calls, ['roll:left', 'roll:right', 'ripple:left', 'ripple:right']);
});

test('frozen items dispatch the exact immutable request stored by their menu render', () => {
	const model = createFramescaperRollRippleTrimMenuModel(input(), {
		planTrim: () => Object.freeze({ kind: 'transform' }),
	});
	const stored = [
		model.rollLeft?.request,
		model.rollRight?.request,
		model.rippleLeft?.request,
		model.rippleRight?.request,
	];
	const committed: unknown[] = [];
	const items = createFramescaperRollRippleTrimMenuItems(model, {
		commitTrim: (value) => {
			committed.push(value);
			return `${value.mode}:${value.edge}`;
		},
	});

	assert.equal(items.rollLeft?.onClick(), 'roll:left');
	assert.equal(items.rollRight?.onClick(), 'roll:right');
	assert.equal(items.rippleLeft?.onClick(), 'ripple:left');
	assert.equal(items.rippleRight?.onClick(), 'ripple:right');
	assert.deepEqual(committed, stored);
	for (let index = 0; index < stored.length; index += 1) {
		assert.equal(committed[index], stored[index]);
		assert.ok(Object.isFrozen(stored[index]));
	}
	assert.ok(Object.isFrozen(model));
	assert.ok(Object.isFrozen(items));
	assert.ok(Object.isFrozen(items.rollLeft));
	assert.ok(Object.isFrozen(items.rollRight));
	assert.ok(Object.isFrozen(items.rippleLeft));
	assert.ok(Object.isFrozen(items.rippleRight));
});

test('invalid menu context stays inert without consulting geometry', () => {
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
		const model = createFramescaperRollRippleTrimMenuModel(input(overrides), {
			planTrim: () => { calls += 1; return Object.freeze({ kind: 'transform' }); },
		});
		for (const item of Object.values(model)) {
			assert.equal(item?.disabled, true, name);
			assert.equal(item?.request, null, name);
		}
		assert.equal(calls, 0, name);
	}
});

test('disabled items do not dispatch and Soundscaper has no surface or planner call', () => {
	const dispatches: unknown[] = [];
	const disabledModel = createFramescaperRollRippleTrimMenuModel(input(), {
		planTrim: () => Object.freeze({ kind: 'noop' }),
	});
	const disabledItems = createFramescaperRollRippleTrimMenuItems(disabledModel, {
		commitTrim: (value) => dispatches.push(value),
	});
	for (const item of Object.values(disabledItems)) {
		assert.equal(item?.onClick(), undefined);
	}
	assert.deepEqual(dispatches, []);

	let plannerCalls = 0;
	const soundscaperModel = createFramescaperRollRippleTrimMenuModel(
		input({ productId: 'soundscaper' }),
		{ planTrim: () => { plannerCalls += 1; return Object.freeze({ kind: 'transform' }); } },
	);
	const soundscaperItems = createFramescaperRollRippleTrimMenuItems(soundscaperModel, {
		commitTrim: () => assert.fail('Soundscaper dispatched roll/ripple trim.'),
	});
	assert.deepEqual(soundscaperModel, nullModel());
	assert.deepEqual(soundscaperItems, nullModel());
	assert.equal(plannerCalls, 0);
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

function request(mode: 'roll' | 'ripple', edge: 'left' | 'right') {
	return {
		mode,
		activeClipId: 'video-clip',
		edge,
		requestedBoundarySample: PLAYHEAD_SAMPLE,
	};
}

function itemModel(
	id: string,
	label: string,
	mode: 'roll' | 'ripple',
	edge: 'left' | 'right',
) {
	return { id, label, disabled: false, request: request(mode, edge) };
}

function nullModel() {
	return { rollLeft: null, rollRight: null, rippleLeft: null, rippleRight: null };
}
