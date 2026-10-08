/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AudacityRateControls from '../src/common/editor/ui/AudacityRateControls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function ParameterControl(_props: Readonly<{ onCommit(value: number): void }>) { return null; }

for (const [destination, rejected, valid, expectedPercent] of [
	[240, 100, 160, 50], [60, 150, 100, -40],
] as const) {
	test(`From BPM preserves the chosen ${destination} BPM destination within its supported rate ratio`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const commits: number[] = [];
		function Harness() {
			const [percent, setPercent] = useState(0);
			return <AudacityRateControls effectType="audacity-change-tempo" parameters={{ tempoPercent: percent }}
				renderParameter={() => <ParameterControl onCommit={value => { commits.push(value); setPercent(value); }} />}
				copy={{ parameterRangeError: '{label}: {minimum}–{maximum}' }} />;
		}
		const field = (name: string) => dom.one(`[data-effect-param="effectAudacity${name}Bpm"]`).querySelector('input')!;
		async function enter(name: string, value: number): Promise<void> {
			await act(async () => { reactProps(field(name)).onChange({ target: { value: String(value) } }); });
			await act(async () => { reactProps(field(name)).onBlur(); });
		}
		try {
			await act(async () => { root.render(<Harness />); });
			await enter('From', 120);
			await enter('To', destination);
			assert.equal(Number(field('To').value), destination);
			const count = commits.length;
			await enter('From', rejected);
			assert.equal(Number(field('To').value), destination, 'a refused reference must not substitute another destination');
			assert.equal(commits.length, count, 'a refused reference must not publish a clamped effect');
			assert.equal(field('From').getAttribute('aria-invalid'), 'true');
			await enter('From', valid);
			assert.equal(field('From').getAttribute('aria-invalid'), null);
			assert.equal(Number(field('To').value), destination);
			assert.equal(commits.at(-1), expectedPercent);
		} finally {
			await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
		}
	});
}
