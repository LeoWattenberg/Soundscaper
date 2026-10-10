/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipboardEditService, type ClipboardEditProject } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { mergeLabeledAudioRegions } from '../src/common/editor/labeled-audio-regions.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	undoSoundscaperProjectCommand, redoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';

for (const touching of [false, true]) test(`detach silence under ${touching ? 'two touching labels' : 'one label'} remains atomic`, async context => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000,
		frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', title: 'Interview', sourceId: source.id,
		timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const original = createSoundscaperProject({ id: 'touching-labels', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	let history = createSoundscaperProjectHistory(original);
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	context.after(() => { lifetime.beginDisposal(); lifetime.finishDisposal(); });
	const pcm = new Float32Array(48_000).fill(0.3); pcm.fill(0, 9_600, 28_800);
	let nextId = 0;
	const service = createClipboardEditService({ lifetime,
		state: { selectedTrackId: 'track', selectedClipId: clip.id, clipboard: null },
		copy: { noSilencesFound: 'No silences', track: 'Track' },
		session: { setClipboard: descriptor => ({ clipboard: { descriptor, sources: [] } }), clipboardForProject: () => null },
		sourceBuffers: new Map([[source.id, { sampleRate: 48_000, numberOfChannels: 1, getChannelData: () => pcm }]]),
		getProject: () => history.present as unknown as ClipboardEditProject, editingBlocked: () => false,
		getPositionFrames: () => 0, normalizeFrame: value => Number(value), snapFrame: value => Number(value),
		createId: prefix => `${prefix}-${++nextId}`, setStatus: () => undefined,
		commit(command) { history = executeSoundscaperProjectCommand(history, command); },
	});
	const regions = mergeLabeledAudioRegions(touching ? [
		{ startFrame: 7_200, endFrame: 19_200 }, { startFrame: 19_200, endFrame: 31_200 },
	] : [{ startFrame: 7_200, endFrame: 31_200 }]);
	assert.equal(regions.length, touching ? 2 : 1, 'normal adjacent labels retain separate authored regions');
	assert.equal(await service.disjoinLabeledRegions(regions, ['track']), true);
	assert.deepEqual(history.present.clips.map(value => [value.timelineStartFrame, value.durationFrames,
		value.sourceStartFrame]).sort((a, b) => Number(a[0]) - Number(b[0])), [[0, 9_600, 0], [28_800, 19_200, 28_800]]);
	const detached = history.present;
	history = undoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.clips, original.clips);
	history = redoSoundscaperProjectCommand(history);
	assert.deepEqual(history.present.clips, detached.clips);
});
