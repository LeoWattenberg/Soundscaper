/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMacroCommandStep, encodeMacroCommandStepParameters, macroCommandStepCommands,
	normalizeMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { createMacroCommandService, isRunnableMacroCommand } from
	'../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { createEffectMacroLibrary } from '../src/common/editor/effect-macro-library.js';

test('Contrast is excluded from the executable bare-command catalogue', () => {
	assert.equal(macroCommandStepCommands().includes('ContrastAnalyser'), false);
	assert.equal(isRunnableMacroCommand('ContrastAnalyser'), false);
	for (const command of ['FindClipping', 'PlotSpectrum', 'SelectAll']) assert.equal(isRunnableMacroCommand(command), true);
});

test('an existing Contrast step remains readable and exportable, but refuses before invoking analysis', () => {
	const step = createMacroCommandStep('ContrastAnalyser', { id: 'old-contrast' });
	assert.deepEqual(normalizeMacroCommandStep(step), step);
	assert.deepEqual(encodeMacroCommandStepParameters(step), []);
	const library = createEffectMacroLibrary({ schemaVersion: 1, macros: [{
		id: 'saved-macro', name: 'Contrast', effects: [step],
	}] });
	assert.deepEqual(library.macros[0]?.effects, [step]);
	let calls = 0;
	const service = createMacroCommandService({
		getProject: () => ({ tracks: [] }), projectSampleRate: () => 48_000,
		timelineDurationFrames: () => 0, setExactSelection: () => undefined,
		getActions: () => ({ analysis: { contrast: () => { calls++; } } }),
	});
	assert.throws(() => service.runMacroCommand(step), /cannot run.*ContrastAnalyser/u);
	assert.equal(calls, 0);
});
