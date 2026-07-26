import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import {
	createClipTransformService,
} from '../src/common/editor/controller/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-domain-types.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

test('clip moves preserve selected companions, selection offsets, and one atomic command', () => {
	const project = projectFixture();
	const harness = createHarness(project);

	harness.service.moveClips('active', 'track-b', 250);

	assert.equal(harness.commits.length, 1);
	const command = harness.commits[0]?.command;
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected an atomic move batch.');
	const transform = command.commands[0];
	assert.equal(transform?.type, 'clip/transform-many');
	if (transform?.type !== 'clip/transform-many') assert.fail('Expected a grouped clip transform.');
	assert.deepEqual(transform.transforms, [{
		clipId: 'active', trackId: 'track-b', changes: { timelineStartFrame: 250 },
	}, {
		clipId: 'companion', trackId: 'track-c', changes: { timelineStartFrame: 350 },
	}]);
	assert.deepEqual(command.commands[1], {
		type: 'selection/set',
		startFrame: 200,
		endFrame: 500,
		trackIds: ['track-b', 'track-c'],
		clipIds: ['active', 'companion'],
		frequencyRange: null,
	});
	assert.deepEqual(harness.commits[0]?.selection, {
		selectTrackId: 'track-b', selectClipId: 'active',
	});
});

test('moving linked video media to new tracks reserves a paired lane atomically', () => {
	const project = projectFixture({
		schemaVersion: 4,
		tracks: [{
			id: 'video-track', name: 'Picture', type: 'video', clipIds: ['video'],
			laneGroupId: 'lane', height: 220,
		}, {
			id: 'audio-track', name: 'Picture Audio', type: 'audio', clipIds: ['audio'],
			laneGroupId: 'lane', channelCount: 2, color: 'blue',
		}],
		clips: [clipFixture({
			id: 'video', kind: 'video', sourceId: 'video-source', avLinkId: 'link',
			timelineStartFrame: 100,
		}), clipFixture({
			id: 'audio', kind: 'audio', sourceId: 'source', avLinkId: 'link',
			timelineStartFrame: 100,
		})],
		selection: {
			startFrame: 0, endFrame: 0,
			trackIds: ['video-track', 'audio-track'], clipIds: ['video', 'audio'],
			frequencyRange: null,
		},
	});
	const harness = createHarness(project);

	const targetTrackId = harness.service.moveClipsToNewTrack('video', 400);

	assert.equal(targetTrackId, 'video-track-2');
	const command = harness.commits[0]?.command;
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected one media-lane batch.');
	assert.deepEqual(command.commands.map((entry) => entry.type), [
		'track/add', 'track/add', 'clip/transform-many', 'selection/set',
	]);
	const added = command.commands.slice(0, 2);
	assert.deepEqual(added.map((entry) => entry.type === 'track/add' ? entry.track.type : null), ['video', 'audio']);
	assert.deepEqual(added.map((entry) => entry.type === 'track/add' ? entry.track.laneGroupId : null), [
		'media-lane-1', 'media-lane-1',
	]);
	const transform = command.commands[2];
	assert.equal(transform?.type, 'clip/transform-many');
	if (transform?.type !== 'clip/transform-many') assert.fail('Expected a linked media transform.');
	assert.deepEqual(transform.transforms.map(({ clipId, trackId, changes }) => ({
		clipId, trackId, timelineStartFrame: changes.timelineStartFrame,
	})), [{
		clipId: 'video', trackId: 'video-track-2', timelineStartFrame: 400,
	}, {
		clipId: 'audio', trackId: 'track-3', timelineStartFrame: 400,
	}]);
});

test('shared trims preserve source ratios and reversed-edge accounting', () => {
	const project = projectFixture({
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['forward'] }, {
			id: 'track-b', name: 'B', type: 'audio', clipIds: ['reverse'],
		}],
		clips: [clipFixture({
			id: 'forward', sourceStartFrame: 100, sourceDurationFrames: 400,
			durationFrames: 200, groupId: 'group', speedRatio: 2,
		}), clipFixture({
			id: 'reverse', sourceStartFrame: 200, sourceDurationFrames: 400,
			timelineStartFrame: 300, durationFrames: 200, groupId: 'group',
			speedRatio: 2, reversed: true,
		})],
		selection: {
			startFrame: 0, endFrame: 0, trackIds: ['track-a', 'track-b'],
			clipIds: ['forward', 'reverse'], frequencyRange: null,
		},
	});
	const harness = createHarness(project);

	harness.service.trimClips('forward', { durationFrames: 150 });

	const command = harness.commits[0]?.command;
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected a shared trim transform.');
	assert.deepEqual(command.transforms.map(({ clipId, changes }) => ({ clipId, changes })), [{
		clipId: 'forward',
		changes: {
			sourceStartFrame: 100, sourceDurationFrames: 300, durationFrames: 150,
			trimStartFrames: 0, trimEndFrames: 100,
			fadeInFrames: 0, fadeOutFrames: 0,
		},
	}, {
		clipId: 'reverse',
		changes: {
			sourceStartFrame: 300, sourceDurationFrames: 300, durationFrames: 150,
			trimStartFrames: 100, trimEndFrames: 0,
			fadeInFrames: 0, fadeOutFrames: 0,
		},
	}]);
});

test('overwrite preparation assigns stable split IDs before the command is committed', () => {
	const project = projectFixture({
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active', 'under'] }],
		clips: [clipFixture({ id: 'active', timelineStartFrame: 300, durationFrames: 200 }), clipFixture({
			id: 'under', timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 1_000, durationFrames: 1_000,
		})],
		selection: null,
	});
	const harness = createHarness(project);

	harness.service.overwriteClips('active', 'track-a', { timelineStartFrame: 400 });

	const command = harness.commits[0]?.command;
	assert.equal(command?.type, 'clip/overwrite');
	if (command?.type !== 'clip/overwrite') assert.fail('Expected an overwrite command.');
	assert.deepEqual(command.splitClipIds, { under: 'clip-1' });
	assert.deepEqual(command.changes, { timelineStartFrame: 400 });
});

test('single-clip move and V2 new-track moves preserve direct command and selection behavior', () => {
	const project = projectFixture({
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active'] }],
		clips: [clipFixture({ id: 'active', timelineStartFrame: 100 })],
		selection: null,
	});
	const harness = createHarness(project);

	harness.service.moveClips('active', null, 50);
	assert.equal(harness.commits[0]?.command.type, 'clip/transform-many');
	if (harness.commits[0]?.command.type !== 'clip/transform-many') assert.fail('Expected a direct move.');
	assert.deepEqual(harness.commits[0].command.transforms, [{
		clipId: 'active', trackId: 'track-a', changes: { timelineStartFrame: 50 },
	}]);

	assert.equal(harness.service.moveClipsToNewTrack('active', -100), 'track-1');
	const command = harness.commits[1]?.command;
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected one new-track batch.');
	assert.deepEqual(command.commands.map((entry) => entry.type), ['track/add', 'clip/transform-many']);
	const transform = command.commands[1];
	assert.equal(transform?.type, 'clip/transform-many');
	if (transform?.type !== 'clip/transform-many') assert.fail('Expected a new-track transform.');
	assert.equal(transform.transforms[0]?.changes.timelineStartFrame, 0, 'moves clamp at the timeline origin');
});

test('V4 drops redirect across a media lane and invalid destinations fail before commit', () => {
	const media = projectFixture({
		schemaVersion: 4,
		tracks: [{
			id: 'video-track', name: 'Video', type: 'video', clipIds: ['video'], laneGroupId: 'lane',
		}, {
			id: 'audio-track', name: 'Audio', type: 'audio', clipIds: [], laneGroupId: 'lane',
		}],
		clips: [clipFixture({ id: 'video', kind: 'video', sourceId: 'video-source' })],
		sources: [{ id: 'video-source', frameCount: 4_000 }],
		selection: null,
	});
	const mediaHarness = createHarness(media);
	mediaHarness.service.moveClips('video', 'audio-track', 320);
	assert.deepEqual(mediaHarness.commits[0]?.selection, {
		selectTrackId: 'video-track', selectClipId: 'video',
	});

	const invalid = createHarness(projectFixture());
	assert.throws(() => invalid.service.moveClips('missing', 'track-a', 0), /Audio clip/);
	assert.throws(() => invalid.service.moveClipsToNewTrack('missing'), /Audio clip/);
	assert.throws(() => invalid.service.moveClips('active', 'track-c', 0), /beyond the available/);
	assert.deepEqual(invalid.commits, []);
});

test('trim paths cover no-op, direct metadata, left edges, bounds, and invalid frames', () => {
	const project = projectFixture({
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active'] }],
		clips: [clipFixture({
			id: 'active', timelineStartFrame: 100, sourceStartFrame: 200,
			sourceDurationFrames: 400, durationFrames: 200, speedRatio: 2,
		})],
		selection: null,
	});
	const harness = createHarness(project);

	assert.equal(harness.service.trimClips('active'), project);
	assert.equal(harness.commits.length, 0);
	harness.service.trimClips('active', { sourceStartFrame: 220 });
	assert.deepEqual(harness.commits[0]?.command, {
		type: 'clip/trim', clipId: 'active', sourceStartFrame: 220,
	});
	harness.service.trimClips('active', { timelineStartFrame: 150 });
	const command = harness.commits[1]?.command;
	assert.equal(command?.type, 'clip/trim');
	if (command?.type !== 'clip/trim') assert.fail('Expected a left trim.');
	assert.deepEqual({
		timelineStartFrame: command.timelineStartFrame,
		sourceStartFrame: command.sourceStartFrame,
		sourceDurationFrames: command.sourceDurationFrames,
		durationFrames: command.durationFrames,
	}, {
		timelineStartFrame: 150, sourceStartFrame: 300,
		sourceDurationFrames: 300, durationFrames: 150,
	});
	harness.service.trimClips('active', { durationFrames: 200 });
	assert.equal(harness.commits.length, 2, 'zero-delta trims do not create history');
	assert.throws(
		() => harness.service.trimClips('active', { durationFrames: Number.POSITIVE_INFINITY }),
		/Timeline frames/,
	);
	assert.throws(() => harness.service.trimClips('missing', { durationFrames: 1 }), /Audio clip/);
});

test('group overwrite delegates to atomic trim and move transforms and edit blocking is uniform', () => {
	const project = projectFixture();
	const harness = createHarness(project);

	harness.service.overwriteClips('active', 'track-a', { durationFrames: 900 });
	let command = harness.commits[0]?.command;
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected grouped overwrite trim.');
	assert.equal(command.overwrite, true);
	harness.service.overwriteClips('active', 'track-a', { timelineStartFrame: 300 });
	command = harness.commits[1]?.command;
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected grouped overwrite move.');
	assert.equal(command.commands[0]?.type, 'clip/transform-many');
	if (command.commands[0]?.type === 'clip/transform-many') {
		assert.equal(command.commands[0].overwrite, true);
	}

	harness.setBlocked(true);
	assert.equal(harness.service.moveClips('active', 'track-a', 0), null);
	assert.equal(harness.service.moveClipsToNewTrack('active'), null);
	assert.equal(harness.service.trimClips('active', { durationFrames: 1 }), null);
});

function createHarness(project: ClipTransformProject) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const commits: Array<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}> = [];
	let blocked = false;
	let nextId = 0;
	const service = createClipTransformService({
		lifetime,
		copy: {
			audioClipNotFound: 'Audio clip not found.', track: 'Track',
			timelineFramesFinite: 'Timeline frames must be finite.',
		},
		getProject: () => project,
		getSelectedClipId: () => 'active',
		editingBlocked: () => blocked,
		createId: (prefix) => `${prefix}-${++nextId}`,
		snapTimelineFrame: (frame) => Math.round(Number(frame)),
		activeSelection: () => project.selection?.endFrame !== project.selection?.startFrame
			? project.selection ?? null
			: null,
		commit: (command, selection) => {
			commits.push({ command, ...(selection ? { selection } : {}) });
			return project;
		},
	});
	return { commits, service, setBlocked(value: boolean) { blocked = value; } };
}

function projectFixture(overrides: Partial<ClipTransformProject> = {}): ClipTransformProject {
	return {
		schemaVersion: 2,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active'] }, {
			id: 'track-b', name: 'B', type: 'audio', clipIds: ['companion'],
		}, { id: 'track-c', name: 'C', type: 'audio', clipIds: [] }],
		clips: [clipFixture({ id: 'active', timelineStartFrame: 100 }), clipFixture({
			id: 'companion', timelineStartFrame: 200,
		})],
		sources: [{
			id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
			frameCount: 4_000, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		}],
		selection: {
			startFrame: 50, endFrame: 350,
			trackIds: ['track-a', 'track-b'], clipIds: ['active', 'companion'],
			frequencyRange: null,
		},
		...overrides,
	};
}

function clipFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'active', sourceId: 'source', title: 'Clip', kind: 'audio' as const,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 1_000,
		durationFrames: 1_000, trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		envelope: [], groupId: null, avLinkId: null, pitchCents: 0, speedRatio: 1,
		preserveFormants: false, stretchToTempo: false, renderCacheRevision: 0,
		opaqueExtensions: {},
		...overrides,
	};
}
