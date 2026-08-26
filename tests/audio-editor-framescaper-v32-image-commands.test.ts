/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model-v32.ts';
import {
	applyFramescaperProjectCommandV32,
	snapshotFramescaperProjectCommandV32,
} from '../src/framescaper/editor-project-v32-commands.ts';
import {
	createFramescaperProjectHistoryV32,
	executeFramescaperProjectCommandV32,
	redoFramescaperProjectCommandV32,
	undoFramescaperProjectCommandV32,
} from '../src/framescaper/editor-project-v32-history.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import { createFramescaperProjectV32 } from '../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const DIGEST_A = '41'.repeat(32);
const DIGEST_B = '42'.repeat(32);
const DIGEST_C = '43'.repeat(32);

test('V32 adds one authenticated image source and timeline placement atomically', () => {
	const profile = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV32(profile, framescaperV20Options());
	const sequenceId = String(project.primarySequenceId);
	const videoTrack = project.tracks.find(({ type }) => type === 'video');
	assert.ok(videoTrack);
	const source = sourceFixture();
	const clip = clipFixture(sequenceId);
	const command = snapshotFramescaperProjectCommandV32({
		type: 'batch',
		commands: [{
			type: 'image-source/set', sourceId: source.id,
			expectedSource: null, source,
		}, {
			type: 'image-clip/set', clipId: clip.id,
			expectedClip: null, expectedPlacement: null,
			clip, placement: { scope: 'timeline', trackId: videoTrack.id },
		}],
	});
	const updated = applyFramescaperProjectCommandV32(profile, project, command, {
		now: '2026-08-25T12:00:00.000Z',
	});
	assert.equal(Number(updated.revision), Number(project.revision) + 1);
	assert.equal(updated.updatedAt, '2026-08-25T12:00:00.000Z');
	assert.deepEqual(updated.sources.find(({ id }) => id === source.id), source);
	assert.deepEqual(updated.clips.find(({ id }) => id === clip.id), clip);
	assert.equal(updated.tracks.find(({ id }) => id === videoTrack.id)?.clipIds.includes(clip.id), true);
	assert.equal(updated.featureRequirements.requirements.some(
		({ featureId }) => featureId === PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
	), true);
	assert.throws(() => applyFramescaperProjectCommandV32(profile, updated, command), /stale/iu);
});

test('V32 project-bin image placement stays off timeline tracks and survives inherited edits', () => {
	const profile = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV32(profile, framescaperV20Options());
	const source = sourceFixture();
	const clip = clipFixture(String(project.primarySequenceId));
	const imported = applyFramescaperProjectCommandV32(profile, project, {
		type: 'batch', commands: [{
			type: 'image-source/set', sourceId: source.id,
			expectedSource: null, source,
		}, {
			type: 'image-clip/set', clipId: clip.id,
			expectedClip: null, expectedPlacement: null,
			clip, placement: { scope: 'project-bin' },
		}],
	});
	assert.deepEqual(
		(imported.projectBin.clips as readonly Readonly<Record<string, unknown>>[])
			.find(({ id }) => id === clip.id),
		clip,
	);
	assert.equal(imported.tracks.some(({ clipIds }) => clipIds.includes(clip.id)), false);
	const renamed = applyFramescaperProjectCommandV32(profile, imported, {
		type: 'project/rename', title: 'Images retained',
	});
	assert.equal(renamed.title, 'Images retained');
	assert.deepEqual(renamed.sources.find(({ id }) => id === source.id), source);
	assert.deepEqual(
		(renamed.projectBin.clips as readonly Readonly<Record<string, unknown>>[])
			.find(({ id }) => id === clip.id),
		clip,
	);
});

test('V32 applies an inherited audio/video lane pair atomically', () => {
	const profile = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV32(profile, framescaperV20Options());
	const updated = applyFramescaperProjectCommandV32(profile, project, {
		type: 'batch',
		commands: [{
			...createAddTrackCommand({
				type: 'video', id: 'browser-import-video-track', name: 'Imported video',
				laneGroupId: 'browser-import-media-lane',
			}),
			index: 2,
		}, {
			...createAddTrackCommand({
				type: 'audio', id: 'browser-import-audio-track', name: 'Imported audio',
				laneGroupId: 'browser-import-media-lane', armed: false,
			}),
			index: 3,
		}],
	});
	assert.deepEqual(updated.tracks.slice(2).map(({ id, laneGroupId }) => ({ id, laneGroupId })), [{
		id: 'browser-import-video-track', laneGroupId: 'browser-import-media-lane',
	}, {
		id: 'browser-import-audio-track', laneGroupId: 'browser-import-media-lane',
	}]);
	assert.equal(Number(updated.revision), Number(project.revision) + 1);
});

test('V32 refuses mismatched image references and locked timeline placement', () => {
	const profile = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV32(profile, framescaperV20Options());
	const source = sourceFixture();
	const clip = clipFixture(String(project.primarySequenceId));
	assert.throws(() => applyFramescaperProjectCommandV32(profile, project, {
		type: 'image-clip/set', clipId: clip.id,
		expectedClip: null, expectedPlacement: null,
		clip, placement: { scope: 'project-bin' },
	}), /source/iu);
	const locked = project.tracks.find(({ type, locked }) => type === 'video' && locked);
	if (locked) assert.throws(() => applyFramescaperProjectCommandV32(profile, project, {
		type: 'batch', commands: [{
			type: 'image-source/set', sourceId: source.id, expectedSource: null, source,
		}, {
			type: 'image-clip/set', clipId: clip.id,
			expectedClip: null, expectedPlacement: null,
			clip, placement: { scope: 'timeline', trackId: locked.id },
		}],
	}), /locked/iu);
});

test('V32 history restores image source, placement, and conditional requirement', () => {
	const profile = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV32(profile, framescaperV20Options());
	const source = sourceFixture();
	const clip = clipFixture(String(project.primarySequenceId));
	const command = {
		type: 'batch' as const, commands: [{
			type: 'image-source/set' as const, sourceId: source.id,
			expectedSource: null, source,
		}, {
			type: 'image-clip/set' as const, clipId: clip.id,
			expectedClip: null, expectedPlacement: null,
			clip, placement: { scope: 'project-bin' as const },
		}],
	};
	const imported = executeFramescaperProjectCommandV32(
		profile, createFramescaperProjectHistoryV32(profile, project), command,
	);
	assert.equal(imported.undoStack.length, 1);
	assert.equal(imported.present.sources.some(({ id }) => id === source.id), true);
	const undone = undoFramescaperProjectCommandV32(profile, imported);
	assert.equal(undone.present.sources.some(({ id }) => id === source.id), false);
	assert.equal(undone.present.featureRequirements.requirements.some(
		({ featureId }) => featureId === PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
	), false);
	const redone = redoFramescaperProjectCommandV32(profile, undone);
	assert.equal(redone.present.sources.some(({ id }) => id === source.id), true);
	assert.equal(redone.redoStack.length, 0);
});

function sourceFixture() {
	return {
		schemaVersion: 1 as const,
		kind: 'image' as const,
		id: 'image-source-1',
		name: 'Animated sample',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'image-source-1',
		contentSha256: DIGEST_A,
		assetByteLength: 4_096,
		original: {
			fileName: 'sample.png', mimeType: 'image/png', recognizedFormat: 'apng',
			byteLength: 128, sha256: DIGEST_B,
		},
		canonical: {
			width: 640, height: 360, hasAlpha: true, frameCount: 2,
			durationTicks: '50000', timingMode: 'embedded' as const,
		},
		conversionReceiptSha256: DIGEST_C,
	};
}

function clipFixture(sequenceId: string) {
	return {
		schemaVersion: 1 as const,
		kind: 'image' as const,
		id: 'image-clip-1',
		sourceId: 'image-source-1',
		sequenceId,
		sequenceStartFrame: 10,
		sequenceFrameCount: 30,
		sourceStartTicks: '0',
	};
}
