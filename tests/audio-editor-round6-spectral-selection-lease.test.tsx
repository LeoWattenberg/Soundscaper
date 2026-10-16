/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SpectralSelectionDialog from '../src/common/editor/ui/dialogs/SpectralSelectionDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('spectral actions follow a live lease while cancellation and editable recovery remain available', async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const selections: unknown[] = [];
	let mutations = 0;
	let closes = 0;
	const controller = { actions: { spectral: {
		boxSelect: (range: unknown) => { selections.push(range); },
		delete: async () => { mutations++; },
		amplify: async () => { mutations++; },
	} } };
	const render = async (readOnly: boolean) => {
		const snapshot = { readOnly, project: { id: 'project', sampleRate: 48_000,
			tracks: [{ id: 'track', type: 'audio', spectrogram: { minimumFrequency: 100, maximumFrequency: 1000 } }] },
			selectedTrackId: 'track', selection: { frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 } } };
		await act(async () => { root.render(<SpectralSelectionDialog controller={controller} snapshot={snapshot}
			copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()} onClose={() => { closes++; }} />); });
	};
	const action = (label: string) => {
		const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === label);
		assert.ok(button);
		return button;
	};
	const click = async (label: string) => act(async () => {
		void reactProps(action(label)).onClick({});
		await Promise.resolve();
	});
	try {
		await render(false);
		assert.equal(action(ENGLISH_COPY.spectralAmplify).hasAttribute('disabled'), false);
		await render(true);
		assert.equal(action(ENGLISH_COPY.spectralAmplify).hasAttribute('disabled'), true);
		assert.equal(action(ENGLISH_COPY.spectralDelete).hasAttribute('disabled'), true);
		assert.equal(action(ENGLISH_COPY.selectFrequencyRange).hasAttribute('disabled'), true);
		assert.equal(action(ENGLISH_COPY.cancel).hasAttribute('disabled'), false);
		await click(ENGLISH_COPY.spectralAmplify);
		await click(ENGLISH_COPY.spectralDelete);
		assert.equal(mutations, 0, 'stale button events cannot publish after a lease change');
		assert.deepEqual(selections, [], 'a rejected destructive action must not change the range');
		await click(ENGLISH_COPY.selectFrequencyRange);
		assert.deepEqual(selections, []);
		assert.equal(closes, 0);
		await render(false);
		await click(ENGLISH_COPY.spectralAmplify);
		assert.equal(mutations, 1);
		assert.deepEqual(selections, [{ minimumFrequency: 100, maximumFrequency: 1000 }]);
		assert.equal(closes, 1);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
