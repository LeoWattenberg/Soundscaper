/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import AudacityRateControls from '../src/common/editor/ui/AudacityRateControls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function ParameterControl(_props: Readonly<{ onCommit(value: number): void }>) {
	return <span data-rate-parameter />;
}

for (const effect of [
	{ type: 'audacity-change-tempo', parameter: 'tempoPercent' },
	{ type: 'audacity-change-speed-pitch', parameter: 'speedPercent' },
] as const) {
	test(`${effect.type} exposes current and desired durations and derives its percentage`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const commits: number[] = [];
		try {
			await act(async () => root.render(<AudacityRateControls
				effectType={effect.type}
				parameters={{ [effect.parameter]: 0 }}
				effectContext={{ selectionDuration: 12 }}
				renderParameter={() => <ParameterControl onCommit={(value) => { commits.push(value); }} />}
				copy={{ parameterRangeError: '{label}: {minimum}–{maximum}' }}
			/>));

			assert.match(dom.container.textContent, /Duration/u);
			const current = dom.one('[data-effect-param="effectAudacityCurrentLength"]');
			const desired = dom.one('[data-effect-param="effectAudacityNewLength"]');
			assert.match(current.textContent, /Current duration/u);
			assert.match(desired.textContent, /Desired duration/u);
			assert.equal(current.querySelector('[data-timecode-input="seconds"]')?.textContent !== undefined, true);
			assert.equal(desired.querySelector('[data-timecode-input="seconds"]')?.textContent !== undefined, true);
			const currentInput = current.querySelector('[data-timecode-direct-entry="true"]');
			assert.ok(currentInput);
			assert.equal(reactProps(currentInput).disabled, true);

			const desiredInput = desired.querySelector('[data-timecode-direct-entry="true"]');
			const desiredTimecode = desired.querySelector('[data-timecode-input="seconds"]');
			assert.ok(desiredInput);
			assert.ok(desiredTimecode);
			await act(async () => {
				reactProps(desiredInput).onChange({ currentTarget: { valueAsNumber: 8 } });
			});
			await act(async () => {
				reactProps(desiredTimecode).onBlur({ currentTarget: desiredTimecode, relatedTarget: null });
			});
			assert.deepEqual(commits, [50]);
		} finally {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
