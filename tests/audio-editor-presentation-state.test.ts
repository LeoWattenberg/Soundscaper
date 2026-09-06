/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerPresentationState } from '../src/common/editor/controller/presentation-state.ts';

test('progress updates stay on telemetry while failures publish a diagnostic and document status', () => {
	const events: string[] = [];
	const failures: unknown[] = [];
	const state = {
		status: { message: 'Ready', state: 'info' }, exportProgress: 0,
		analysisResult: null as unknown, analysisVisuals: null as unknown, analysisReport: null as unknown,
		localDiagnostics: { record(error: unknown) { failures.push(error); events.push('diagnostic'); } },
	};
	const presentation = createControllerPresentationState({
		state, copy: { ready: 'Ready', genericError: 'Error: {message}', unknownError: 'Unknown error' },
		publishDocument: () => { events.push('document'); },
		publishTelemetry: () => { events.push('telemetry'); },
		updateTaskProgress: () => { events.push('task'); },
	});
	presentation.updateExportProgress(2);
	assert.equal(state.exportProgress, 1);
	assert.deepEqual(events, ['task', 'telemetry']);
	events.length = 0;
	const error = new Error('Save failed');
	assert.equal(presentation.handleError(error), null);
	assert.deepEqual(failures, [error]);
	assert.deepEqual(events, ['diagnostic', 'document']);
	assert.deepEqual(state.status, { message: 'Error: Save failed', state: 'error' });
	presentation.toggleExport(false);
	assert.equal(state.exportProgress, 0);
	assert.deepEqual(events.slice(-2), ['telemetry', 'document']);
	presentation.showAnalysis('levels', 'waveform', 'report');
	assert.equal(state.analysisResult, 'levels');
	assert.equal(state.analysisReport, 'report');
	assert.equal(events.at(-1), 'document');
});
