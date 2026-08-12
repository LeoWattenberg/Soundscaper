/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	DESKTOP_LIBRARY_SCHEMA_VERSION,
} from '../desktop/project-library-contract.ts';
import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';

const NOW = '2026-08-12T10:30:00.000Z';

test('fresh desktop V9 preserves exact V17 take lanes and comp regions across products', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-v17-take-comp-desktop-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const source = createAudioSourceV10({
		id: 'take-source', name: 'Take source', frameCount: 960, channelCount: 1, sampleRate: 48_000,
	});
	const project = createCurrentAudioEditorProject({
		id: 'desktop-v17-take-comp-project',
		title: 'Desktop V17 take comp project',
		revision: 1,
		now: NOW,
		sources: [source],
		tracks: [createAudioTrackV10({ id: 'vocal-track', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['vocal-track'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{
			id: 'vocal-group', sequenceId: 'main-sequence', trackId: 'vocal-track',
			startSample: 120, endSample: 600,
			laneOrder: ['vocal-lane'],
			lanes: [{ id: 'vocal-lane' }],
			takes: [{
				id: 'vocal-take', laneId: 'vocal-lane', sourceId: source.id,
				startSample: 120, endSample: 600, sourceStartSample: 24,
			}],
			compRegions: [{
				id: 'vocal-region', takeId: 'vocal-take', startSample: 120, endSample: 600,
			}],
		}],
	});
	const document = serializeScapeProjectDocument(project);
	const writer = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: { product: 'soundscaper', processId: 101, instanceId: 'v17-take-comp-writer' },
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => writer.close());
	const writeService = new DesktopSharedProjectLibraryService(writer, {
		createEntryId: () => 'desktop-v17-take-comp-entry',
		now: () => Date.parse(NOW),
	});
	assert.deepEqual(await writeService.commitSharedProject({ document, expectedRevision: null }), {
		status: 'committed',
		document,
	});
	assert.equal(writer.readCatalog().schemaVersion, DESKTOP_LIBRARY_SCHEMA_VERSION);
	assert.equal(writer.readCatalog().projects[0]?.projectSchemaVersion, DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION);
	await writer.close();

	const reader = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 202, instanceId: 'v17-take-comp-reader' },
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => reader.close());
	const reopenedDocument = await new DesktopSharedProjectLibraryService(reader).readSharedProject(project.id);
	assert.equal(reopenedDocument, document);
	const reopened = parseScapeProjectDocument(reopenedDocument ?? '') as typeof project;
	assert.deepEqual(reopened.takeGroups, project.takeGroups);
	assert.equal(JSON.stringify(reopened.takeGroups), JSON.stringify(project.takeGroups));
});
