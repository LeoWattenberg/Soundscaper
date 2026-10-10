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
	for (const cancellation of ['onPointerCancel', 'onLostPointerCapture']) {
		test(`${kind} preserves the accepted pointer after a foreign ${cancellation}`, async () => {
			await mounted(kind, async (target, commits) => {
				await invoke(target, down(kind), event(target, kind));
				await invoke(target, down(kind), event(target, kind, { pointerId: 2 }));
				await invoke(target, cancellation, event(target, kind, { pointerId: 2 }));
				await invoke(target, up(kind), event(target, kind, finalPosition(kind)));
				assert.equal(commits.length, 1, 'the first pointer still commits exactly one edit');
				if (kind === 'graphic') assert.deepEqual(commits[0], [15, 0]);
				else {
					const point = commits[0]?.[0];
					assert.ok(typeof point === 'object' && point !== null);
					assert.equal(point.gain, 15);
					assert.equal(commits[0]?.length, 1);
				}
			});
		});
		test(`${kind} cancels its own pointer on ${cancellation}`, async () => {
			await mounted(kind, async (target, commits) => {
				await invoke(target, down(kind), event(target, kind));
				await invoke(target, cancellation, event(target, kind));
				await invoke(target, up(kind), event(target, kind, finalPosition(kind)));
				assert.equal(commits.length, 0, 'the cancelled first gesture cannot publish');
			});
		});
	}
}

const down = (kind: Kind): string => kind === 'graphic' ? 'onPointerDownCapture' : 'onPointerDown';
const up = (kind: Kind): string => kind === 'graphic' ? 'onPointerUpCapture' : 'onPointerUp';
const finalPosition = (kind: Kind): object => kind === 'graphic'
	? { clientX: 8, clientY: 12.5 } : { clientX: 340, clientY: 77 };
function event(target: ReactTestElement, kind: Kind, changes: object = {}): object {
	return { currentTarget: target, target, pointerId: 1, button: 0,
		clientX: kind === 'graphic' ? 8 : 283.2, clientY: kind === 'graphic' ? 25 : 138,
		preventDefault() {}, stopPropagation() {}, ...changes };
}
async function invoke(target: ReactTestElement, name: string, input: object): Promise<void> {
	await act(async () => { (reactProps(target)[name] as (input: object) => void)(input); });
}

async function mounted(kind: Kind, run: (target: ReactTestElement, commits: Commits) => Promise<void>): Promise<void> {
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
				gestureFor={() => ({})} onCommit={gains => commits.push(gains)} />
			: <FilterCurveEqEditor name="points" label="Curve points" sampleRate={48_000}
				linearFrequencyScale={false} filterLength={8} disabled={false} copy={{}}
				onCommit={points => commits.push(points)} />));
		const target = dom.one(kind === 'graphic' ? '.audio-editor-graphic-eq__board' : 'svg');
		Object.assign(target, { setPointerCapture() {}, hasPointerCapture: () => false,
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 300 }) });
		if (kind === 'graphic') {
			dom.container.querySelectorAll('[role="slider"]').forEach((slider, index) => {
				Object.assign(slider, { getBoundingClientRect: () => ({ left: index * 32,
					right: index * 32 + 16, top: 0, bottom: 100 }) });
			});
		}
		await run(target, commits);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}
