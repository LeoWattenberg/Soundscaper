/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AudacityRateControls from '../src/common/editor/ui/AudacityRateControls.jsx';
import { estimateAudioSelectionEffectOutputFrames } from '../src/common/editor/selection-effects.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function ParameterControl(_props: Readonly<{ onCommit(value: number): void }>) {
	return <span data-rate-parameter />;
}

for (const effect of [
	{ type: 'audacity-change-tempo', parameter: 'tempoPercent' },
	{ type: 'audacity-change-speed-pitch', parameter: 'speedPercent' },
] as const) for (const sampleRate of [44_100, 48_000]) {
	test(`${effect.type} sample-duration display agrees with its delivered ${sampleRate}-Hz frame count`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
			observe() {} disconnect() {}
		} });
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const commits: number[] = [];
		const render = (percent: number) => root.render(<AudacityRateControls
			effectType={effect.type} parameters={{ [effect.parameter]: percent }} sampleRate={sampleRate}
			effectContext={{ selectionDuration: 1 }}
			renderParameter={() => <ParameterControl onCommit={value => { commits.push(value); }} />}
			copy={{ parameterRangeError: '{label}: {minimum}–{maximum}' }} />);
		try {
			await act(async () => { render(100); });
			const desired = dom.one('[data-effect-param="effectAudacityNewLength"]');
			const formatButton = desired.querySelector('.timecode__format-button');
			assert.ok(formatButton);
			await act(async () => { reactProps(formatButton).onClick?.(); });
			const samples = dom.container.querySelectorAll('[role="menuitem"]')
				.find(item => item.textContent === 'samples');
			assert.ok(samples);
			await act(async () => { reactProps(samples).onClick?.(); });
			const displayedFrames = () => {
				const display = desired.querySelector('.timecode__display');
				assert.ok(display);
				return Number(display.textContent.replace(/\D/gu, ''));
			};
			assert.equal(displayedFrames(), sampleRate / 2, 'an exact half-second control stays correct');
			await act(async () => { render(50); });
			const renderedFrames = estimateAudioSelectionEffectOutputFrames(effect.type, sampleRate,
				{ [effect.parameter]: 50 });
			assert.equal(displayedFrames(), renderedFrames, 'the sample format must retain sub-millisecond duration');
			const timecode = desired.querySelector('[data-timecode-input="seconds"]');
			assert.ok(timecode);
			await act(async () => { reactProps(timecode).onBlur?.({ currentTarget: timecode, relatedTarget: null }); });
			assert.deepEqual(commits, [], 'changing the display format and blurring cannot change the effect');
		} finally {
			await act(async () => { root.unmount(); });
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver);
			else Reflect.deleteProperty(globalThis, 'MutationObserver');
			dom.restore();
		}
	});
}
