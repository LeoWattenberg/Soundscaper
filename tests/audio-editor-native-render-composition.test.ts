/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { connectControllerNativeRenderInput } from '../src/common/editor/controller/native-render-input-composition.ts';
import { createProductNativeRenderInputAuthorityBinding } from '../src/common/editor/controller/product-native-render-input-authority.ts';
import { EditorControllerLifetime, EditorProjectGeneration, EDITOR_PROJECT_TASK_SCOPE } from '../src/common/editor/controller/lifecycle.ts';

function fixture() {
	const binding = createProductNativeRenderInputAuthorityBinding();
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	let project = { id: 'project', title: 'First revision' };
	projectGeneration.activate(project.id);
	const buffers = new Map<string, AudioBuffer>();
	let renders = 0;
	let completeRender: () => void = () => undefined;
	const rendering = new Promise<void>(resolve => { completeRender = resolve; });
	connectControllerNativeRenderInput(binding, {
		lifetime, projectGeneration, getProject: () => project, cloneProject: structuredClone, sourceBuffers: buffers,
		async renderSnapshot(_project, _range, input, signal) {
			assert.equal(input, buffers); assert.ok(signal instanceof AbortSignal);
			renders += 1; await rendering; return 'rendered';
		},
		createRenderEngine: () => ({ loadProject() {}, async renderMixToSink() {
			return { sampleRate: 48000, channelCount: 1, frameCount: 1, chunkCount: 1 };
		}, dispose() {} }),
		async prepareCommittedTimePitchCaches() {},
	});
	return { binding, lifetime, projectGeneration, completeRender, renders: () => renders,
		revise() { project = { ...project, title: 'Next revision' }; } };
}

void test('native render input detaches a snapshot and retires authority on finish', async () => {
	const f = fixture();
	const operation = f.binding.begin();
	assert.equal(operation.project.title, 'First revision');
	f.completeRender();
	assert.equal(await operation.renderAudio(operation.project, {}), 'rendered');
	operation.finish(); operation.finish();
	assert.throws(operation.assertCurrent, /superseded/i);
	await assert.rejects(operation.renderAudio(operation.project, {}), /superseded/i);
	assert.equal(f.renders(), 1);
});

void test('project scope cancellation aborts an outstanding native render lease', () => {
	const f = fixture();
	const operation = f.binding.begin();
	f.lifetime.cancelScope(EDITOR_PROJECT_TASK_SCOPE);
	assert.equal(operation.signal.aborted, true);
	assert.throws(operation.assertCurrent);
});

void test('a revision changing during native rendering rejects its stale result', async () => {
	const f = fixture();
	const operation = f.binding.begin();
	const pending = operation.renderAudio(operation.project, {});
	f.revise(); f.completeRender();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(operation.project.title, 'First revision');
	operation.finish();
});

void test('a replacement native render aborts its predecessor and disposal aborts the replacement', () => {
	const f = fixture();
	const first = f.binding.begin();
	const second = f.binding.begin();
	assert.equal(first.signal.aborted, true);
	assert.throws(first.assertCurrent);
	second.assertCurrent();
	f.lifetime.beginDisposal();
	assert.equal(second.signal.aborted, true);
	assert.throws(second.assertCurrent);
});
