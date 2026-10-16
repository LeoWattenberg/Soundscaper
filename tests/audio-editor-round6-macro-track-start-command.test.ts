/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityMacroMenuCommand } from '../src/common/editor/audacity-macro-menu-commands.ts';
import { createMacroCommandStep, macroCommandStepCommands, normalizeMacroCommandStep }
	from '../src/common/editor/macro-command-steps.ts';
import { createMacroCommandService, isRunnableMacroCommand } from
	'../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';

test('the pinned Track Start to Cursor command names its matching action', () => {
	assert.equal(audacityMacroMenuCommand('SelTrackStartToCursor')?.path, 'timeline.selectTrackStartToCursor');
	assert.equal(macroCommandStepCommands().includes('SelTrackStartToCursor'), true);
	const calls: string[] = [];
	const service = createMacroCommandService({
		getProject: () => ({ tracks: [] }), projectSampleRate: () => 48_000,
		timelineDurationFrames: () => 0, setExactSelection: () => undefined,
		getActions: () => ({ timeline: { selectTrackStartToCursor: () => { calls.push('start'); } } }),
	});
	service.runMacroCommand(createMacroCommandStep('SelTrackStartToCursor', { id: 'start' }));
	assert.deepEqual(calls, ['start']);
});

test('the old stored-cursor descriptor remains readable without executing another selection action', () => {
	assert.equal(macroCommandStepCommands().includes('SelCursorStoredCursor'), false);
	assert.equal(isRunnableMacroCommand('SelCursorStoredCursor'), false);
	const step = createMacroCommandStep('SelCursorStoredCursor', { id: 'legacy' });
	assert.deepEqual(normalizeMacroCommandStep(step), step);
});
