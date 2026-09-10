/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAnalysisComposition, type AnalysisCompositionDependencies, type AnalysisCompositionState } from '../src/common/editor/controller/analysis/analysis-composition.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';
import type { createGroupedEditorActions } from '../src/common/editor/controller/composition/action-facade.ts';

function fixture(enabled = true) {
	const project = { id: 'analysis', revision: 1, clips: [{ id: 'clip' }], tracks: [{ id: 'track', type: 'audio' }], master: {} };
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const state: AnalysisCompositionState = {
		selectedTrackId: 'track', analysisProcessing: false, lastAnalysisRequest: null,
		contrastSelections: { foreground: null, background: null },
	};
	const renders: unknown[][] = [], saved: unknown[] = [], shown: unknown[] = [], errors: unknown[] = [], labels: string[] = [];
	const progress = createEditorTaskProgressCoordinator();
	const dependencies: AnalysisCompositionDependencies<typeof project, Map<string, unknown>> = {
		enabled, productName: 'Framescaper', state, copy: ENGLISH_COPY, lifetime, projectGeneration,
		getProject: () => project, getActiveSelection: () => ({ startFrame: 10, endFrame: 14 }),
		projectDurationFrames: () => 100, projectSampleRate: () => 48000,
		cloneProject: structuredClone, hasMissingTimelineSources: () => false, sourceBuffers: new Map(),
		renderSnapshot: async (...args) => {
			renders.push(args);
			return { length: 4, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array([0.1, -0.1, 0.2, -0.2]) };
		},
		store: { loadAnalysis: async () => null, saveAnalysis: async (_key, value) => { saved.push(value); } },
		taskProgress: { async run(kind, label, operation) {
			labels.push(label);
			return progress.run(kind, label, operation);
		} },
		showAnalysis: (result) => { shown.push(result); },
		setStatus() {}, publish() {}, handleError: (error) => { errors.push(error); },
	};
	return { dependencies, state, renders, saved, shown, errors, labels };
}

test('analysis composition renders the live selection and publishes progress, results and repeat state', async () => {
	const f = fixture(), actions = createAnalysisComposition(f.dependencies);
	await actions.run('master');
	assert.deepEqual(f.errors, []);
	assert.equal(f.renders.length, 1);
	assert.partialDeepStrictEqual(f.renders[0]?.[1], { startFrame: 10, endFrame: 14, includeTail: false, preRollFrames: 10 });
	assert.equal(f.saved.length, 1);
	assert.equal(f.shown.length, 1);
	assert.deepEqual(f.labels, [ENGLISH_COPY.analysisRendering]);
	assert.equal(f.state.analysisProcessing, false);
	assert.deepEqual(f.state.lastAnalysisRequest, { type: 'levels', scope: 'master' });
	await actions.repeatLast();
	assert.equal(f.renders.length, 2);
});

test('an absent analysis composition refuses execution without reading or rendering a document', async () => {
	const f = fixture(false);
	const actions = createAnalysisComposition({ ...f.dependencies, getProject: () => { throw new Error('Document must not be read'); } });
	assert.doesNotThrow(() => actions.cancel());
	await assert.rejects(actions.run(), /Framescaper does not compose the analysis subsystem/u);
	assert.deepEqual(f.renders, []);
	assert.deepEqual(f.saved, []);
});

test('analysis cancellation remains eager before the lazy implementation is loaded', () => {
	const f = fixture();
	const task = f.dependencies.lifetime.startTask('analysis');
	createAnalysisComposition(f.dependencies).cancel();
	assert.equal(task.signal.aborted, true);
});

test('analysis snapshots its selected range before asynchronous cache lookup', async () => {
	const f = fixture(), selection = { startFrame: 10, endFrame: 14 };
	const actions = createAnalysisComposition({
		...f.dependencies, getActiveSelection: () => selection,
		store: { ...f.dependencies.store, loadAnalysis: async () => {
			selection.startFrame = 100;
			selection.endFrame = 200;
			return null;
		} },
	});
	await actions.run();
	assert.deepEqual(f.errors, []);
	assert.partialDeepStrictEqual(f.renders[0]?.[1], { startFrame: 10, endFrame: 14 });
});

test('malformed worker results cannot be cached or published as successful analysis', async () => {
	const f = fixture();
	const actions = createAnalysisComposition({ ...f.dependencies, analyzeChannels: async () => null });
	assert.equal(await actions.run(), null);
	assert.equal(f.errors.length, 1);
	assert.match(String(f.errors[0]), /invalid result/u);
	assert.deepEqual(f.saved, []);
	assert.deepEqual(f.shown, []);
	assert.equal(f.state.analysisProcessing, false);
});

/** Compile-time checks only: a numeric scope must fail at both public boundaries. */
export function checkAnalysisScopeTypes(
	actions: ReturnType<typeof createAnalysisComposition>,
	publicActions: ReturnType<typeof createGroupedEditorActions>,
): void {
	// @ts-expect-error Analysis scope arguments must no longer cross the action port as any.
	void actions.run(123);
	// @ts-expect-error The capability wrapper must preserve the scope type in the public action tree.
	void publicActions.analysis.run(123);
}
