/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';

test('a first lower-only macro spectral selection retains the full upper bandwidth', () => {
	const applied: unknown[] = [];
	const service = createMacroCommandService({
		getProject: () => ({ tracks: [{ id: 'track' }], selection: {
			startFrame: 0, endFrame: 48_000, trackIds: ['track'], clipIds: ['clip'],
		} }),
		projectSampleRate: () => 48_000,
		timelineDurationFrames: () => 48_000,
		setExactSelection: (start, end, details) => { applied.push({ start, end, details }); },
	});
	service.runMacroCommand(createMacroCommandStep('SelectFrequencies', { params: { low: 500 } }));
	assert.deepEqual(applied, [{ start: 0, end: 48_000, details: {
		trackIds: ['track'], clipIds: ['clip'],
		frequencyRange: { minimumFrequency: 500, maximumFrequency: 24_000 },
	} }]);
});
