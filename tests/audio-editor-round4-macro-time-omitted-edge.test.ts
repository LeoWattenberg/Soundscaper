/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';

test('each time-command origin changes only the edge its author supplied', () => {
	const selection = { startFrame: 200, endFrame: 700, trackIds: ['voice'] };
	const cases = [
		['project-start', 100, 100], ['project', 100, 1100],
		['project-end', 900, 900], ['selection-start', 300, 300],
		['selection', 300, 800], ['selection-end', 600, 600],
	] as const;
	for (const [relativeTo, start, end] of cases) {
		for (const edge of ['start', 'end'] as const) {
			let applied: readonly number[] = [];
			const service = createMacroCommandService({
				getProject: () => ({ tracks: [{ id: 'voice' }], selection }),
				projectSampleRate: () => 100, timelineDurationFrames: () => 1000,
				setExactSelection: (from, until) => { applied = [from, until]; },
			});
			service.runMacroCommand(createMacroCommandStep('SelectTime', { params: { [edge]: 1, relativeTo } }));
			assert.deepEqual(applied, edge === 'start' ? [start, 700] : [200, end], `${relativeTo}/${edge}`);
		}
	}
});

test('an explicitly supplied zero edge still changes a combined Select command', () => {
	let applied: readonly unknown[] = [];
	const service = createMacroCommandService({
		getProject: () => ({ tracks: [{ id: 'voice' }], selection: { startFrame: 200, endFrame: 700 } }),
		projectSampleRate: () => 100, timelineDurationFrames: () => 1000,
		setExactSelection: (from, until, details) => { applied = [from, until, details]; },
	});
	service.runMacroCommand(createMacroCommandStep('Select', { params: { start: 0, track: 0 } }));
	assert.deepEqual(applied, [0, 700, { trackIds: ['voice'] }]);
});
