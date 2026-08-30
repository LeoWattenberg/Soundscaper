/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from
	'../src/common/editor/timeline-image-model.ts';
import {
	applyFramescaperProjectCommandTimelineImage,
} from '../src/framescaper/editor-project-timeline-image-commands.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const NOW = '2026-08-31T12:00:00.000Z';

test('selection/set can select a timeline image stripped from the inherited foundation', () => {
	const selected = applyFramescaperProjectCommandTimelineImage(PROFILE, imageProject(), {
		type: 'selection/set', startFrame: 0, endFrame: 0,
		clipIds: ['image-clip'], trackIds: ['video-track'],
	}, { now: NOW });

	assert.deepEqual(selected.selection.clipIds, ['image-clip']);
});

test('nested inherited batches retain their final timeline image selection', () => {
	const selected = applyFramescaperProjectCommandTimelineImage(PROFILE, imageProject(), {
		type: 'batch',
		commands: [{
			type: 'batch',
			commands: [{
				type: 'selection/set', startFrame: 0, endFrame: 0,
				clipIds: ['image-clip'], trackIds: ['video-track'],
			}],
		}],
	}, { now: NOW });

	assert.deepEqual(selected.selection.clipIds, ['image-clip']);
});

function imageProject() {
	let project = createFramescaperProjectTimelineImage(
		PROFILE,
		framescaperV20Options() as never,
	);
	project = applyFramescaperProjectCommandTimelineImage(PROFILE, project, {
		type: 'image-source/set', sourceId: 'image-source', expectedSource: null,
		source: {
			schemaVersion: 1, kind: 'image', id: 'image-source', name: 'Image',
			mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, storageKey: 'image-source',
			contentSha256: '11'.repeat(32), assetByteLength: 4_096,
			original: {
				fileName: 'image.png', mimeType: 'image/png', recognizedFormat: 'png',
				byteLength: 128, sha256: '22'.repeat(32),
			},
			canonical: {
				width: 640, height: 360, hasAlpha: true, frameCount: 1,
				durationTicks: '1000000', timingMode: 'fallback',
			},
			conversionReceiptSha256: '33'.repeat(32),
		},
	}, { now: NOW });
	return applyFramescaperProjectCommandTimelineImage(PROFILE, project, {
		type: 'image-clip/set', clipId: 'image-clip', expectedClip: null,
		expectedPlacement: null,
		clip: {
			schemaVersion: 1, kind: 'image', id: 'image-clip', sourceId: 'image-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceStartTicks: '0',
		},
		placement: { scope: 'timeline', trackId: 'video-track' },
	}, { now: NOW });
}
