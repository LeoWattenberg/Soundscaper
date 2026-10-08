/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacitySpectralActionRuntime } from '../src/common/editor/controller/effects/internal/audacity-spectral-action-runtime.ts';

interface Selection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly clipIds: readonly string[];
	readonly frequencyRange: Readonly<{ minimumFrequency: number; maximumFrequency: number }> | null;
}

test('toggling only the spectral band retains its selected recording targets', () => {
	const original: Selection = {
		startFrame: 0, endFrame: 96_000, trackIds: ['audio'], clipIds: ['selected-recording'],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_000 },
	};
	let selection = original;
	const actions = createAudacitySpectralActionRuntime({
		getProject: () => ({ id: 'project', selection }),
		setSelection: (startFrame, endFrame, details) => {
			// The public selection setter clears omitted clip targets when details
			// are supplied. A frequency-only action must explicitly retain them.
			selection = {
				startFrame, endFrame,
				trackIds: details.trackIds as readonly string[],
				clipIds: (details.clipIds ?? []) as readonly string[],
				frequencyRange: details.frequencyRange as Selection['frequencyRange'],
			};
			return selection;
		},
		spectralActions: { boxSelect: () => null },
		openSurface: () => null,
		getUiFlags: () => ({}),
		setUiFlag: () => false,
	});

	actions.toggleSpectralSelection();
	assert.deepEqual(selection, { ...original, frequencyRange: null });
	actions.toggleSpectralSelection();
	assert.deepEqual(selection, original);
});
