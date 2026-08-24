/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativePluginStateCaptureProvider,
	quiesceNativePluginState,
	registerNativePluginStateQuiescence,
} from '../src/common/editor/native-plugin-state-quiescence.ts';
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts';

const liveState = (instanceId: string) => Object.freeze({
	instanceId, enabled: true, bypassed: false, continuity: 'live',
});

test('live native state fails closed without its renderer capture owner', async () => {
	const owner = { project: { nativePluginStates: [liveState('plugin-1')] } };
	await assert.rejects(
		() => quiesceNativePluginState(owner, 'project-save'),
		/state capture is unavailable/iu,
	);
	await quiesceNativePluginState({ project: { nativePluginStates: [] } }, 'project-save');
});

test('the renderer provider serializes and captures every exact live instance', async () => {
	const owner = { project: { nativePluginStates: [
		liveState('plugin-1'), liveState('plugin-2'),
		{ ...liveState('bypassed'), bypassed: true },
	] } };
	const calls: string[] = [];
	let activeCaptures = 0;
	const provider = createNativePluginStateCaptureProvider({
		getProject: () => owner.project,
		isActive: (instanceId) => instanceId !== 'missing',
		persist: async (instanceId) => {
			activeCaptures += 1;
			assert.equal(activeCaptures, 1, 'state captures must be serialized');
			calls.push(instanceId);
			await Promise.resolve();
			activeCaptures -= 1;
		},
	});
	const unregister = registerNativePluginStateQuiescence(owner, provider);
	await Promise.all([
		quiesceNativePluginState(owner, 'project-save'),
		quiesceNativePluginState(owner, 'audio-export'),
	]);
	assert.deepEqual(calls, ['plugin-1', 'plugin-2', 'plugin-1', 'plugin-2']);
	unregister();
});

test('project persistence writes the post-capture snapshot, never the scheduled stale state', async () => {
	type Project = Readonly<{ id: string; revision: number; vendorState: string }>;
	let project: Project = { id: 'project-1', revision: 1, vendorState: 'stale' };
	const saved: Project[] = [];
	const state = {
		autosaveTimer: 0, saveGeneration: 0, pendingSaveSnapshots: new Set<Project>(),
		saveQueue: Promise.resolve<unknown>(undefined), saveState: 'dirty',
	};
	const service = createProjectSaveService({
		state, getProject: () => project, hasHistory: () => true, isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		prepareSnapshot: async (scheduled) => {
			assert.equal(scheduled.vendorState, 'stale');
			project = { ...project, revision: 2, vendorState: 'captured' };
			return { ...project };
		},
		admitProjectPublication: async () => undefined,
		saveProject: async (snapshot) => { saved.push(snapshot); },
		persistActiveProjectId: async () => undefined,
		isCurrentProject: () => true, hasSessionTab: () => true,
		markProjectSaved: () => undefined, publish: () => undefined,
		garbageCollect: async () => undefined, refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
	});
	await service.flushProject();
	assert.deepEqual(saved, [{ id: 'project-1', revision: 2, vendorState: 'captured' }]);
});
