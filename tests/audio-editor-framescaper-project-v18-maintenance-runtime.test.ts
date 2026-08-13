/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { type TestContext } from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	createFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from '../src/framescaper/editor-project-environment-v18.ts';
import {
	createFramescaperProjectMaintenanceRuntimeV18,
} from '../src/framescaper/editor-project-v18-maintenance-runtime.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-13T12:00:00.000Z';

test('runtime maintenance owns its exact V18 session and rejects open requests', async (context) => {
	const environment = await createEnvironment(context);
	const runtime = createFramescaperProjectMaintenanceRuntimeV18(environment);
	assert.throws(
		() => createFramescaperProjectMaintenanceRuntimeV18({ ...environment }),
		/exact.*environment/iu,
	);
	assert.equal(Object.isFrozen(runtime), true);
	assert.equal(Object.isFrozen(runtime.sessionController), true);
	await assert.rejects(runtime.reconcileAndCollectStorageRoots({
		currentProject: project(environment, 'runtime-request', 'request'),
		pendingSaveSnapshots: [],
		extra: true,
	}), /unsupported, missing, or extra fields/iu);
	assert.throws(
		() => runtime.cleanupDeterminatePrepublicationFailure({
			operation: {
				operationId: 'runtime-operation', projectId: 'runtime-request',
				sourceId: 'video-source', baseFingerprint: 'not-a-digest',
			},
			pendingSaveSnapshots: [],
		}),
		/lowercase SHA-256/iu,
	);
});

test('runtime maintenance collects every session, history, pending-save, current, and retained root', async (context) => {
	const environment = await createEnvironment(context);
	const runtime = createFramescaperProjectMaintenanceRuntimeV18(environment);
	const active = project(environment, 'runtime-active', 'active');
	const backgroundPresent = revision(project(environment, 'runtime-background', 'background-present'), 1);
	const backgroundUndo = project(environment, 'runtime-background', 'background-undo');
	const pending = project(environment, 'runtime-pending', 'pending');
	const durablePrior = project(environment, 'runtime-durable', 'durable-prior');
	const durableCurrent = revision(project(environment, 'runtime-durable', 'durable-current'), 1);

	runtime.sessionController.openProject(active);
	runtime.sessionController.openProject(backgroundPresent, {
		activate: false,
		history: {
			limit: 10,
			present: backgroundPresent,
			undoStack: [{ project: backgroundUndo, command: { type: 'runtime/undo-root' } }],
			redoStack: [],
		},
	});
	await environment.createProjectIfAbsent(durablePrior);
	await environment.store.saveProject(durableCurrent);
	const pendingSaveSnapshots = new Set([pending]);

	const result = await runtime.reconcileAndCollectStorageRoots({
		currentProject: active,
		pendingSaveSnapshots,
	});

	assert.equal(result.cleanup.status, 'settled');
	assert.deepEqual(result.storageRoots, [
		...rootPair('active'),
		...rootPair('background-present'),
		...rootPair('background-undo'),
		...rootPair('pending'),
		...rootPair('durable-prior'),
		...rootPair('durable-current'),
	].sort());
	assert.equal(Object.isFrozen(result.storageRoots), true);
});

test('runtime maintenance refuses a stale active project and a changing runtime scope', async (context) => {
	const environment = await createEnvironment(context);
	const runtime = createFramescaperProjectMaintenanceRuntimeV18(environment);
	const active = project(environment, 'runtime-stable', 'stable');
	const replacement = revision(project(environment, 'runtime-stable', 'replacement'), 1);
	runtime.sessionController.openProject(active);

	await assert.rejects(runtime.reconcileAndCollectStorageRoots({
		currentProject: replacement,
		pendingSaveSnapshots: [],
	}), /active.*project.*match/iu);

	const pendingSaveSnapshots = new Set<FramescaperProjectV18>();
	const operation = runtime.reconcileAndCollectStorageRoots({
		currentProject: active,
		pendingSaveSnapshots,
	});
	pendingSaveSnapshots.add(project(environment, 'runtime-late-pending', 'late-pending'));
	await assert.rejects(operation, /runtime scope changed/iu);
});

test('the product controller binds one maintenance-owned session and runtime option', async () => {
	const source = await readFile(new URL('../src/framescaper/editor-controller-v18.ts', import.meta.url), 'utf8');
	assert.match(source, /createFramescaperProjectMaintenanceRuntimeV18\(environment\)/u);
	assert.match(source, /sessionController:\s*maintenance\.sessionController/u);
	assert.match(source, /projectMaintenanceRuntime:\s*maintenance/u);
	assert.doesNotMatch(source, /sessionController:\s*environment\.runtime\.createSessionController/u);
});

async function createEnvironment(
	context: TestContext,
): Promise<Readonly<FramescaperEditorProjectEnvironmentV18>> {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	return environment;
}

function project(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
	id: string,
	root: string,
): FramescaperProjectV18 {
	const digest = rootDigest(root);
	const timingDigest = rootDigest(`${root}-timing`);
	return environment.runtime.createProject({
		id,
		title: root,
		now: NOW,
		sources: [createVideoSourceV10({
			id: 'video-source', name: root, storageKey: `owned/${root}`,
			mimeType: 'video/mp4', contentSha256: digest,
			frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
			timingAsset: {
				encoding: 'soundscaper-video-timing-v1', storageKey: timingKey(root),
				sha256: timingDigest, sourceSha256: digest, byteLength: 112,
				frameCount: 10, timescale: 10, finalFrameDurationTicks: '1',
			},
			timingDecision: { mode: 'exact', rate: { num: 10, den: 1 } },
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: root,
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
}

function revision(projectValue: FramescaperProjectV18, value: number): FramescaperProjectV18 {
	return { ...projectValue, revision: value, updatedAt: NOW };
}

function rootPair(root: string): string[] {
	return [`owned/${root}`, timingKey(root)];
}

function timingKey(root: string): string {
	return `video-timing-sha256:${rootDigest(`${root}-timing`)}`;
}

function rootDigest(value: string): string {
	return [...value].reduce((sum, character) => (sum + character.codePointAt(0)!) % 256, 0)
		.toString(16).padStart(2, '0').repeat(32);
}
