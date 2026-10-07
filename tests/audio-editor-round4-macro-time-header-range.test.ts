/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';

function apply(clipIds: readonly string[], startFrame = 0, endFrame = 0) {
	const project = {
		id: 'recording', sampleRate: 48_000,
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['first', 'later'] }],
		clips: [{ id: 'first', kind: 'audio', timelineStartFrame: 0, durationFrames: 38_400 },
			{ id: 'later', kind: 'audio', timelineStartFrame: 48_000, durationFrames: 24_000 }],
		selection: { startFrame, endFrame, trackIds: ['voice'], clipIds,
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 } },
	};
	let written: readonly unknown[] = [];
	const service = createMacroCommandService({
		getProject: () => project, projectSampleRate: () => project.sampleRate,
		timelineDurationFrames: () => 72_000,
		setExactSelection: (from, until, details) => { written = [from, until, details]; },
	});
	service.runMacroCommand(createMacroCommandStep('SelectTime', { params: {
		start: 0.2, end: 0, relativeTo: 'selection-end',
	} }));
	return written;
}

test('relative time commands derive the selected clip range before replacing clip identities', () => {
	assert.deepEqual(apply(['first']), [28_800, 38_400, { trackIds: ['voice'],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 } }]);
	assert.deepEqual(apply(['first', 'later']).slice(0, 2), [62_400, 72_000]);
});

test('relative time commands retain an explicit time range over selected clip identities', () => {
	assert.deepEqual(apply(['first'], 12_000, 24_000).slice(0, 2), [14_400, 24_000]);
});
