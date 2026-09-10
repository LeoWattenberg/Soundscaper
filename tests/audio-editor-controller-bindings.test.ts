/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerBindings } from '../src/common/editor/controller/composition/controller-bindings.ts';
import { createControllerPresentationState } from '../src/common/editor/controller/composition/presentation-state.ts';
import type { createSourceRuntimeComposition } from '../src/common/editor/controller/source/source-runtime-composition.ts';
import type { EnginePublicApi } from '../src/common/editor/engine/public-api.ts';

test('controller binding construction leaves unrelated owners uninitialized', () => {
	let reads = 0;
	let publishes = 0;
	const unavailable = (): never => { throw new Error('An unrelated service was read.'); };
	const state = {
		status: { message: '', state: 'info' }, exportProgress: 0,
		analysisResult: null, analysisVisuals: null, analysisReport: null,
		localDiagnostics: { record() {} },
	};
	const presentation = createControllerPresentationState({
		state, copy: { ready: 'Ready', genericError: '{message}', unknownError: 'Unknown' },
		publishDocument: () => { publishes += 1; }, publishTelemetry() {}, updateTaskProgress() {},
	});
	const bindings = createControllerBindings({
		clips: unavailable, doc: unavailable, documentChannel: unavailable, edits: unavailable,
		effects: unavailable, imports: unavailable, microphoneMeterService: unavailable,
		nativeProjectService: unavailable, preferences: unavailable, preferencesService: unavailable,
		presentationState: () => { reads += 1; return presentation; },
		projectAdminService: unavailable, projectBootstrapService: unavailable,
		projectLockService: unavailable, projectSwitchService: unavailable, recording: unavailable,
		sources: (): ReturnType<typeof createSourceRuntimeComposition<EnginePublicApi>> => unavailable(),
		storageCapacityService: unavailable, telemetryChannel: unavailable,
		tracks: unavailable, viewStateService: unavailable,
	});
	assert.equal(reads, 0);
	bindings.setStatus('Imported');
	assert.deepEqual(state.status, { message: 'Imported', state: 'info' });
	assert.equal(reads, 1);
	assert.equal(publishes, 1);
	const createRenderEngine = bindings.createCacheAwareRenderEngine satisfies () => EnginePublicApi;
	assert.throws(createRenderEngine, /An unrelated service was read/);
	assert.ok(Object.isFrozen(bindings));
});
