/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import GraphicEqEditor from '../src/common/editor/ui/inspector/GraphicEqEditor.tsx';
import FilterCurveEqEditor from '../src/common/editor/ui/inspector/FilterCurveEqEditor.tsx';
import type { FilterCurvePoint } from '../src/common/editor/audacity-effects/filter-curve.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

type Kind = 'graphic' | 'curve';
type Commits = Array<readonly number[] | readonly FilterCurvePoint[]>;

for (const kind of ['graphic', 'curve'] as const) {
	test(`${kind} publishes its final primary position before owning capture loss and ignores late auxiliary movement`, async () => {
		await mounted(kind, async (target, commits, invoke) => {
			await invoke(down(kind));
			await invoke(move(kind), position(kind, 5));
			await invoke(move(kind), { ...position(kind, 15), buttons: 4 });
			assertGain(commits, kind, 15);
			await invoke('onLostPointerCapture');
			await invoke(move(kind), { ...position(kind, -15), buttons: 4 });
			await invoke(up(kind), { ...position(kind, -15), buttons: 0, button: 1 });
			assertGain(commits, kind, 15);
			await invoke(down(kind));
			await invoke(up(kind), { ...position(kind, 10), buttons: 0 });
			assert.equal(commits.length, 2, 'the next ordinary primary gesture is independently accepted');
			assert.equal(target.ownerDocument.activeElement, target);
		});
	});
	test(`${kind} preserves held primary plus middle until ordinary completion`, async () => {
		await mounted(kind, async (_target, commits, invoke) => {
			await invoke(down(kind));
			await invoke(move(kind), { ...position(kind, 15), buttons: 5 });
			assert.equal(commits.length, 0);
			await invoke(up(kind), { ...position(kind, 10), buttons: 0 });
			assertGain(commits, kind, 10);
		});
	});
	test(`${kind} ignores foreign released mouse and retains its native touch completion`, async () => {
		await mounted(kind, async (_target, commits, invoke) => {
			await invoke(down(kind), { pointerType: 'touch' });
			await invoke(move(kind), { ...position(kind, -15), pointerId: 2, buttons: 4 });
			await invoke(move(kind), { ...position(kind, 15), pointerType: 'touch', buttons: 0 });
			assert.equal(commits.length, 0);
			await invoke(up(kind), { ...position(kind, 10), pointerType: 'touch', buttons: 0 });
			assertGain(commits, kind, 10);
		});
	});
	test(`${kind} still cancels an unfinished owning gesture before primary completion`, async () => {
		await mounted(kind, async (_target, commits, invoke) => {
			await invoke(down(kind));
			await invoke(move(kind), position(kind, 15));
			await invoke('onLostPointerCapture');
			await invoke(up(kind), { ...position(kind, 10), buttons: 0 });
			assert.equal(commits.length, 0);
		});
	});
}

test('graphic routed band completes one automation gesture at primary release', async () => {
	const routed: number[] = [];
	await mounted('graphic', async (_target, commits, invoke) => {
		await invoke(down('graphic'));
		await invoke(move('graphic'), position('graphic', 5));
		await invoke(move('graphic'), { ...position('graphic', 15), buttons: 4 });
		assert.deepEqual(routed, [15]);
		await invoke('onLostPointerCapture');
		await invoke(up('graphic'), { ...position('graphic', -15), buttons: 0, button: 1 });
		assert.deepEqual(routed, [15]);
		assert.equal(commits.length, 0, 'routed authoring does not also publish a static fallback');
	}, routed);
});

const down = (kind: Kind): string => kind === 'graphic' ? 'onPointerDownCapture' : 'onPointerDown';
const move = (kind: Kind): string => kind === 'graphic' ? 'onPointerMoveCapture' : 'onPointerMove';
const up = (kind: Kind): string => kind === 'graphic' ? 'onPointerUpCapture' : 'onPointerUp';
function position(kind: Kind, gain: number): object {
	return kind === 'graphic' ? { clientX: 8, clientY: (20 - gain) / 40 * 100 }
		: { clientX: 340, clientY: 16 + (30 - gain) / 60 * 244 };
}
function assertGain(commits: Commits, kind: Kind, expected: number): void {
	assert.equal(commits.length, 1, 'the final owning primary value is published exactly once');
	if (kind === 'graphic') assert.deepEqual(commits[0], [expected, 0]);
	else {
		const point = commits[0]?.[0];
		assert.ok(typeof point === 'object' && point !== null);
		assert.equal(commits[0]?.length, 1);
		assert.ok(Math.abs(point.gain - expected) < 1e-10);
	}
}

async function mounted(kind: Kind, run: (target: ReactTestElement, commits: Commits,
	invoke: (name: string, changes?: object) => Promise<void>) => Promise<void>, routed?: number[]): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: Commits = [];
	try {
		await act(async () => root.render(kind === 'graphic'
			? <GraphicEqEditor name="gains" label="Bands" descriptor={{ frequencies: [20, 1000],
				default: [0, 0], minimum: -20, maximum: 20, step: .1 }} disabled={false} copy={{}}
				gestureFor={() => routed ? { onGestureBegin() {}, onGesturePreview() {},
					onGestureCommit: value => { routed.push(value); } } : {}}
				onCommit={gains => commits.push(gains)} />
			: <FilterCurveEqEditor name="points" label="Curve points" sampleRate={48_000}
				linearFrequencyScale={false} filterLength={8} disabled={false} copy={{}}
				onCommit={points => commits.push(points)} />));
		const target = dom.one(kind === 'graphic' ? '.audio-editor-graphic-eq__board' : 'svg');
		Object.assign(target, { setPointerCapture() {}, hasPointerCapture: () => false,
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 300 }) });
		if (kind === 'graphic') dom.container.querySelectorAll('[role="slider"]').forEach((slider, index) => {
			Object.assign(slider, { getBoundingClientRect: () => ({ left: index * 32,
				right: index * 32 + 16, top: 0, bottom: 100 }) });
		});
		const input = { currentTarget: target, target, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
			...position(kind, 0), preventDefault() {}, stopPropagation() {} };
		await run(target, commits, async (name, changes = {}) => {
			await act(async () => { (reactProps(target)[name] as (event: object) => void)({ ...input, ...changes }); });
		});
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}
