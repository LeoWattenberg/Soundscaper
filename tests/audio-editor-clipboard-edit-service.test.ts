/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipboardEditService,
	type ClipboardEditProject,
	type ClipboardEditServiceDependencies,
} from '../src/common/editor/controller/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import type { AudioEditorClipboard, AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function audioClipboard(): AudioEditorClipboard {
	return {
		schemaVersion: 2,
		sampleRate: 1_000,
		durationFrames: 20,
		tracks: [{
			sourceTrackId: 'origin-audio',
			sourceTrackName: 'Copied audio',
			sourceTrackType: 'audio',
			clips: [{ key: 'audio:0:20', kind: 'audio', sourceId: 'source-a', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }],
		}],
	};
}

function project(overrides: Partial<ClipboardEditProject> = {}): ClipboardEditProject {
	return {
		id: 'project-a',
		schemaVersion: 5,
		sampleRate: 1_000,
		sources: [{ id: 'source-a' }],
		tracks: [{ id: 'track-a', name: 'Audio', type: 'audio', clipIds: ['clip-a'] }],
		clips: [{
			id: 'clip-a', sourceId: 'source-a', kind: 'audio', title: 'Audio',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
		}],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: ['clip-a'] },
		...overrides,
	};
}

function createFixture(projectValue = project(), overrides: Partial<ClipboardEditServiceDependencies> = {}) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const clipboard = audioClipboard();
	const state = {
		selectedTrackId: 'track-a' as string | null,
		selectedClipId: 'clip-a' as string | null,
		clipboard: clipboard as AudioEditorClipboard | null,
	};
	const commits: Array<Readonly<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}>> = [];
	const statuses: Array<Readonly<{ message: string; state?: string }>> = [];
	const sourceBuffers = new Map<string, Readonly<{
		sampleRate: number;
		numberOfChannels: number;
		getChannelData(channel: number): Float32Array;
	}>>();
	let activeProject = projectValue;
	let nextId = 0;
	const dependencies: ClipboardEditServiceDependencies = {
		lifetime,
		state,
		copy: { noSilencesFound: 'No silences found.', track: 'Track' },
		getProject: () => activeProject,
		editingBlocked: () => false,
		getPositionFrames: () => 50,
		normalizeFrame: (value) => Math.max(0, Math.round(Number(value))),
		snapFrame: (value) => Math.round(Number(value) / 5) * 5,
		createId: (prefix) => `${prefix}-${++nextId}`,
		commit: (command, selection) => { commits.push({ command, selection }); },
		setStatus: (message, nextState) => { statuses.push({ message, state: nextState }); },
		session: {
			setClipboard: (descriptor) => ({ clipboard: { descriptor, sources: [] } }),
			clipboardForProject: () => ({
				descriptor: clipboard,
				sources: [{ id: 'source-a' }],
			}),
		},
		sourceBuffers,
		...overrides,
	};
	return {
		commits,
		dependencies,
		lifetime,
		replaceProject(nextProject: ClipboardEditProject) { activeProject = nextProject; },
		sourceBuffers,
		state,
		statuses,
	};
}

test('split preparation expands an A/V link once and assigns every replay ID before commit', () => {
	const linkedProject = project({
		tracks: [
			{ id: 'video-track', name: 'Video', type: 'video', laneGroupId: 'lanes', clipIds: ['video'] },
			{ id: 'track-a', name: 'Audio', type: 'audio', laneGroupId: 'lanes', clipIds: ['clip-a'] },
		],
		clips: [
			{ id: 'video', sourceId: 'video-source', kind: 'video', title: 'Video', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, avLinkId: 'av-a', videoEffects: [{ id: 'fx-a' }] },
			{ id: 'clip-a', sourceId: 'source-a', kind: 'audio', title: 'Audio', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, avLinkId: 'av-a' },
		],
	});
	const fixture = createFixture(linkedProject);
	const service = createClipboardEditService(fixture.dependencies);

	service.splitAtFrame(48);

	assert.equal(fixture.commits.length, 1);
	const command = fixture.commits[0]?.command;
	assert.equal(command?.type, 'clip/split');
	if (command?.type !== 'clip/split') return;
	assert.equal(command.atFrame, 50);
	assert.equal(command.rightClipId, 'clip-1');
	assert.equal(command.linkedRightClipId, 'clip-2');
	assert.equal(command.rightAvLinkId, 'av-link-3');
	assert.deepEqual(
		command.rightVideoEffectIds ?? command.linkedRightVideoEffectIds,
		['video-effect-4'],
	);
});

test('multiple split boundaries are prepared descending in one atomic batch', () => {
	const fixture = createFixture();
	const service = createClipboardEditService(fixture.dependencies);

	service.commitSplitAtFrames([25, 75, 25]);

	const batch = fixture.commits[0]?.command;
	assert.equal(batch?.type, 'batch');
	if (batch?.type !== 'batch') return;
	assert.deepEqual(batch.commands.map((command) => command.type === 'clip/split' ? command.atFrame : null), [75, 25]);
	assert.deepEqual(batch.commands.map((command) => command.type === 'clip/split' ? command.rightClipId : null), ['clip-1', 'clip-2']);
});

test('cross-project A/V paste prepares sources, paired lanes, and paste as one batch', () => {
	const clipboard: AudioEditorClipboard = {
		schemaVersion: 2,
		sampleRate: 1_000,
		durationFrames: 20,
		tracks: [
			{ sourceTrackId: 'video-origin', sourceTrackName: 'Video', sourceTrackType: 'video', sourceLaneGroupId: 'source-lanes', clips: [{ key: 'video', kind: 'video', sourceId: 'video-source', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }] },
			{ sourceTrackId: 'audio-origin', sourceTrackName: 'Audio', sourceTrackType: 'audio', sourceLaneGroupId: 'source-lanes', clips: [{ key: 'audio', kind: 'audio', sourceId: 'audio-source', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }] },
		],
	};
	const fixture = createFixture(project({ sources: [], tracks: [], clips: [], selection: null }), {
		session: {
			setClipboard: (descriptor) => ({ clipboard: { descriptor, sources: [] } }),
			clipboardForProject: () => ({
				descriptor: clipboard,
				sources: [{
					schemaVersion: 5, kind: 'video', id: 'video-source', storageKey: 'video-source',
					name: 'Video', mimeType: 'video/mp4', frameCount: 20, channelCount: 0,
					sampleRate: 1_000, originalSampleRate: 1_000, width: 320, height: 180,
					frameRate: 25, videoCodec: 'avc1', audioCodec: null, hasAudio: false,
				}, {
					schemaVersion: 5, kind: 'audio', id: 'audio-source', storageKey: 'audio-source',
					name: 'Audio', mimeType: 'audio/wav', frameCount: 20, channelCount: 1,
					sampleRate: 1_000, originalSampleRate: 1_000,
				}],
			}),
		},
	});
	fixture.state.selectedTrackId = null;
	fixture.state.selectedClipId = null;
	fixture.state.clipboard = clipboard;
	const service = createClipboardEditService(fixture.dependencies);

	const command = service.prepareControllerPaste('overlap', 40);

	assert.equal(command.type, 'batch');
	if (command.type !== 'batch') return;
	assert.deepEqual(command.commands.map(({ type }) => type), [
		'source/add', 'source/add', 'track/add', 'track/add', 'clipboard/paste',
	]);
	const tracks = command.commands.filter((entry) => entry.type === 'track/add');
	assert.equal(tracks.length, 2);
	assert.equal(tracks[0]?.type === 'track/add' ? tracks[0].track.laneGroupId : null, 'media-lanes-1');
	assert.equal(tracks[1]?.type === 'track/add' ? tracks[1].track.laneGroupId : null, 'media-lanes-1');
	const paste = command.commands.at(-1);
	assert.equal(paste?.type, 'clipboard/paste');
	if (paste?.type === 'clipboard/paste') {
		assert.equal(paste.trackMap?.['video-origin'], 'video-track-2');
		assert.equal(paste.trackMap?.['audio-origin'], 'track-3');
	}
});

test('disjoin removes only bounded silence and commits its splits atomically', async () => {
	const fixture = createFixture();
	const samples = new Float32Array(100).fill(1);
	samples.fill(0, 10, 30);
	fixture.sourceBuffers.set('source-a', {
		sampleRate: 1_000,
		numberOfChannels: 1,
		getChannelData: () => samples,
	});
	const service = createClipboardEditService(fixture.dependencies);

	await service.disjoinSelectedClip();

	const batch = fixture.commits[0]?.command;
	assert.equal(batch?.type, 'batch');
	if (batch?.type !== 'batch') return;
	assert.deepEqual(batch.commands.map((command) => command.type), ['clip/split', 'clip/split', 'clip/remove']);
	assert.deepEqual(batch.commands.slice(0, 2).map((command) => command.type === 'clip/split' ? command.atFrame : null), [30, 10]);
	assert.equal(batch.commands[2]?.type === 'clip/remove' ? batch.commands[2].clipId : null, 'clip-2');
	assert.deepEqual(fixture.commits[0]?.selection, { selectClipId: 'clip-a' });
});

test('setting the session clipboard updates the controller descriptor', () => {
	const fixture = createFixture();
	const service = createClipboardEditService(fixture.dependencies);
	const descriptor = audioClipboard();

	assert.equal(service.setSessionClipboard(descriptor), descriptor);
	assert.equal(fixture.state.clipboard, descriptor);
});

test('blocked and out-of-range splits do not create history entries', () => {
	const blocked = createFixture(project(), { editingBlocked: () => true });
	const blockedService = createClipboardEditService(blocked.dependencies);
	assert.equal(blockedService.splitAtFrame(50), null);
	assert.equal(blocked.commits.length, 0);

	const outside = createFixture();
	const outsideService = createClipboardEditService(outside.dependencies);
	assert.equal(outsideService.commitSplitAtFrames([0, 100], 'track-a'), null);
	assert.equal(outside.commits.length, 0);
});

test('track selection is used when there is no active clip seed', () => {
	const fixture = createFixture();
	fixture.state.selectedClipId = null;
	const service = createClipboardEditService(fixture.dependencies);

	service.commitSplitAtFrames([50]);

	assert.equal(fixture.commits[0]?.command.type, 'clip/split');
});

test('paste reuses a compatible origin track and supports legacy inferred track type', () => {
	const clipboard: AudioEditorClipboard = {
		schemaVersion: 1,
		sampleRate: 1_000,
		durationFrames: 20,
		tracks: [{
			sourceTrackId: 'track-a',
			sourceTrackName: 'Audio',
			clips: [{ key: 'audio', kind: 'audio', sourceId: 'source-a', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }],
		}],
	};
	const fixture = createFixture();
	fixture.state.clipboard = clipboard;
	const service = createClipboardEditService(fixture.dependencies);

	const command = service.prepareControllerPaste('overlap');

	assert.equal(command.type, 'clipboard/paste');
	if (command.type === 'clipboard/paste') assert.equal(command.trackMap?.['track-a'], 'track-a');
});

test('missing clipboard and legacy video paste fail before command publication', () => {
	const missing = createFixture();
	missing.state.clipboard = null;
	const missingService = createClipboardEditService(missing.dependencies);
	assert.throws(() => missingService.prepareControllerPaste('overlap'), /clipboard/u);

	const videoClipboard: AudioEditorClipboard = {
		schemaVersion: 2,
		sampleRate: 1_000,
		durationFrames: 20,
		tracks: [{
			sourceTrackId: 'video-origin', sourceTrackName: 'Video', sourceTrackType: 'video',
			clips: [{ key: 'video', kind: 'video', sourceId: 'video-source', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }],
		}],
	};
	const legacy = createFixture(project({ schemaVersion: 3, sources: [], tracks: [], clips: [] }), {
		session: {
			setClipboard: (descriptor) => ({ clipboard: { descriptor, sources: [] } }),
			clipboardForProject: () => ({ descriptor: videoClipboard, sources: [] }),
		},
	});
	legacy.state.clipboard = videoClipboard;
	const legacyService = createClipboardEditService(legacy.dependencies);
	assert.throws(() => legacyService.prepareControllerPaste('overlap'), /AudioEditorProjectV4/u);
});

test('disjoin reports audio with no bounded silence', async () => {
	const fixture = createFixture();
	const samples = new Float32Array(100).fill(1);
	fixture.sourceBuffers.set('source-a', {
		sampleRate: 1_000,
		numberOfChannels: 1,
		getChannelData: () => samples,
	});
	const service = createClipboardEditService(fixture.dependencies);

	await service.disjoinSelectedClip();

	assert.equal(fixture.commits.length, 0);
	assert.deepEqual(fixture.statuses, [{ message: 'No silences found.', state: 'info' }]);
});

test('paste-created tracks join the folder of the selected track on a foldered project', () => {
	const foldered = project({
		schemaVersion: 13,
		trackFolders: [{ id: 'band' }],
		primarySequenceId: 'main',
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'band', parentFolderId: null },
				{ kind: 'track', id: 'track-a', parentFolderId: 'band' },
			],
		}],
	});
	const fixture = createFixture(foldered);
	// Two clipboard tracks against one selected target: the second cannot be
	// matched and must be synthesized beside the selected track's folder.
	fixture.state.clipboard = {
		schemaVersion: 2,
		sampleRate: 1_000,
		durationFrames: 20,
		tracks: [
			{ sourceTrackId: 'origin-a', sourceTrackName: 'One', sourceTrackType: 'audio', clips: [{ key: 'a', kind: 'audio', sourceId: 'source-a', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }] },
			{ sourceTrackId: 'origin-b', sourceTrackName: 'Two', sourceTrackType: 'audio', clips: [{ key: 'b', kind: 'audio', sourceId: 'source-a', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20 }] },
		],
	};
	const service = createClipboardEditService(fixture.dependencies);
	const command = service.prepareControllerPaste('overlap', 40);

	assert.equal(command.type, 'batch');
	if (command.type !== 'batch') return;
	const added = command.commands.find((entry) => entry.type === 'track/add');
	assert.equal(added?.type, 'track/add');
	if (added?.type === 'track/add') {
		assert.equal(added.sequenceId, 'main');
		assert.equal(added.parentFolderId, 'band');
	}
});

test('paste-created tracks fall back to the sequence root without an anchored folder', () => {
	const foldered = project({
		schemaVersion: 13,
		tracks: [],
		clips: [],
		selection: null,
		trackFolders: [{ id: 'band' }],
		primarySequenceId: 'main',
		sequences: [{
			id: 'main',
			trackNodes: [{ kind: 'folder', id: 'band', parentFolderId: null }],
		}],
	});
	const fixture = createFixture(foldered);
	fixture.state.selectedTrackId = null;
	fixture.state.selectedClipId = null;
	const service = createClipboardEditService(fixture.dependencies);
	const command = service.prepareControllerPaste('overlap', 0);

	assert.equal(command.type, 'batch');
	if (command.type !== 'batch') return;
	const added = command.commands.find((entry) => entry.type === 'track/add');
	assert.equal(added?.type, 'track/add');
	if (added?.type === 'track/add') {
		assert.equal(added.sequenceId, 'main');
		assert.equal(added.parentFolderId, null);
	}
});
