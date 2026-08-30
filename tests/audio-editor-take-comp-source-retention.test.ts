/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectRetentionService,
	type RetentionHistory,
	type RetentionProject,
} from '../src/common/editor/controller/project-retention-service.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import {
	collectProjectSourceIds,
	collectProjectStorageKeys,
	compactProjectSourceMetadata,
} from '../src/common/editor/retention.js';
import { remapTakeGroupSourceIds } from '../src/common/editor/take-group-source-references.ts';

interface CurrentLikeTakeProject extends RetentionProject {
	readonly schemaVersion: number;
	readonly clips: readonly Readonly<{ id: string; sourceId?: string; kind?: 'audio' | 'video' }>[];
	readonly sources: readonly Readonly<{
		id: string;
		kind: 'audio' | 'video';
		storageKey?: string;
	}>[];
	readonly takeGroups: readonly Readonly<{
		readonly id: string;
		readonly takes: readonly Readonly<{
			readonly id: string;
			readonly sourceId: string;
		}>[];
	}>[];
}

interface CurrentLikeTakeHistory extends RetentionHistory<CurrentLikeTakeProject> {
	readonly previous?: readonly CurrentLikeTakeProject[];
}

function currentLikeProject(
	id = 'take-source-project',
	sourceId = 'take-only-source',
): CurrentLikeTakeProject {
	return {
		id,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		clips: [],
		sources: [
			{ id: sourceId, kind: 'audio', storageKey: `${sourceId}-storage` },
			{ id: 'unreferenced-source', kind: 'audio', storageKey: 'unreferenced-storage' },
		],
		takeGroups: [{
			id: `${id}-group`,
			takes: [{ id: `${id}-take`, sourceId }],
		}],
	};
}

test('current take-only sources root logical metadata and physical storage through compaction', () => {
	const project = currentLikeProject();
	const original = structuredClone(project);

	assert.deepEqual([...collectProjectSourceIds(project)], ['take-only-source']);
	assert.deepEqual([...collectProjectStorageKeys(project)], ['take-only-source-storage']);
	const compacted = compactProjectSourceMetadata(project) as CurrentLikeTakeProject;
	assert.notStrictEqual(compacted, project);
	assert.deepEqual(compacted.sources, [{
		id: 'take-only-source', kind: 'audio', storageKey: 'take-only-source-storage',
	}]);
	assert.deepEqual(compacted.takeGroups, project.takeGroups);
	assert.deepEqual(project, original);
});

test('take source collection deduplicates current roots and preserves unsupported inventories', () => {
	const current = {
		...currentLikeProject(),
		clips: [{ id: 'clip', sourceId: 'take-only-source', kind: 'audio' as const }],
		takeGroups: [{
			id: 'group',
			takes: [
				{ id: 'take-a', sourceId: 'take-only-source' },
				{ id: 'take-b', sourceId: 'second-take-source' },
			],
		}],
	};
	assert.deepEqual([...collectProjectSourceIds(current)], [
		'take-only-source', 'second-take-source',
	]);
	const baseline = {
		...current,
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
	};
	assert.deepEqual([...collectProjectSourceIds(baseline)], [
		'take-only-source', 'second-take-source',
	]);

	const later = {
		...current,
		schemaFamily: 'soundscaper',
		schemaVersion: 2,
		clips: [],
	};
	assert.deepEqual([...collectProjectSourceIds(later)], [
		'take-only-source', 'unreferenced-source',
	]);
	assert.deepEqual([...collectProjectStorageKeys(later)], [
		'take-only-source-storage', 'unreferenced-storage',
	]);

	const preTakeComp = {
		...current,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION - 1,
		clips: [],
	};
	assert.deepEqual([...collectProjectSourceIds(preTakeComp)], [
		'take-only-source', 'unreferenced-source',
	]);
});

test('live linked-original references include audio take sources across every history snapshot', () => {
	const present = currentLikeProject('present', 'present-take-source');
	const undone = currentLikeProject('present', 'undo-take-source');
	const other = currentLikeProject('other', 'other-take-source');
	const history: CurrentLikeTakeHistory = { present, previous: [undone] };
	const service = createProjectRetentionService<CurrentLikeTakeProject, CurrentLikeTakeHistory>({
		state: {
			history,
			clipboard: null,
			readOnly: false,
			recordingSourceId: null,
		},
		getProject: () => present,
		setProject: () => undefined,
		compactHistory: (value) => value,
		sessionTab: () => ({ dirty: false }),
		updateProjectHistory: () => undefined,
		getSourceReferenceCounts: () => ({
			'present-take-source': 1,
			'undo-take-source': 1,
			'other-take-source': 1,
		}),
		getSessionTabs: () => [{ history }, { history: { present: other } }],
		editorHistoryProjects: (value) => [value.present, ...(value.previous || [])],
		allProjectClips: (project) => project.clips,
		clipCache: { getProtectedSourceIds: () => [] },
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		evictSourceCaches: () => undefined,
	});

	assert.deepEqual(service.liveSessionLinkedOriginalSourceReferences(), [
		{ kind: 'audio', sourceId: 'other-take-source' },
		{ kind: 'audio', sourceId: 'present-take-source' },
		{ kind: 'audio', sourceId: 'undo-take-source' },
	]);
});

test('Scape source-collision remapping updates take sources without changing take identities', () => {
	const project = {
		takeGroups: [{
			id: 'group-a',
			takes: [
				{ id: 'take-a', laneId: 'lane-a', sourceId: 'source-a' },
				{ id: 'take-b', laneId: 'lane-b', sourceId: 'source-b' },
				{ id: 'take-unmapped', laneId: 'lane-b', sourceId: 'source-unmapped' },
			],
		}],
	};
	const sourceIdMap = new Map([
		['source-a', 'copied-source-a'],
		['source-b', 'copied-source-b'],
	]);

	remapTakeGroupSourceIds(project, sourceIdMap);
	assert.deepEqual(project, {
		takeGroups: [{
			id: 'group-a',
			takes: [
				{ id: 'take-a', laneId: 'lane-a', sourceId: 'copied-source-a' },
				{ id: 'take-b', laneId: 'lane-b', sourceId: 'copied-source-b' },
				{ id: 'take-unmapped', laneId: 'lane-b', sourceId: 'source-unmapped' },
			],
		}],
	});
	assert.deepEqual([...sourceIdMap], [
		['source-a', 'copied-source-a'],
		['source-b', 'copied-source-b'],
	]);
});
