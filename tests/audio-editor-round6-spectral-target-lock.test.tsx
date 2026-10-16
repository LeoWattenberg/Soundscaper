/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SpectralSelectionDialog from '../src/common/editor/ui/dialogs/SpectralSelectionDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const selectedLocked of [false, true]) test(`spectral mutation admission follows ${selectedLocked ? 'an unfocused selected' : 'the focused'} locked audio target`, async () => {
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
	const render = async (locked: boolean) => {
		const tracks = [
			{ id: 'track', type: 'audio', locked: !selectedLocked && locked, clipIds: ['clip'], spectrogram: { minimumFrequency: 100, maximumFrequency: 1000 } },
			{ id: 'other', type: 'audio', locked: selectedLocked && locked, clipIds: ['other-clip'] },
			{ id: 'unrelated', type: 'audio', locked: true, clipIds: ['unrelated-clip'] },
		];
		const selection = { startFrame: 0, endFrame: 48000, trackIds: selectedLocked ? ['track', 'other'] : ['track'],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 } };
		const snapshot = { project: { id: 'project', sampleRate: 48_000, tracks, selection,
			clips: tracks.map((track) => ({ id: track.clipIds[0]!, kind: 'audio', timelineStartFrame: 0, durationFrames: 48000 })) },
			selectedTrackId: 'track', selection };

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
		assert.equal(action(ENGLISH_COPY.selectFrequencyRange).hasAttribute('disabled'), false);
		assert.equal(action(ENGLISH_COPY.cancel).hasAttribute('disabled'), false);
		await click(ENGLISH_COPY.spectralAmplify);
		await click(ENGLISH_COPY.spectralDelete);
		assert.equal(mutations, 0, 'stale destructive button events cannot publish to a locked target');
		assert.deepEqual(selections, [], 'a rejected destructive action must not change the range');
		await click(ENGLISH_COPY.selectFrequencyRange);
		assert.deepEqual(selections, [{ minimumFrequency: 100, maximumFrequency: 1000 }]);
		assert.equal(mutations, 0);
		assert.equal(closes, 1);
		selections.length = 0;
		await render(false);
		await click(ENGLISH_COPY.spectralAmplify);
		assert.equal(mutations, 1);
		assert.deepEqual(selections, [{ minimumFrequency: 100, maximumFrequency: 1000 }]);
		assert.equal(closes, 2);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
