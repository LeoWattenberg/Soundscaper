/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FilterCurveEqEditor from '../src/common/editor/ui/inspector/FilterCurveEqEditor.tsx';
import type { FilterCurvePoint } from '../src/common/editor/audacity-effects/filter-curve.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const direction of ['ArrowRight', 'ArrowUp'] as const) {
	test(`EQ ${direction} edits the requested coordinate without snapping an offscreen gain`, async () => {
		let points: readonly FilterCurvePoint[] = [{ frequency: 100, gain: -80 }, { frequency: 1_000, gain: 0 }];
		await withCurve(points, next => { points = next; }, async dom => {
			const point = dom.one('.audio-editor-filter-curve__point');
			point.focus();
			await act(async () => { reactProps(point).onKeyDown?.(key(direction)); });
			if (direction === 'ArrowRight') {
				assert.equal(points[0]!.gain, -80);
				assert.ok(points[0]!.frequency > 100 && points[0]!.frequency < 1_000);
			} else {
				assert.equal(points[0]!.frequency, 100);
				assert.equal(points[0]!.gain, -79.9);
			}
			assert.deepEqual(points[1], { frequency: 1_000, gain: 0 });
		});
	});
}

test('EQ gain keyboard edits retain out-of-Nyquist frequencies and enforce authored gain bounds', async () => {
	let points: readonly FilterCurvePoint[] = [{ frequency: 24_000, gain: 60 }];
	await withCurve(points, next => { points = next; }, async dom => {
		const point = dom.one('.audio-editor-filter-curve__point');
		await act(async () => { reactProps(point).onKeyDown?.(key('ArrowUp')); });
		assert.deepEqual(points, [{ frequency: 24_000, gain: 60 }]);
		await act(async () => { reactProps(point).onKeyDown?.(key('ArrowDown', true)); });
		assert.deepEqual(points, [{ frequency: 24_000, gain: 59 }]);
	}, 8_000);
});

function key(key: string, shiftKey = false) {
	return { key, shiftKey, preventDefault() {}, stopPropagation() {} };
}

async function withCurve(points: readonly FilterCurvePoint[], commit: (points: readonly FilterCurvePoint[]) => void,
	check: (dom: ReturnType<typeof installReactTestDom>) => Promise<void>, sampleRate = 48_000): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => { root.render(<FilterCurveEqEditor name="points" label="Curve points" value={points}
			sampleRate={sampleRate} linearFrequencyScale={false} filterLength={8} disabled={false}
			copy={{ reset: 'Reset', invert: 'Invert' }} onCommit={commit} />); });
		await check(dom);
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
}
