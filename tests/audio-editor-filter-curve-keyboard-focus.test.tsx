/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import FilterCurveEqEditor from '../src/common/editor/ui/inspector/FilterCurveEqEditor.tsx';
import type { FilterCurvePoint } from '../src/common/editor/audacity-effects/filter-curve.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('deleting a focused curve point hands editing to a remaining point or the graph', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let points: readonly FilterCurvePoint[] = [{ frequency: 100, gain: 0 }, { frequency: 1_000, gain: 0 }];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = () => root.render(<FilterCurveEqEditor name="curve" label="Curve points" value={points}
		sampleRate={48_000} linearFrequencyScale={false} filterLength={8} copy={{ reset: 'Reset', invert: 'Invert' }} disabled={false}
		onCommit={(next) => { points = next; render(); }} />);
	try {
		await act(async () => render());
		const last = dom.container.querySelectorAll('.audio-editor-filter-curve__point').at(-1)!;
		last.focus();
		await act(async () => reactProps(last).onKeyDown({
			key: 'Delete', currentTarget: last, preventDefault() {}, stopPropagation() {},
		}));
		const remaining = dom.one('.audio-editor-filter-curve__point');
		assert.equal(globalThis.document.activeElement, remaining);
		await act(async () => reactProps(remaining).onKeyDown({
			key: 'ArrowUp', currentTarget: remaining, shiftKey: false, preventDefault() {}, stopPropagation() {},
		}));
		assert.ok(Math.abs(points[0]!.gain - 0.1) < 1e-10);
		await act(async () => reactProps(remaining).onKeyDown({
			key: 'Backspace', currentTarget: remaining, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(points.length, 0);
		assert.equal(globalThis.document.activeElement, dom.one('svg'));
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
