/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAbsentAnalysisService,
	createAbsentAudioGeneratorService,
	createAbsentEffectMacroService,
	createAbsentNyquistGeneratedAudioService,
	createAbsentNyquistHostService,
	createAbsentSelectionEffectExecutionService,
	createAbsentSelectionEffectWorkerService,
} from '../src/common/editor/controller/absent-audio-subsystems.ts';

const CONTEXT = Object.freeze({ productName: 'Framescaper' });

/** Members a caller may invoke without having asked for the domain's work. */
const SILENT_MEMBERS = new Set([
	'cancel', 'cancelWorkers', 'cancelNyquistEvaluation', 'cancelEffectMacro',
]);

/** Members that refuse synchronously because the service they replace is synchronous. */
const SYNCHRONOUS_MEMBERS = new Set(['nyquistHostProperties']);

const SHAPES = Object.freeze({
	analysis: createAbsentAnalysisService(CONTEXT),
	selectionEffectWorker: createAbsentSelectionEffectWorkerService(CONTEXT),
	nyquistHost: createAbsentNyquistHostService(CONTEXT),
	nyquistGeneratedAudio: createAbsentNyquistGeneratedAudioService(CONTEXT),
	effectMacro: createAbsentEffectMacroService(CONTEXT),
	selectionEffectExecution: createAbsentSelectionEffectExecutionService(CONTEXT),
	audioGenerator: createAbsentAudioGeneratorService(CONTEXT),
});

test('every absent subsystem member stays callable', () => {
	for (const [name, shape] of Object.entries(SHAPES)) {
		const members = Object.keys(shape);
		assert.ok(members.length > 0, `${name} exposes no members`);
		for (const member of members) {
			assert.equal(
				typeof (shape as Record<string, unknown>)[member], 'function',
				`${name}.${member} is not callable`,
			);
		}
	}
});

test('an absent subsystem refuses the work it was never composed for', async () => {
	for (const [name, shape] of Object.entries(SHAPES)) {
		for (const [member, value] of Object.entries(shape as Record<string, unknown>)) {
			if (SILENT_MEMBERS.has(member)) continue;
			const call = value as (...args: readonly unknown[]) => unknown;
			if (SYNCHRONOUS_MEMBERS.has(member)) {
				assert.throws(() => call(), /Framescaper does not compose/u, `${name}.${member}`);
				continue;
			}
			await assert.rejects(
				async () => call(),
				/Framescaper does not compose/u,
				`${name}.${member}`,
			);
		}
	}
});

test('cancelling work an absent subsystem never started is not an error', () => {
	assert.equal(SHAPES.analysis.cancel(), undefined);
	assert.equal(SHAPES.selectionEffectWorker.cancelWorkers(), undefined);
	assert.equal(SHAPES.nyquistHost.cancelNyquistEvaluation(), false);
	assert.equal(SHAPES.effectMacro.cancelEffectMacro(), false);
});

test('the absent analysis shape carries every member the deferred facade publishes', async () => {
	const { createDeferredAudioAnalysisService } = await import(
		'../src/common/editor/controller/deferred-analysis-service.ts'
	);
	const real = createDeferredAudioAnalysisService({
		lifetime: { cancelTask() {} },
	} as never);
	assert.deepEqual(Object.keys(SHAPES.analysis).sort(), Object.keys(real).sort());
});
