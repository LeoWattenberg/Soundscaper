/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipPropertyService, type ClipPropertyServiceDependencies } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import type { ClipTransformClip, ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';

for (const action of ['normalize-peak', 'normalize-lufs'] as const) test(`${action} measures the dry authored clip before assigning its absolute gain`, async context => {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	context.after(() => { lifetime.beginDisposal(); lifetime.finishDisposal(); });
	const generation = new EditorProjectGeneration(); generation.activate('project');
	const clip = { ...createAudioClip({ id: 'clip', sourceId: 'source', gain: 0.3, durationFrames: 4800, sourceStartFrame: 100,
		sourceDurationFrames: 4800, envelope: [{ frame: 0, value: 0.5 }],
		fadeInFrames: 200, fadeOutFrames: 200 }), timelineStartFrame: 0, durationFrames: 4800, sourceStartFrame: 100, sourceDurationFrames: 4800 };
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 10_000, channelCount: 1 });
	const project = { id: 'project', schemaVersion: 23, title: 'Recording', sampleRate: 48_000, sources: [source], clips: [clip], tracks: [] } as ClipTransformProject;
	const raw: AudioBufferLike = { sampleRate: 48_000, length: 10_000, numberOfChannels: 1, getChannelData: () => new Float32Array(10_000).fill(0.5) };
	const dry: AudioBufferLike = { sampleRate: 48_000, length: 4800, numberOfChannels: 1, getChannelData: () => new Float32Array(4800).fill(0.25) };
	let rendered = false;
	const commits: AudioEditorCommand[] = [];
	const dependencies: ClipPropertyServiceDependencies & {
		renderNormalizationAudio(project: ClipTransformProject, clip: ClipTransformClip, buffer: AudioBufferLike, signal: AbortSignal): Promise<AudioBufferLike>;
	} = { lifetime, copy: { audioClipNotFound: '', clipPitchRange: '', clipSpeedPositive: '', timelineFramesFinite: '' },
		sourceBuffers: new Map([['source', raw]]), getProject: () => project, getSelectedClipId: () => 'clip', editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: token => { generation.assertCurrent(token); }, createId: prefix => prefix,
		commit: command => { commits.push(command); },
		renderNormalizationAudio: async (actualProject, actualClip, buffer, signal) => {
			assert.equal(actualProject, project); assert.equal(actualClip, clip); assert.equal(buffer, raw); signal.throwIfAborted();
			rendered = true; return dry;
		},
		analyzeChannels: async (channels, sampleRate) => {
			assert.equal(channels[0]?.length, 4800); assert.equal(sampleRate, 48_000);
			return { peakAmplitude: channels[0]?.[0] ?? 0, integratedLufs: channels[0]?.[0] === 0.25 ? -20 : -14 };
		},
	};
	await createClipPropertyService(dependencies).handleClipAction(action);
	assert.equal(rendered, true, 'the authored envelope and fades must reach analysis');
	const command = commits[0];
	if (command?.type !== 'clip/update') assert.fail('Expected clip gain commit.');
	assert.equal(command.changes.gain, action === 'normalize-peak' ? 10 ** (-1 / 20) / 0.25 : 10 ** (6 / 20));
	assert.equal(clip.gain, 0.3); assert.equal(clip.envelope?.[0]?.value, 0.5);
});
