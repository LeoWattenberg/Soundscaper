import test from 'node:test';
import assert from 'node:assert/strict';

import {
	migrateAudioEditorProject,
	migrateAudioEditorProjectV3ToV4,
	migrateAudioEditorProjectV4ToV5,
} from '../src/lib/tools/audio-editor/migration.js';
import { validateAudioEditorProject } from '../src/lib/tools/audio-editor/project.js';
import {
	createAudioClipV2,
	createAudioSourceV2,
	createAudioTrackV2,
} from '../src/lib/tools/audio-editor/project-v2.js';
import { createAudioEditorProjectV3 } from '../src/lib/tools/audio-editor/project-v3.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	createAudioClipV4,
	createAudioEditorProjectV4,
	createAudioSourceV4,
	createAudioTrackV4,
	createLabelTrackV4,
	createVideoClipV4,
	createVideoSourceV4,
	createVideoTrackV4,
	loadAudioEditorProjectV4,
	validateAudioEditorProjectV4,
} from '../src/lib/tools/audio-editor/project-v4.js';

const NOW = '2026-07-18T10:00:00.000Z';

function createV3Fixture() {
	const source = createAudioSourceV2({
		id: 'audio-source',
		name: 'dialogue.wav',
		storageKey: 'pcm/dialogue',
		frameCount: 480_000,
		channelCount: 2,
		sampleRate: 48_000,
		opaqueExtensions: { sourceMarker: true },
	});
	const timelineClip = createAudioClipV2({
		id: 'timeline-audio',
		sourceId: source.id,
		title: 'Timeline dialogue',
		timelineStartFrame: 24_000,
		sourceStartFrame: 48_000,
		sourceDurationFrames: 240_000,
		durationFrames: 192_000,
		trimStartFrames: 48_000,
		trimEndFrames: 192_000,
		gain: 0.75,
		fadeInFrames: 1_200,
		fadeOutFrames: 2_400,
		reversed: true,
		envelope: [{ frame: 0, value: 0.5 }, { frame: 192_000, value: 1 }],
		groupId: 'manual-group',
		color: 'violet',
		pitchCents: 150,
		speedRatio: 1.25,
		preserveFormants: true,
		stretchToTempo: true,
		renderCacheRevision: 9,
		opaqueExtensions: { clipMarker: true },
	});
	const binClip = createAudioClipV2({
		...timelineClip,
		id: 'bin-audio',
		title: 'Reusable dialogue',
		timelineStartFrame: 0,
		groupId: null,
	});
	return createAudioEditorProjectV3({
		id: 'v3-project',
		title: 'V3 project',
		now: NOW,
		updatedAt: '2026-07-18T10:01:00.000Z',
		revision: 17,
		sources: [source],
		clips: [timelineClip],
		tracks: [createAudioTrackV2({
			id: 'audio-track',
			name: 'Dialogue',
			clipIds: [timelineClip.id],
			gain: 0.8,
			pan: -0.25,
			color: 'violet',
			opaqueExtensions: { trackMarker: true },
		})],
		selection: {
			startFrame: 24_000,
			endFrame: 216_000,
			trackIds: ['audio-track'],
			clipIds: [timelineClip.id],
		},
		view: {
			scrollFrame: 12_000,
			playheadFrame: 72_000,
			selectedTrackIds: ['audio-track'],
			panelState: { projectBin: { visible: true } },
		},
		projectBin: {
			clips: [binClip],
			opaqueExtensions: { binMarker: true },
		},
		opaqueExtensions: { projectMarker: true },
	});
}

function createVideoProjectFixture() {
	const frameCount = 480_000;
	const audioSource = createAudioSourceV4({
		id: 'audio-source',
		name: 'camera audio',
		storageKey: 'pcm/camera-audio',
		frameCount,
		channelCount: 2,
		sampleRate: 48_000,
	});
	const videoSource = createVideoSourceV4({
		id: 'video-source',
		name: 'camera.mp4',
		mimeType: 'video/mp4',
		storageKey: 'video/camera',
		frameCount,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 29.97,
		videoCodec: 'avc1',
		audioCodec: 'mp4a',
		hasAudio: true,
		posterStorageKey: 'video/camera/poster',
		thumbnailStorageKey: 'video/camera/thumbnails',
	});
	const audioClip = createAudioClipV4({
		id: 'audio-clip',
		sourceId: audioSource.id,
		title: 'Camera audio',
		timelineStartFrame: 48_000,
		sourceStartFrame: 0,
		sourceDurationFrames: 240_000,
		durationFrames: 240_000,
		trimEndFrames: 240_000,
		avLinkId: 'av-link',
	});
	const videoClip = createVideoClipV4({
		id: 'video-clip',
		sourceId: videoSource.id,
		title: 'Camera video',
		timelineStartFrame: 48_000,
		sourceStartFrame: 0,
		sourceDurationFrames: 240_000,
		durationFrames: 240_000,
		trimEndFrames: 240_000,
		avLinkId: 'av-link',
	});
	const binAudio = createAudioClipV4({
		...audioClip,
		id: 'bin-audio',
		timelineStartFrame: 0,
		avLinkId: null,
		binItemId: 'bin-camera',
	});
	const binVideo = createVideoClipV4({
		...videoClip,
		id: 'bin-video',
		timelineStartFrame: 0,
		avLinkId: null,
		binItemId: 'bin-camera',
	});
	return createAudioEditorProjectV4({
		id: 'video-project',
		title: 'Video project',
		now: NOW,
		sources: [audioSource, videoSource],
		clips: [videoClip, audioClip],
		tracks: [
			createVideoTrackV4({
				id: 'video-track',
				clipIds: [videoClip.id],
				laneGroupId: 'camera-lanes',
			}),
			createAudioTrackV4({
				id: 'audio-track',
				clipIds: [audioClip.id],
				laneGroupId: 'camera-lanes',
			}),
			createLabelTrackV4({ id: 'label-track' }),
		],
		selection: {
			startFrame: 48_000,
			endFrame: 288_000,
			trackIds: ['video-track', 'audio-track'],
			clipIds: ['video-clip', 'audio-clip'],
		},
		view: {
			selectedTrackIds: ['video-track'],
		},
		projectBin: { clips: [binVideo, binAudio] },
	});
}

test('V3 to V4 migration preserves project state and adds audio/bin discriminators atomically', () => {
	const v3 = createV3Fixture();
	const rollback = structuredClone(v3);
	const migrated = migrateAudioEditorProjectV3ToV4(v3);

	assert.deepEqual(v3, rollback);
	assert.equal(migrated.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(migrated.revision, v3.revision);
	assert.equal(migrated.createdAt, v3.createdAt);
	assert.equal(migrated.updatedAt, v3.updatedAt);
	assert.deepEqual(migrated.selection, v3.selection);
	assert.deepEqual(migrated.view, v3.view);
	assert.deepEqual(migrated.opaqueExtensions, v3.opaqueExtensions);
	assert.deepEqual(migrated.projectBin.opaqueExtensions, v3.projectBin.opaqueExtensions);
	assert.deepEqual(migrated.sources[0], { ...v3.sources[0], kind: 'audio' });
	assert.deepEqual(migrated.clips[0], {
		...v3.clips[0],
		kind: 'audio',
		avLinkId: null,
		binItemId: null,
	});
	assert.deepEqual(migrated.tracks[0], { ...v3.tracks[0], laneGroupId: null });
	assert.deepEqual(migrated.projectBin.clips[0], {
		...v3.projectBin.clips[0],
		kind: 'audio',
		avLinkId: null,
		binItemId: v3.projectBin.clips[0].id,
	});
	assert.equal(validateAudioEditorProjectV4(migrated), true);
	assert.equal(validateAudioEditorProject(migrated), true);
	const current = migrateAudioEditorProjectV4ToV5(migrated);
	assert.deepEqual(migrateAudioEditorProject(v3), {
		project: current,
		migrated: true,
		fromVersion: 3,
		readOnly: false,
		reason: null,
	});
	assert.equal(migrateAudioEditorProject(migrated).migrated, true);
	assert.equal(migrateAudioEditorProject(current).migrated, false);
});

test('V4 validates paired lanes, linked timeline clips, and compound Project Bin items', () => {
	const project = createVideoProjectFixture();
	assert.equal(validateAudioEditorProjectV4(project), true);
	assert.equal(validateAudioEditorProject(project), true);
	assert.deepEqual(loadAudioEditorProjectV4(project), {
		project,
		readOnly: false,
		reason: null,
	});

	const future = { ...project, schemaVersion: 6, futureData: { retained: true } };
	assert.deepEqual(loadAudioEditorProjectV4(future), {
		project: future,
		readOnly: true,
		reason: 'newer-schema',
	});
	assert.deepEqual(migrateAudioEditorProject(future), {
		project: future,
		migrated: false,
		fromVersion: 6,
		readOnly: true,
		reason: 'newer-schema',
	});
});

test('V4 rejects cross-media references and partial A/V or lane relationships', () => {
	const project = createVideoProjectFixture();
	const invalidSource = structuredClone(project);
	invalidSource.clips.find((clip) => clip.kind === 'video').sourceId = 'audio-source';
	assert.throws(() => validateAudioEditorProjectV4(invalidSource), /cannot reference an audio source/);
	assert.throws(() => validateAudioEditorProject(invalidSource), /cannot reference an audio source/);

	const misaligned = structuredClone(project);
	misaligned.clips.find((clip) => clip.kind === 'audio').timelineStartFrame += 1;
	assert.throws(() => validateAudioEditorProjectV4(misaligned), /aligned timeline ranges/);

	const unpairedLane = structuredClone(project);
	unpairedLane.tracks[1].laneGroupId = null;
	assert.throws(() => validateAudioEditorProjectV4(unpairedLane), /adjacent video\/audio track pair/);

	const nonAdjacentLane = structuredClone(project);
	nonAdjacentLane.tracks = [
		nonAdjacentLane.tracks[0],
		nonAdjacentLane.tracks[2],
		nonAdjacentLane.tracks[1],
	];
	assert.throws(() => validateAudioEditorProjectV4(nonAdjacentLane), /adjacent video\/audio track pair/);
});

test('V4 accepts proper video crossfades and rejects ambiguous overlap geometry', () => {
	const edgeOverlap = createVideoProjectFixture();
	edgeOverlap.clips.push({
		...edgeOverlap.clips.find((clip) => clip.kind === 'video'),
		id: 'overlapping-video',
		avLinkId: null,
		timelineStartFrame: 96_000,
	});
	edgeOverlap.tracks[0].clipIds.push('overlapping-video');
	assert.equal(validateAudioEditorProjectV4(edgeOverlap), true);
	assert.equal(validateAudioEditorProject(edgeOverlap), true);
	assert.equal(loadAudioEditorProjectV4(edgeOverlap).readOnly, false);

	const nested = structuredClone(edgeOverlap);
	nested.clips.find((clip) => clip.id === 'overlapping-video').durationFrames = 48_000;
	assert.throws(() => validateAudioEditorProjectV4(nested), /proper edge transition/);
	assert.throws(() => validateAudioEditorProject(nested), /proper edge transition/);

	const equalEnd = structuredClone(edgeOverlap);
	equalEnd.clips.find((clip) => clip.id === 'overlapping-video').durationFrames = 192_000;
	assert.throws(() => validateAudioEditorProjectV4(equalEnd), /proper edge transition/);

	const threeWay = structuredClone(edgeOverlap);
	threeWay.clips.push({
		...threeWay.clips.find((clip) => clip.id === 'overlapping-video'),
		id: 'third-video',
		timelineStartFrame: 144_000,
	});
	threeWay.tracks[0].clipIds.push('third-video');
	assert.throws(() => validateAudioEditorProjectV4(threeWay), /three-way transition/);
	assert.throws(() => validateAudioEditorProject(threeWay), /three-way transition/);
});

test('V4 keeps timeline and Project Bin relationship IDs in separate domains', () => {
	const project = createVideoProjectFixture();
	const timelineBinId = structuredClone(project);
	timelineBinId.clips[0].binItemId = 'bin-camera';
	assert.throws(() => validateAudioEditorProjectV4(timelineBinId), /Timeline clip .* bin item ID/);

	const binAvLink = structuredClone(project);
	binAvLink.projectBin.clips[0].avLinkId = 'av-link';
	assert.throws(() => validateAudioEditorProjectV4(binAvLink), /Project Bin clip .* A\/V link ID/);

	const missingBinId = structuredClone(project);
	missingBinId.projectBin.clips[0].binItemId = null;
	assert.throws(() => validateAudioEditorProjectV4(missingBinId), /binItemId must be a non-empty string/);

	const duplicateKind = structuredClone(project);
	duplicateKind.projectBin.clips[1] = {
		...duplicateKind.projectBin.clips[0],
		id: 'second-bin-video',
	};
	assert.throws(() => validateAudioEditorProjectV4(duplicateKind), /at most one audio and one video clip/);
});
