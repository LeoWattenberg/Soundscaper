/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectSaveService } from '../src/common/editor/controller/document/project-save-service.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import type { ProjectLinkedOriginalSourceReference } from '../src/common/editor/storage/project-publication-options.ts';

test('a debounced autosave collects history source roots without detaching the undo graph', async () => {
	const project = {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: 'project', title: 'Project', revision: 1,
		sources: [{ id: 'source', kind: 'audio' }], tracks: [],
		clips: [{ id: 'clip', sourceId: 'source', kind: 'audio' }],
	};
	const session = createAudioEditorSessionController({ projects: [project] });
	const timerCallbacks: Array<() => void> = [];
	const savedRoots: ProjectLinkedOriginalSourceReference[][] = [];
	const service = createProjectSaveService({
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => structuredClone(value),
		admitProjectPublication: async () => undefined,
		collectProtectedLinkedOriginalSourceReferences: () => session.getHistoryLinkedOriginalSourceReferences(),
		saveProject: async (_snapshot, options) => {
			savedRoots.push([...(options.protectedLinkedOriginalSourceReferences || [])]);
		},
		persistActiveProjectId: async () => undefined,
		isCurrentProject: () => true,
		hasSessionTab: () => true,
		markProjectSaved: () => { session.markProjectSaved(project.id); },
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
		scheduleTimer: (callback) => { timerCallbacks.push(callback); return timerCallbacks.length; },
		clearTimer: () => undefined,
	});
	const nativeClone = globalThis.structuredClone;
	let historyClones = 0;
	globalThis.structuredClone = (value, options) => {
		if (value && typeof value === 'object' && 'undoStack' in value && 'present' in value) historyClones += 1;
		return nativeClone(value, options);
	};
	try {
		assert.equal(service.scheduleAutosave(), true);
		timerCallbacks[0]!();
		await service.drain();
		assert.deepEqual(savedRoots, [[{ kind: 'audio', sourceId: 'source' }]]);
		assert.equal(historyClones, 0);
	} finally {
		globalThis.structuredClone = nativeClone;
	}
});
