/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FilterCurveEqEditor from '../src/common/editor/ui/inspector/FilterCurveEqEditor.tsx';
import type { FilterCurvePoint } from '../src/common/editor/audacity-effects/filter-curve.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('curve inversion keeps unsupported gains unchanged and recovers at the exact supported boundary', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let points: readonly FilterCurvePoint[] = [{ frequency: 100, gain: -80 }, { frequency: 10_000, gain: 0 }];
	let commits = 0;
	const render = () => root.render(<FilterCurveEqEditor name="curve" label="Curve points" value={points}
		sampleRate={48_000} linearFrequencyScale={false} filterLength={8} copy={{ reset: 'Reset', invert: 'Invert' }} disabled={false}
		onCommit={(next) => { commits++; points = next; render(); }} />);
	const invert = () => dom.one('.audio-editor-filter-curve__actions').querySelectorAll('button').at(-1)!;
	try {
		await act(async () => render());
		assert.equal(reactProps(invert()).disabled, true);
		assert.equal(commits, 0);
		assert.deepEqual(points, [{ frequency: 100, gain: -80 }, { frequency: 10_000, gain: 0 }]);
		points = [{ frequency: 100, gain: -60 }, { frequency: 10_000, gain: 12 }];
		await act(async () => render());
		assert.equal(reactProps(invert()).disabled, false);
		await act(async () => reactProps(invert()).onClick({}));
		assert.deepEqual(points, [{ frequency: 100, gain: 60 }, { frequency: 10_000, gain: -12 }]);
		await act(async () => reactProps(invert()).onClick({}));
		assert.deepEqual(points, [{ frequency: 100, gain: -60 }, { frequency: 10_000, gain: 12 }]);
		assert.equal(commits, 2);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
