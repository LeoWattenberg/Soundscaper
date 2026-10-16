/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FilterCurveEqEditor from '../src/common/editor/ui/inspector/FilterCurveEqEditor.tsx';
import type { FilterCurvePoint } from '../src/common/editor/audacity-effects/filter-curve.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('EQ points leave modified commands available and retain plain and Shift point editing', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: Array<readonly FilterCurvePoint[]> = [];
	try {
		await act(async () => root.render(<FilterCurveEqEditor name="points" label="Curve points" value={[{ frequency: 100, gain: 0 }]}
			sampleRate={48_000} linearFrequencyScale={false} filterLength={8} disabled={false} copy={{}}
			onCommit={points => commits.push(points)} />));
		const point = dom.one('.audio-editor-filter-curve__point');
		for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace']) {
			for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
				let prevented = false;
				let stopped = false;
				await act(async () => reactProps(point).onKeyDown?.({ key, currentTarget: point, [modifier]: true,
					preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
				assert.equal(prevented, false, `${key} with ${modifier} remains available`);
				assert.equal(stopped, false);
			}
		}
		assert.equal(commits.length, 0);
		for (const [key, shiftKey] of [['ArrowUp', false], ['ArrowDown', true], ['Delete', false]] as const) {
			let prevented = false;
			await act(async () => reactProps(point).onKeyDown?.({ key, shiftKey, currentTarget: point,
				preventDefault() { prevented = true; }, stopPropagation() {} }));
			assert.equal(prevented, true);
		}
		assert.deepEqual(commits, [[{ frequency: 100, gain: 0.1 }], [{ frequency: 100, gain: -1 }], []]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
