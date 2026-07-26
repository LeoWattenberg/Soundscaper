/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectRetentionService,
	type RetentionHistory,
	type RetentionProject,
} from '../src/common/editor/controller/project-retention-service.ts';

interface TestProject extends RetentionProject {
	readonly clips: readonly Readonly<{ id: string; sourceId?: string }>[];
}

interface TestHistory extends RetentionHistory<TestProject> {
	readonly previous?: readonly TestProject[];
}

test('retention compaction preserves clipboard roots and updates the active tab dirty state', () => {
	const first: TestProject = { id: 'project', clips: [{ id: 'clip-a', sourceId: 'source-a' }] };
	const compacted: TestProject = { id: 'project', clips: [{ id: 'clip-a', sourceId: 'source-a' }] };
	let history: TestHistory = { present: first };
	let project: TestProject | null = first;
	let compactPreserve = new Set<string>();
	let sessionUpdate: Readonly<{ projectId: string; history: TestHistory; dirty: boolean }> | null = null;
	let evictedWith = new Set<string>();
	const sourceBuffers = new Map<string, unknown>([['cached', {}]]);
	const sourcePeaks = new Map<string, unknown>([['cached', {}]]);
	const service = createProjectRetentionService<TestProject, TestHistory>({
		state: {
			get history() { return history; },
			set history(value) { history = value; },
			clipboard: { tracks: [{ clips: [{ sourceId: 'clipboard-source' }] }] },
			readOnly: false,
			recordingSourceId: 'recording-source',
		},
		getProject: () => project,
		setProject: (value) => { project = value; },
		compactHistory(value, options) {
			compactPreserve = new Set(options.preservePresentSourceIds);
			return { ...value, present: compacted };
		},
		sessionTab: () => ({ dirty: false }),
		updateProjectHistory(projectId, value, options) {
			sessionUpdate = { projectId, history: value, dirty: options.dirty };
		},
		getSourceReferenceCounts: () => ({ 'tab-source': 2 }),
		getSessionTabs: () => [{ history: { present: first, previous: [] } }],
		editorHistoryProjects: (value) => [value.present, ...(value.previous || [])],
		allProjectClips: (value) => value.clips,
		clipCache: {
			getProtectedSourceIds: () => ['render-source'],
		},
		sourceBuffers,
		sourcePeaks,
		evictSourceCaches(_buffers, _peaks, sourceIds) {
			evictedWith = new Set(sourceIds);
		},
	});

	assert.equal(service.compactLiveSourceState(true), compacted);
	assert.deepEqual([...compactPreserve], ['clipboard-source']);
	assert.deepEqual(sessionUpdate, { projectId: 'project', history, dirty: true });
	assert.deepEqual([...evictedWith].sort(), ['recording-source', 'render-source', 'tab-source']);
	assert.equal(project, compacted);
});

test('retention roots include every tab history clip and preserve existing dirty state by default', () => {
	const current: TestProject = { id: 'current', clips: [{ id: 'current-clip' }] };
	const undone: TestProject = { id: 'current', clips: [{ id: 'undo-clip' }] };
	const other: TestProject = { id: 'other', clips: [{ id: 'other-clip' }] };
	let history: TestHistory = { present: current, previous: [undone] };
	let dirty: boolean | null = null;
	const retained: string[][] = [];
	const service = createProjectRetentionService<TestProject, TestHistory>({
		state: {
			get history() { return history; },
			set history(value) { history = value; },
			clipboard: null,
			readOnly: false,
			recordingSourceId: null,
		},
		getProject: () => current,
		setProject: () => undefined,
		compactHistory: (value) => value,
		sessionTab: () => ({ dirty: true }),
		updateProjectHistory: (_projectId, _value, options) => { dirty = options.dirty; },
		getSourceReferenceCounts: () => ({}),
		getSessionTabs: () => [{ history }, { history: { present: other } }],
		editorHistoryProjects: (value) => [value.present, ...(value.previous || [])],
		allProjectClips: (value) => value.clips,
		clipCache: {
			retainClipIds: (ids) => { retained.push([...ids].sort()); },
			getProtectedSourceIds: () => [],
		},
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		evictSourceCaches: () => undefined,
	});

	service.compactLiveSourceState();
	assert.equal(dirty, true);
	assert.deepEqual([...service.liveSessionClipIds()].sort(), ['current-clip', 'other-clip', 'undo-clip']);
	service.retainLiveClipIds();
	assert.deepEqual(retained, [['current-clip', 'other-clip', 'undo-clip']]);
});

test('read-only and missing projects never update session history', () => {
	let updates = 0;
	const project: TestProject = { id: 'readonly', clips: [] };
	let history: TestHistory | null = { present: project };
	const service = createProjectRetentionService<TestProject, TestHistory>({
		state: {
			get history() { return history; },
			set history(value) { history = value; },
			clipboard: null,
			readOnly: true,
			recordingSourceId: null,
		},
		getProject: () => project,
		setProject: () => undefined,
		compactHistory: (value) => value,
		sessionTab: () => ({ dirty: true }),
		updateProjectHistory: () => { updates += 1; },
		getSourceReferenceCounts: () => ({}),
		getSessionTabs: () => [],
		editorHistoryProjects: (value) => [value.present],
		allProjectClips: (value) => value.clips,
		clipCache: { getProtectedSourceIds: () => [] },
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		evictSourceCaches: () => undefined,
	});

	service.compactLiveSourceState();
	history = null;
	service.compactLiveSourceState();
	assert.equal(updates, 0);
});
