/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SpectralSelectionDialog from '../src/common/editor/ui/dialogs/SpectralSelectionDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const sampleRate of [16_000, 24_000, 96_000, null]) {
	test(`the spectral dialog defaults use ${sampleRate === null ? 'the project' : `the ${sampleRate}Hz source`} frequency clock`, async () => {
		const dom = installReactTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const selections: unknown[] = [];
		let deletions = 0;
		let closes = 0;
		const controller = { actions: {
			effects: { readSourceSelectionSampleRate: () => sampleRate },
			spectral: {
				boxSelect: (range: unknown) => { selections.push(range); },
				delete: async () => { deletions++; },
				amplify: async () => undefined,
			},
		} };
		const snapshot = { project: { id: 'project', sampleRate: 48_000,
			tracks: [{ id: 'track', type: 'audio', locked: false, clipIds: ['clip'],
				spectrogram: { minimumFrequency: 0, maximumFrequency: 20_000 } }],
			clips: [{ id: 'clip', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000 }],
			selection: { startFrame: 0, endFrame: 48_000, trackIds: ['track'] } },
			selectedTrackId: 'track', selectedClipId: 'clip' };
		try {
			await act(async () => { root.render(<SpectralSelectionDialog controller={controller} snapshot={snapshot}
				copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()} onClose={() => { closes++; }} />); });
			const maximum = dom.container.querySelectorAll('label').find(label => label.textContent.startsWith(ENGLISH_COPY.maximumFrequency))?.querySelector('input');
			assert.ok(maximum);
			const expectedMaximum = Math.min(20_000, (sampleRate ?? 48_000) / 2);
			assert.equal(maximum.value, String(expectedMaximum));
			const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === ENGLISH_COPY.spectralDelete);
			assert.ok(button);
			assert.equal(button.hasAttribute('disabled'), false);
			await act(async () => {
				void reactProps(button).onClick({});
				await Promise.resolve();
			});
			assert.deepEqual(selections, [{ minimumFrequency: 0, maximumFrequency: expectedMaximum }]);
			assert.equal(deletions, 1);
			assert.equal(closes, 1);
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
