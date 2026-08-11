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
import {
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV16 } from '../src/common/editor/project-v16.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import type { VideoRetimeCurveV16 } from '../src/common/editor/video-retime-v16.ts';

const NOW = '2026-08-11T22:00:00.000Z';
const TIMELINE_CURVE: VideoRetimeCurveV16 = Object.freeze({
	feature: 'video-retime',
	version: 2,
	points: Object.freeze([
		Object.freeze({ outerFrame: 0, sourceFrame: Object.freeze({ num: 2, den: 1 }) }),
		Object.freeze({ outerFrame: 4, sourceFrame: Object.freeze({ num: 10, den: 1 }) }),
	]),
	segments: Object.freeze([Object.freeze({
		mode: 'ramp-forward',
		startVelocity: Object.freeze({ num: 1, den: 1 }),
		endVelocity: Object.freeze({ num: 3, den: 1 }),
	})]),
});
const BIN_CURVE: VideoRetimeCurveV16 = Object.freeze({
	feature: 'video-retime',
	version: 2,
	points: Object.freeze([
		Object.freeze({ outerFrame: 0, sourceFrame: Object.freeze({ num: 10, den: 1 }) }),
		Object.freeze({ outerFrame: 4, sourceFrame: Object.freeze({ num: 2, den: 1 }) }),
	]),
	segments: Object.freeze([Object.freeze({ mode: 'constant-reverse' })]),
});

test('fresh V8 desktop handoff preserves timeline and Project Bin V16 retime wires byte-exactly', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-v16-retime-desktop-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const project = createAudioEditorProjectV16(projectOptions());
	const document = serializeScapeProjectDocument(project);
	const writer = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: { product: 'soundscaper', processId: 101, instanceId: 'desktop-v16-retime-writer' },
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => writer.close());
	const writeService = new DesktopSharedProjectLibraryService(writer, {
		createEntryId: () => 'desktop-v16-retime-entry',
		now: () => Date.parse(NOW),
	});
	assert.deepEqual(await writeService.commitSharedProject({ document, expectedRevision: null }), {
		status: 'committed',
		document,
	});
	assert.equal(writer.readCatalog().schemaVersion, 8);
	assert.equal(writer.readCatalog().schemaVersion, DESKTOP_LIBRARY_SCHEMA_VERSION);
	assert.equal(writer.readCatalog().projects[0]?.projectSchemaVersion, 16);
	assert.equal(
		writer.readCatalog().projects[0]?.projectSchemaVersion,
		DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	);
	await writer.close();

	const reader = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 202, instanceId: 'desktop-v16-retime-reader' },
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => reader.close());
	const reopenedDocument = await new DesktopSharedProjectLibraryService(reader).readSharedProject(project.id);
	assert.equal(reopenedDocument, document);
	const reopened = parseScapeProjectDocument(reopenedDocument ?? '') as typeof project;
	assert.deepEqual(reopened.clips[0]?.retimeMap, TIMELINE_CURVE);
	assert.deepEqual(reopened.projectBin.clips[0]?.retimeMap, BIN_CURVE);
	assert.equal(JSON.stringify(reopened.clips[0]?.retimeMap), JSON.stringify(TIMELINE_CURVE));
	assert.equal(JSON.stringify(reopened.projectBin.clips[0]?.retimeMap), JSON.stringify(BIN_CURVE));
});

function projectOptions(): Record<string, unknown> {
	return {
		id: 'desktop-v16-retime-project',
		title: 'Desktop V16 retime project',
		revision: 1,
		now: NOW,
		sources: [createVideoSourceV10({
			id: 'video-source',
			name: 'Video',
			frameCount: 40_000,
			sampleFrameCount: 40_000,
			sourceFrameCount: 20,
			frameRate: { num: 24, den: 1 },
			width: 1_920,
			height: 1_080,
		})],
		clips: [videoClip('timeline-video', TIMELINE_CURVE)],
		tracks: [createVideoTrackV10({
			id: 'video-track',
			name: 'Video',
			clipIds: ['timeline-video'],
			locked: true,
		})],
		sequences: [{
			id: 'main-sequence',
			rate: { num: 24, den: 1 },
			trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
		projectBin: { clips: [videoClip('bin-video', BIN_CURVE, 'bin-video-item')] },
	};
}

function videoClip(id: string, retimeMap: VideoRetimeCurveV16, binItemId?: string): Record<string, unknown> {
	return {
		kind: 'video',
		id,
		...(binItemId ? { binItemId } : {}),
		sourceId: 'video-source',
		title: id,
		sequenceId: 'main-sequence',
		sequenceStartFrame: 0,
		sequenceFrameCount: 4,
		sourceInFrame: 2,
		sourceFrameCount: 8,
		retimeMap,
	};
}
