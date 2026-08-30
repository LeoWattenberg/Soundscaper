/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectHistorySourceIds,
	collectProjectSourceIds,
	compactEditorHistorySourceMetadata,
	compactProjectSourceMetadata,
} from '../src/common/editor/retention.js';
import {
	createAudioSource,
} from '../src/common/editor/project-media-factory.ts';

const NOW = '2026-07-29T12:00:00.000Z';
const FALLBACK_DIGEST = 'ab'.repeat(32);

function source(id: string) {
	return createAudioSource({
		id,
		storageKey: id,
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		frameCount: 48_000,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
}

function fallbackProject(projectId: string, fallbackSourceId: string) {
	return createCurrentAudioEditorProject({
		id: projectId,
		title: projectId,
		now: NOW,
		sources: [source(fallbackSourceId), source(`${projectId}-stale`)],
		featureRequirements: {
			schemaVersion: 1,
			requirements: [{
				id: `${projectId}-native-feature`,
				featureId: 'org.soundscaper.native.spectral-repair',
				displayName: 'Spectral repair',
				disposition: 'rendered-fallback',
				fallback: {
					kind: 'audio',
					sourceId: fallbackSourceId,
					sha256: FALLBACK_DIGEST,
				},
			}],
		},
	});
}

function sourceIds(project: unknown): string[] {
	const candidate = project as Readonly<{
		sources: readonly Readonly<{ id: string }>[];
	}>;
	return candidate.sources.map((sourceMetadata) => sourceMetadata.id);
}

test('project retention roots a rendered fallback source without a clip reference', () => {
	const project = fallbackProject('fallback-only', 'fallback-render');

	assert.deepEqual(project.clips, []);
	assert.deepEqual([...collectProjectSourceIds(project)], ['fallback-render']);
});

test('project retention preserves the source inventory of opaque future documents', () => {
	const project = fallbackProject('later-schema', 'fallback-render');
	const later = { ...project, schemaFamily: 'soundscaper', schemaVersion: 2 };

	assert.deepEqual([...collectProjectSourceIds(later)], ['fallback-render', 'later-schema-stale']);
	assert.strictEqual(compactProjectSourceMetadata(later), later);

	const opaqueProject = {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION + 1,
		clips: [],
		projectBin: { clips: [] },
		featureRequirements: {
			requirements: {
				fallback: { sourceId: 'opaque-future-source' },
			},
		},
	};

	assert.deepEqual([...collectProjectSourceIds(opaqueProject)], []);
	assert.deepEqual([
		...collectProjectSourceIds({
			...project,
			schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION + 1,
		}),
	], ['fallback-render', 'later-schema-stale']);
});

test('a document without a recognized schema preserves its source inventory', () => {
	const project = fallbackProject('schemaless', 'fallback-render') as unknown as Record<string, unknown>;

	assert.deepEqual(
		[...collectProjectSourceIds({ ...project, schemaVersion: undefined })],
		['fallback-render', 'schemaless-stale'],
	);
});

test('source metadata compaction keeps fallback-only metadata and removes unrelated metadata', () => {
	const project = fallbackProject('compaction', 'fallback-render');
	const original = structuredClone(project);
	const compacted = compactProjectSourceMetadata(project) as typeof project;

	assert.deepEqual(project, original);
	assert.notStrictEqual(compacted, project);
	assert.deepEqual(sourceIds(compacted), ['fallback-render']);
	assert.deepEqual(compacted.featureRequirements, project.featureRequirements);
	assert.equal(validateCurrentAudioEditorProject(compacted), true);
});

test('present, undo, and redo feature fallbacks remain independent history roots', () => {
	const present = fallbackProject('history-project', 'present-fallback');
	const undone = fallbackProject('history-project', 'undo-fallback');
	const redone = fallbackProject('history-project', 'redo-fallback');
	const history = {
		limit: 3,
		present,
		undoStack: [{ project: undone, command: { type: 'test/undo-snapshot' } }],
		redoStack: [{ project: redone, command: { type: 'test/redo-snapshot' } }],
	};

	assert.deepEqual(
		[...collectHistorySourceIds(history)].sort(),
		['present-fallback', 'redo-fallback', 'undo-fallback'],
	);

	const compacted = compactEditorHistorySourceMetadata(history) as typeof history;
	assert.deepEqual(sourceIds(compacted.present), ['present-fallback']);
	assert.deepEqual(
		sourceIds(compacted.undoStack[0]?.project),
		['undo-fallback'],
	);
	assert.deepEqual(
		sourceIds(compacted.redoStack[0]?.project),
		['redo-fallback'],
	);
	for (const snapshot of [
		compacted.present,
		compacted.undoStack[0]?.project,
		compacted.redoStack[0]?.project,
	]) {
		assert.equal(validateCurrentAudioEditorProject(snapshot), true);
	}
});
