/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipboardEditService,
	type ClipboardEditProject,
	type ClipboardEditServiceDependencies,
} from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function project(overrides: Partial<ClipboardEditProject> = {}): ClipboardEditProject {
	return {
		id: 'project-a',
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		sampleRate: 1_000,
		sources: [{ id: 'source-a' }],
		tracks: [{ id: 'audio-track', name: 'Audio', type: 'audio', clipIds: ['audio-clip'] }],
		clips: [{
			id: 'audio-clip', sourceId: 'source-a', kind: 'audio', title: 'Audio',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
		}],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['audio-track'], clipIds: ['audio-clip'] },
		...overrides,
	};
}

function createSplitFixture(
	projectValue: ClipboardEditProject,
	focus: Readonly<{ trackId: string | null; clipId: string | null }>,
) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const commits: AudioEditorCommand[] = [];
	const sourceBuffers = new Map();
	let nextId = 0;
	const dependencies: ClipboardEditServiceDependencies = {
		lifetime,
		state: { selectedTrackId: focus.trackId, selectedClipId: focus.clipId, clipboard: null },
		copy: { noSilencesFound: 'No silences found.', track: 'Track' },
		session: {
			setClipboard: (descriptor) => ({ clipboard: { descriptor, sources: [] } }),
			clipboardForProject: () => null,
		},
		sourceBuffers,
		getProject: () => projectValue,
		editingBlocked: () => false,
		getPositionFrames: () => 50,
		normalizeFrame: (value) => Math.max(0, Math.round(Number(value))),
		snapFrame: (value) => Math.round(Number(value)),
		createId: (prefix = 'id') => `${prefix}-${String(++nextId)}`,
		commit: (command) => { commits.push(command); },
		setStatus: () => undefined,
	};
	return { commits, service: createClipboardEditService(dependencies), sourceBuffers };
}

test('Split execution uses a persisted clip without focus and falls back from stale persistence', () => {
	const persisted = createSplitFixture(project(), { trackId: null, clipId: null });
	persisted.service.commitSplitAtFrames([50]);
	assert.equal(persisted.commits[0]?.type, 'clip/split');

	const stale = createSplitFixture(project({
		selection: { startFrame: 0, endFrame: 0, trackIds: ['missing-track'], clipIds: ['missing-clip'] },
	}), { trackId: 'audio-track', clipId: 'audio-clip' });
	stale.service.commitSplitAtFrames([50]);
	assert.equal(stale.commits[0]?.type, 'clip/split');
});

test('Split execution accepts a selected video track as its exact target', () => {
	const fixture = createSplitFixture(project({
		tracks: [{ id: 'video-track', name: 'Video', type: 'video', clipIds: ['video-clip'] }],
		clips: [{
			id: 'video-clip', sourceId: 'video-source', kind: 'video', title: 'Video',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
		}],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['video-track'], clipIds: [] },
	}), { trackId: null, clipId: null });
	fixture.service.commitSplitAtFrames([50]);
	assert.equal(fixture.commits[0]?.type, 'clip/split');
});

test('Disjoin execution expands a persisted clip through its edit group', async () => {
	const grouped = project({
		tracks: [{ id: 'audio-track', name: 'Audio', type: 'audio', clipIds: ['audio-clip', 'peer-clip'] }],
		clips: [
			{
				id: 'audio-clip', sourceId: 'source-a', kind: 'audio', title: 'Audio', groupId: 'group-a',
				timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
			},
			{
				id: 'peer-clip', sourceId: 'source-a', kind: 'audio', title: 'Peer', groupId: 'group-a',
				timelineStartFrame: 200, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
			},
		],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: ['audio-clip'] },
	});
	const fixture = createSplitFixture(grouped, { trackId: null, clipId: null });
	const samples = new Float32Array(100).fill(1);
	samples.fill(0, 10, 30);
	fixture.sourceBuffers.set('source-a', {
		sampleRate: 1_000,
		numberOfChannels: 1,
		getChannelData: () => samples,
	});
	await fixture.service.disjoinSelectedClip();
	const batch = fixture.commits[0];
	assert.equal(batch?.type, 'batch');
	if (batch?.type !== 'batch') return;
	assert.deepEqual(
		[...new Set(batch.commands.flatMap((command) => (
			command.type === 'clip/split' ? [command.clipId] : []
		)))],
		['audio-clip', 'peer-clip'],
	);
});
