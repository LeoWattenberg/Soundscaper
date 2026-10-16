/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { ProjectBinPreviewEngine } from '../src/common/editor/controller/import/internal/project-bin/project-bin-preview-service.ts';
import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createHarness } from './helpers/project-bin-service-harness.ts';

function media(channelCount: number) {
	return {
		sources: [{ id: 'programme', storageKey: 'programme', name: 'Programme.wav', sampleRate: 48_000, frameCount: 48_000, channelCount }],
		clips: [{ id: 'phrase', kind: 'audio', sourceId: 'programme', title: 'Programme', timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 }],
		tracks: [{ id: 'dialogue', name: 'Dialogue', clipIds: ['phrase'] }],
	};
}

for (const channelCount of [2, 6]) test(`ordinary ${channelCount}-channel Bin audition retains every programme channel`, async () => {
	const project = applyEditorCommand(createCurrentAudioEditorProject({ id: 'bin-programme', sampleRate: 48_000, ...media(channelCount) }),
		{ type: 'project-bin/move-from-timeline', clipIds: ['phrase'] });
	const original = structuredClone(project);
	const loaded: EngineProject[] = [];
	const engine: ProjectBinPreviewEngine = {
		loadProject(value) { assert.ok(value); loaded.push(value); }, play: async () => undefined, pause() {},
	};
	const harness = createHarness(project, { createPreviewEngine: () => engine });
	await harness.service.playPauseProjectBinClip('phrase');
	assert.equal(harness.preview?.state, 'playing');
	const preview = loaded[0]!;
	assert.equal(preview.masterChannels, channelCount);
	const routing = preview.mixer as unknown as Readonly<{ edges: readonly { source: { kind: string }; channelMap: readonly number[] }[] }>;
	assert.deepEqual(routing.edges.find(edge => edge.source.kind === 'track')?.channelMap,
		Array.from({ length: channelCount }, (_value, channel) => channel));
	assert.deepEqual(project, original);
});

for (const channelCount of [1, 2, 6, 32]) test(`transient source and take auditions preserve the ${channelCount}-channel occupied media width`, () => {
	const preview = createAudioPreviewProject({ sampleRate: 48_000, ...media(channelCount) });
	assert.equal(preview.masterChannels, Math.max(2, channelCount));
	assert.equal(preview.sources?.[0]?.channelCount, channelCount);
});

test('preview width follows only occupied tracks and preserves an explicitly requested render width', () => {
	const occupied = media(2);
	const sources = [...occupied.sources, { ...occupied.sources[0]!, id: 'unused-surround', channelCount: 6 }];
	assert.equal(createAudioPreviewProject({ sampleRate: 48_000, ...occupied, sources }).masterChannels, 2);
	assert.equal(createAudioPreviewProject({ sampleRate: 48_000, ...media(6), masterChannels: 2 }).masterChannels, 2);
});
