/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createClipboardDescriptor, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { findClipSilenceRegions } from '../src/common/editor/clip-silence-regions.ts';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';
import { createClipboardEditService } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const original = { id: 'clip', kind: 'audio' as const, sourceId: 'source', timelineStartFrame: 0,
	sourceStartFrame: 0, sourceDurationFrames: 1_000, durationFrames: 1_000 };

function document(clips = [createAudioClip(original)]) {
	return createSoundscaperProject({ id: 'editing-regressions', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000,
			channelCount: 1, frameCount: 10_000 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: clips.map(({ id }) => id) })], clips });
}

test('ripple removing overlapping clips closes each timeline frame once', () => {
	const input = document([
		createAudioClip({ ...original, id: 'first' }),
		createAudioClip({ ...original, id: 'overlap', timelineStartFrame: 500 }),
		createAudioClip({ ...original, id: 'later', timelineStartFrame: 2_000 }),
	]);
	const result = applySoundscaperProjectCommand(input,
		{ type: 'clip/remove-many', clipIds: ['first', 'overlap'], rippleMode: 'track' });
	assert.equal(result.clips.find(({ id }) => id === 'later')?.timelineStartFrame, 500);
});

test('copy and paste preserve a clip repetition period and phase', () => {
	const looped = { ...original, ...clipLoopUpdateFields(original,
		{ periodFrames: 1_000, durationFrames: 3_000, offsetFrames: 250 }) };
	const input = document([createAudioClip(looped)]);
	const runtime = resolveRuntimeProjectProjection(input);
	const clipboard = createClipboardDescriptor(runtime, { startFrame: 0, endFrame: 3_000,
		trackIds: ['track'], clipIds: ['clip'] });
	const command = preparePasteCommand(clipboard,
		{ project: runtime, atFrame: 4_000, trackMap: { track: 'track' }, mode: 'overlap' }, () => 'pasted');
	const result = applySoundscaperProjectCommand(input, command);
	assert.deepEqual(readClipLoop(result.clips.find(({ id }) => id === 'pasted')!),
		{ periodFrames: 1_000, offsetFrames: 250 });
});

test('split at silences finds each repetition instead of stretching one silence across the loop', () => {
	const data = new Float32Array(1_000).fill(0.5);
	data.fill(0, 200, 300);
	const clip = { ...original, ...clipLoopUpdateFields(original,
		{ periodFrames: 1_000, durationFrames: 3_000 }) };
	assert.deepEqual(findClipSilenceRegions(clip,
		{ sampleRate: 1_000, numberOfChannels: 1, getChannelData: () => data }),
		[[200, 300], [1_200, 1_300], [2_200, 2_300]]);
});

test('Jump to project end uses content duration instead of the empty timeline workspace', async () => {
	const fixture = createTransportFixture();
	assert.equal(await fixture.service.handleTransport('jump-end'), 1_000);
});

test('split at silences reads imported audio when its buffer is streamed instead of cached', async () => {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const project = { id: 'imported-audio', schemaFamily: 'soundscaper' as const, schemaVersion: 1,
		sampleRate: 1_000, sources: [{ id: 'source' }], clips: [original],
		tracks: [{ id: 'track', name: 'Recording', type: 'audio' as const, clipIds: ['clip'] }],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track'], clipIds: ['clip'] } };
	const data = new Float32Array(1_000).fill(0.5);
	data.fill(0, 200, 300);
	let loaded = 0;
	let nextId = 0;
	const commands: AudioEditorCommand[] = [];
	const service = createClipboardEditService({ lifetime,
		state: { selectedTrackId: 'track', selectedClipId: 'clip', clipboard: null },
		copy: { noSilencesFound: 'No silences', track: 'Track' },
		session: { setClipboard: (descriptor) => ({ clipboard: { descriptor, sources: [] } }),
			clipboardForProject: () => null },
		sourceBuffers: new Map(), getProject: () => ({ ...project }), editingBlocked: () => false,
		getPositionFrames: () => 0, normalizeFrame: (frame) => Number(frame),
		snapFrame: (frame) => Number(frame), createId: (prefix) => `${prefix}-${++nextId}`,
		commit: (command) => { commands.push(command); }, setStatus: () => undefined,
		loadSourceBuffer: () => { loaded += 1; return Promise.resolve({
			sampleRate: 1_000, numberOfChannels: 1, getChannelData: () => data }); },
	});
	await service.disjoinSelectedClip();
	assert.equal(loaded, 1);
	assert.equal(commands[0]?.type, 'batch');
	if (commands[0]?.type === 'batch') assert.equal(commands[0].commands.length, 3);
});
