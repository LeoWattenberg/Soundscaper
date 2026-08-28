/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyFramescaperOwnedFinishingCommandFinishing,
} from '../src/framescaper/editor-project-finishing-finishing-command.ts';
import {
	snapshotFramescaperProjectCommandNativeMedia,
} from '../src/framescaper/editor-project-native-media-commands.ts';
import {
	snapshotFramescaperProjectCommandOpenFx,
} from '../src/framescaper/editor-project-openfx-commands.ts';
import {
	applyFramescaperProfessionalSourceCollectionCommandProfessionalMedia,
} from '../src/framescaper/editor-project-professional-media-source-command.ts';
import {
	applyFramescaperImageCommandTimelineImage,
} from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import {
	applyFramescaperOwnedVisualCommandVisual,
} from '../src/framescaper/editor-project-visual-visual-command.ts';

test('visual source removal refuses a missing identity without deleting the final source', () => {
	const project = { sources: [{ id: 'sentinel-video', kind: 'video' }] };
	const before = structuredClone(project);

	assert.throws(() => applyFramescaperOwnedVisualCommandVisual(project, {
		type: 'video-visual-source/set', sourceId: 'missing-source',
		expectedSource: null, source: null,
	}), ReferenceError);
	assert.deepEqual(project, before);
});

test('visual model removal refuses a missing identity without deleting the final model', () => {
	const project = { videoAdjustmentLayers: [{ id: 'sentinel-adjustment' }] };
	const before = structuredClone(project);

	assert.throws(() => applyFramescaperOwnedVisualCommandVisual(project, {
		type: 'video-adjustment-layer/set', adjustmentLayerId: 'missing-adjustment',
		expectedAdjustmentLayer: null, adjustmentLayer: null,
	}), ReferenceError);
	assert.deepEqual(project, before);
});

test('timeline-image source removal refuses a missing identity without deleting the final source', () => {
	const project = { sources: [{ id: 'sentinel-video', kind: 'video' }] };
	const before = structuredClone(project);

	assert.throws(() => applyFramescaperImageCommandTimelineImage(project, {
		type: 'image-source/set', sourceId: 'missing-source',
		expectedSource: null, source: null,
	}), ReferenceError);
	assert.deepEqual(project, before);
});

test('professional source removal refuses a missing identity without deleting the final source', () => {
	const project = { sources: [{ id: 'sentinel-video', kind: 'video' }] };
	const before = structuredClone(project);

	assert.throws(() => applyFramescaperProfessionalSourceCollectionCommandProfessionalMedia(project, {
		type: 'video-source/professional-remove', sourceId: 'missing-source', expectedSource: null,
	} as never), ReferenceError);
	assert.deepEqual(project, before);
});

test('finishing removal re-snapshots a null/null mutation before collection apply', () => {
	const project = { automationLanes: [{ id: 'sentinel-lane' }] };
	const before = structuredClone(project);

	assert.throws(() => applyFramescaperOwnedFinishingCommandFinishing(project, {
		type: 'automation-lane/set', laneId: 'missing-lane', expected: null, lane: null,
	}), /must mutate state/iu);
	assert.deepEqual(project, before);
});

test('OpenFX entry points reject null/null mutations before collection apply', () => {
	const command = {
		type: 'openfx-effect/set', instanceId: 'missing-effect', expectedEffect: null, effect: null,
	};

	assert.throws(() => snapshotFramescaperProjectCommandOpenFx(command), /must add, replace, or remove/iu);
	assert.throws(() => snapshotFramescaperProjectCommandNativeMedia(command), /must add, replace, or remove/iu);
});
