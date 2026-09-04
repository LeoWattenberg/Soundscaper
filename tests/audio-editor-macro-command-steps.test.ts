/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createMacroCommandStep,
	isMacroCommandStep,
	macroCommandStepCommands,
	normalizeMacroCommandStep,
} from '../src/common/editor/macro-command-steps.ts';

test('the vocabulary is Audacity\'s parameterised selection tier and its bare tier', () => {
	const commands = macroCommandStepCommands();
	assert.deepEqual(commands.slice(0, 4), ['Select', 'SelectTime', 'SelectFrequencies', 'SelectTracks']);
	for (const command of ['SelectAll', 'Cut', 'Split', 'NewMonoTrack', 'AddLabel']) {
		assert.ok(commands.includes(command), `${command} must be in the vocabulary`);
	}
	// A bare command carries nothing, so anything written on its line is refused
	// rather than quietly dropped.
	assert.deepEqual(createMacroCommandStep('SelectAll', { id: 'a' }).params, {});
	assert.throws(() => createMacroCommandStep('SelectAll', { id: 'a', params: { start: 0 } }),
		/Unsupported SelectAll parameter: start/u);
	assert.throws(() => createMacroCommandStep('ExportWav', { id: 'a' }), /Unsupported macro command/u);
	assert.throws(() => createMacroCommandStep('', { id: 'a' }), /Unsupported macro command/u);
});

test('a command step keeps only the parameters it was given', () => {
	// Audacity's parameters are optional in the sense that an absent one means
	// "leave this alone", not "use the default": SelectTime with neither Start nor
	// End returns without touching the selection at all. A step that default-filled
	// would turn every import into a full selection rewrite.
	const step = createMacroCommandStep('SelectTime', { id: 'step-a', params: { start: 1.5 } });

	assert.deepEqual(step, {
		kind: 'command',
		id: 'step-a',
		enabled: true,
		command: 'SelectTime',
		params: { start: 1.5 },
	});
	assert.equal('end' in step.params, false);
	assert.equal('relativeTo' in step.params, false);
	assert.ok(Object.isFrozen(step) && Object.isFrozen(step.params));
});

test('every supplied parameter is admitted against its own upstream range', () => {
	assert.deepEqual(
		createMacroCommandStep('Select', {
			id: 'a',
			params: { start: 0, end: 2, relativeTo: 'project-end', high: 8_000, low: 200, track: 1, trackCount: 2, mode: 'add' },
		}).params,
		{ start: 0, end: 2, relativeTo: 'project-end', high: 8_000, low: 200, track: 1, trackCount: 2, mode: 'add' },
	);
	// A selection may reach a hundred seconds before zero so a macro can contract
	// one; further back than that is upstream's own refusal.
	assert.equal(createMacroCommandStep('SelectTime', { id: 'a', params: { start: -100 } }).params.start, -100);
	assert.throws(() => createMacroCommandStep('SelectTime', { id: 'a', params: { start: -101 } }), /between/u);
	assert.throws(() => createMacroCommandStep('SelectTracks', { id: 'a', params: { track: 101 } }), /between/u);
	assert.throws(() => createMacroCommandStep('SelectFrequencies', { id: 'a', params: { low: -1 } }), /between/u);
	assert.throws(() => createMacroCommandStep('SelectTime', { id: 'a', params: { start: Number.NaN } }), /finite/u);
	assert.throws(() => createMacroCommandStep('SelectTracks', { id: 'a', params: { mode: 'toggle' } }), /Unsupported Mode/u);
	assert.throws(() => createMacroCommandStep('SelectTime', { id: 'a', params: { future: 1 } }), /Unsupported SelectTime parameter: future/u);
});

test('a command step carries no effect metadata and can be disabled', () => {
	assert.equal(createMacroCommandStep('SelectTime', { id: 'a', enabled: false }).enabled, false);
	assert.throws(
		() => createMacroCommandStep('SelectTime', { id: 'a', context: { noiseProfile: {} } }),
		/carries no context/u,
	);
	// An absent or empty ID is minted, as the effect-step factory mints one; a
	// non-string ID is a caller error rather than something to paper over.
	assert.match(createMacroCommandStep('SelectTime', { id: '' }).id, /^step/u);
	assert.throws(() => createMacroCommandStep('SelectTime', { id: 42 }), /stable/u);
});

test('a stored command step re-validates against the current vocabulary', () => {
	const stored = { kind: 'command', id: 'a', enabled: true, command: 'SelectTracks', params: { mode: 'remove' } };
	assert.deepEqual(normalizeMacroCommandStep(stored), stored);
	assert.equal(isMacroCommandStep(stored), true);
	assert.equal(isMacroCommandStep({ id: 'a', type: 'audacity-invert' }), false);
	assert.equal(isMacroCommandStep(null), false);
	assert.throws(() => normalizeMacroCommandStep({ kind: 'command', id: 'a', command: 'Nope' }), /Unsupported macro command/u);
});
