/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FrameCanonicalSlipSlideRequest,
} from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import type {
	FrameCanonicalSlipSlideStep,
} from '../src/common/editor/frame-canonical-slip-slide-step-request.ts';
import {
	createFramescaperSlipSlideMenuItems,
	createFramescaperSlipSlideMenuModel,
	type FramescaperSlipSlideMenuPlanner,
} from '../src/common/editor/ui/framescaper-slip-slide-menu-model.ts';

const COPY = Object.freeze({
	slipSourceEarlierOneFrame: 'Slip source earlier one frame',
	slipSourceLaterOneFrame: 'Slip source later one frame',
	slideClipEarlierOneFrame: 'Slide clip earlier one frame',
	slideClipLaterOneFrame: 'Slide clip later one frame',
});
const IDS = Object.freeze([
	'slip-source-earlier-one-frame',
	'slip-source-later-one-frame',
	'slide-clip-earlier-one-frame',
	'slide-clip-later-one-frame',
]);

test('Framescaper exposes four frozen lazy leaves without consulting edit geometry', () => {
	let builderCalls = 0;
	let plannerCalls = 0;
	const model = createFramescaperSlipSlideMenuModel(input(), {
		buildStepRequest: () => {
			builderCalls += 1;
			return assert.fail('closed menu built a request');
		},
		planSlipSlide: () => {
			plannerCalls += 1;
			return assert.fail('closed menu planned geometry');
		},
	});
	const items = createFramescaperSlipSlideMenuItems(model, {
		commitSlipSlide: () => assert.fail('closed menu committed'),
	});

	assert.deepEqual(items.map(({ id, label, disabled, resolve }) => ({
		id, label, disabled, lazy: typeof resolve === 'function',
	})), [
		{ id: IDS[0], label: COPY.slipSourceEarlierOneFrame, disabled: false, lazy: true },
		{ id: IDS[1], label: COPY.slipSourceLaterOneFrame, disabled: false, lazy: true },
		{ id: IDS[2], label: COPY.slideClipEarlierOneFrame, disabled: false, lazy: true },
		{ id: IDS[3], label: COPY.slideClipLaterOneFrame, disabled: false, lazy: true },
	]);
	assert.equal(builderCalls, 0);
	assert.equal(plannerCalls, 0);
	assert.ok(Object.isFrozen(model));
	assert.ok(Object.isFrozen(items));
	for (const item of items) assert.ok(Object.isFrozen(item));
});

test('each resolve binds one absolute builder request and activation dispatches that identity', () => {
	const built: Readonly<FrameCanonicalSlipSlideRequest>[] = [];
	const planned: Readonly<FrameCanonicalSlipSlideRequest>[] = [];
	const committed: Readonly<FrameCanonicalSlipSlideRequest>[] = [];
	const steps: FrameCanonicalSlipSlideStep[] = [];
	const model = createFramescaperSlipSlideMenuModel(input(), {
		buildStepRequest: (step) => {
			steps.push(step);
			const request = step.mode === 'slip'
				? Object.freeze({
					mode: 'slip' as const, activeClipId: step.activeClipId,
					requestedSourceInFrame: step.direction === 'earlier' ? 19 : 21,
				})
				: Object.freeze({
					mode: 'slide' as const, activeClipId: step.activeClipId,
					requestedStartSample: step.direction === 'earlier' ? 1_600 : 4_805,
				});
			built.push(request);
			return request;
		},
		planSlipSlide: (request) => {
			planned.push(request);
			return Object.freeze({ kind: 'transform' });
		},
	});
	const items = createFramescaperSlipSlideMenuItems(model, {
		commitSlipSlide: (request) => {
			committed.push(request);
			return request.mode === 'slip' ? request.requestedSourceInFrame : request.requestedStartSample;
		},
	});

	assert.deepEqual(items.map(({ resolve }) => resolve()), [
		{ disabled: false }, { disabled: false }, { disabled: false }, { disabled: false },
	]);
	assert.deepEqual(steps, [
		{ mode: 'slip', activeClipId: 'video-clip', direction: 'earlier' },
		{ mode: 'slip', activeClipId: 'video-clip', direction: 'later' },
		{ mode: 'slide', activeClipId: 'video-clip', direction: 'earlier' },
		{ mode: 'slide', activeClipId: 'video-clip', direction: 'later' },
	]);
	assert.deepEqual(items.map(({ onClick }) => onClick()), [19, 21, 1_600, 4_805]);
	assert.deepEqual(planned, built);
	assert.deepEqual(committed, built);
	for (let index = 0; index < built.length; index += 1) {
		assert.equal(planned[index], built[index]);
		assert.equal(committed[index], built[index]);
	}
});

test('no-op, request refusal, and plan refusal disable only their own lazy item', () => {
	const builderSteps: string[] = [];
	const plannerSteps: string[] = [];
	const planner: FramescaperSlipSlideMenuPlanner = (request) => {
		const key = request.mode === 'slip'
			? `slip:${String(request.requestedSourceInFrame)}`
			: `slide:${String(request.requestedStartSample)}`;
		plannerSteps.push(key);
		if (key === 'slip:2') return Object.freeze({ kind: 'noop' });
		if (key === 'slide:3') throw new RangeError('no touching triplet');
		return Object.freeze({ kind: 'transform' });
	};
	const model = createFramescaperSlipSlideMenuModel(input(), {
		buildStepRequest: (step) => {
			const key = `${step.mode}:${step.direction}`;
			builderSteps.push(key);
			if (key === 'slide:later') throw new RangeError('unsafe step target');
			return step.mode === 'slip'
				? Object.freeze({
					mode: 'slip', activeClipId: step.activeClipId,
					requestedSourceInFrame: step.direction === 'earlier' ? 1 : 2,
				})
				: Object.freeze({
					mode: 'slide', activeClipId: step.activeClipId, requestedStartSample: 3,
				});
		},
		planSlipSlide: planner,
	});
	const commits: unknown[] = [];
	const items = createFramescaperSlipSlideMenuItems(model, {
		commitSlipSlide: (request) => commits.push(request),
	});

	assert.deepEqual(items.map(({ resolve }) => resolve()), [
		{ disabled: false }, { disabled: true }, { disabled: true }, { disabled: true },
	]);
	assert.equal(items[0]?.onClick(), 1);
	assert.equal(items[1]?.onClick(), undefined);
	assert.equal(items[2]?.onClick(), undefined);
	assert.equal(items[3]?.onClick(), undefined);
	assert.equal(commits.length, 1);
	assert.deepEqual(builderSteps, [
		'slip:earlier', 'slip:later', 'slide:earlier', 'slide:later',
	]);
	assert.deepEqual(plannerSteps, ['slip:1', 'slip:2', 'slide:3']);
});

test('invalid Framescaper context stays inert and Soundscaper has no leaves', () => {
	for (const [name, overrides] of [
		['blocked', { editingBlocked: true }],
		['missing selection', { selectedClipId: null }],
		['empty selection', { selectedClipId: '' }],
	] as const) {
		let calls = 0;
		const model = createFramescaperSlipSlideMenuModel(input(overrides), {
			buildStepRequest: () => { calls += 1; return slipRequest(); },
			planSlipSlide: () => { calls += 1; return Object.freeze({ kind: 'transform' }); },
		});
		const items = createFramescaperSlipSlideMenuItems(model, {
			commitSlipSlide: () => assert.fail(`${name} dispatched`),
		});
		assert.equal(items.length, 4, name);
		assert.ok(items.every(({ disabled }) => disabled), name);
		assert.deepEqual(items.map(({ resolve }) => resolve()), [
			{ disabled: true }, { disabled: true }, { disabled: true }, { disabled: true },
		], name);
		assert.ok(items.every(({ onClick }) => onClick() === undefined), name);
		assert.equal(calls, 0, name);
	}

	let calls = 0;
	const model = createFramescaperSlipSlideMenuModel(input({ productId: 'soundscaper' }), {
		buildStepRequest: () => { calls += 1; return slipRequest(); },
		planSlipSlide: () => { calls += 1; return Object.freeze({ kind: 'transform' }); },
	});
	const items = createFramescaperSlipSlideMenuItems(model, {
		commitSlipSlide: () => assert.fail('Soundscaper dispatched'),
	});
	assert.deepEqual(model, {
		slipEarlier: null, slipLater: null, slideEarlier: null, slideLater: null,
	});
	assert.deepEqual(items, []);
	assert.equal(calls, 0);
});

test('a later failed resolution clears an item previous stored request', () => {
	let transform = true;
	let commits = 0;
	const model = createFramescaperSlipSlideMenuModel(input(), {
		buildStepRequest: () => slipRequest(),
		planSlipSlide: () => Object.freeze({ kind: transform ? 'transform' as const : 'noop' as const }),
	});
	const items = createFramescaperSlipSlideMenuItems(model, {
		commitSlipSlide: () => { commits += 1; },
	});
	const first = items[0];
	assert.ok(first);
	assert.deepEqual(first.resolve(), { disabled: false });
	first.onClick();
	transform = false;
	assert.deepEqual(first.resolve(), { disabled: true });
	assert.equal(first.onClick(), undefined);
	assert.equal(commits, 1);
});

function input(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		productId: 'framescaper', selectedClipId: 'video-clip', editingBlocked: false,
		copy: COPY, ...overrides,
	};
}

function slipRequest(): Readonly<FrameCanonicalSlipSlideRequest> {
	return Object.freeze({
		mode: 'slip', activeClipId: 'video-clip', requestedSourceInFrame: 1,
	});
}
