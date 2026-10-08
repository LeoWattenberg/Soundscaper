/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createEditorDocumentSnapshot, type EditorDocumentSnapshotRuntime, type SnapshotProject,
} from '../src/common/editor/controller/document/document-snapshot.ts';
import { saveCurrentDeliveryReport } from '../src/common/editor/controller/export/internal/delivery/delivery-report-action.ts';
import { createDeliveryReport, sealDeliveryReport } from '../src/common/editor/delivery-report.ts';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES } from '../src/common/editor/sound-activation-preferences.ts';
import { stateFixture } from './helpers/audio-editor-snapshot-state.ts';

function runtime(project: SnapshotProject, report: unknown): EditorDocumentSnapshotRuntime<SnapshotProject> {
	return {
		state: stateFixture({ deliveryReport: report }), product: null, productId: 'soundscaper',
		capabilities: {}, locale: 'en', getCurrentProject: () => project, projectForPlayback: () => project,
		getProjectTabs: () => [], getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null, getAudioDevicesSnapshot: () => ({}),
		getSoundActivationSnapshot: () => ({ preferences: DEFAULT_SOUND_ACTIVATION_PREFERENCES,
			preferenceMutationBlocked: false, preferenceMutationBlockReason: null, sources: [] }),
		sampleEditingAvailable: () => false, canUndo: () => false, canRedo: () => false,
		historyEntrySummary: (entry: unknown) => entry,
		getStorageStatus: () => ({ state: 'indexeddb', backend: 'indexeddb', persistent: true,
			ephemeral: false, degradedReason: null }),
		getRackEffectTypes: () => [], getVideoEffectTypes: () => [], getSelectionEffectTypes: () => [],
		getSelectionEffectParams: () => ({}), getSelectionEffectDefinition: () => null, getEffectPresets: () => [],
	};
}

async function saved(report: unknown, projectTitle: string): Promise<Readonly<Record<string, unknown>>> {
	let document: Readonly<Record<string, unknown>> = {};
	await saveCurrentDeliveryReport({ state: { deliveryReport: report }, projectTitle,
		fileService: { saveFile: async (request) => {
			assert.ok(request.blob instanceof Blob);
			document = JSON.parse(await request.blob.text()) as Readonly<Record<string, unknown>>;
		} },
	});
	return document;
}

test('saving a published delivery after activating another project retains the delivered project', async () => {
	const report = sealDeliveryReport(createDeliveryReport({ format: 'wav' }));
	createEditorDocumentSnapshot(runtime({ id: 'delivered', title: 'Delivered programme' }, report));
	assert.equal((await saved(report, 'Delivered programme')).projectTitle, 'Delivered programme');
	createEditorDocumentSnapshot(runtime({ id: 'draft', title: 'Unrelated draft' }, report));
	assert.equal((await saved(report, 'Unrelated draft')).projectTitle, 'Delivered programme');
});

test('a new delivery retains its own publication project without replacing the previous report origin', async () => {
	const oldReport = sealDeliveryReport(createDeliveryReport({ format: 'wav' }));
	const newReport = sealDeliveryReport(createDeliveryReport({ format: 'aiff' }));
	createEditorDocumentSnapshot(runtime({ id: 'first', title: 'First programme' }, oldReport));
	createEditorDocumentSnapshot(runtime({ id: 'second', title: 'Second programme' }, newReport));
	assert.equal((await saved(newReport, 'Second programme')).projectTitle, 'Second programme');
	assert.equal((await saved(oldReport, 'Second programme')).projectTitle, 'First programme');
});

test('a report before any UI publication still saves using its explicit current project context', async () => {
	const report = sealDeliveryReport(createDeliveryReport({ format: 'wav' }));
	assert.equal((await saved(report, 'Current programme')).projectTitle, 'Current programme');
});

test('an originally untitled report never borrows a later project title', async () => {
	const report = sealDeliveryReport(createDeliveryReport({ format: 'wav' }));
	createEditorDocumentSnapshot(runtime({ id: 'untitled' }, report));
	assert.equal((await saved(report, 'Unrelated draft')).projectTitle, null);
});
