/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipPropertyService, type ClipPropertyServiceDependencies } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

for (const [name, changes] of [
	['gain', { gain: 0.5 }],
	['fade', { fadeInFrames: 4800 }],
	['envelope', { envelope: [{ frame: 0, value: 0.5 }] }],
	['polarity', { inverted: true }],
] as const) {
	test(`normalization cannot overwrite a later ordinary ${name} edit`, async context => {
		const fixture = createFixture(context);
		const job = fixture.service.handleClipAction('normalize-peak');
		await fixture.started;
		fixture.edit(changes);
		fixture.finish();
		await assert.rejects(job, { name: 'AbortError' });
		assert.equal(fixture.commits.length, 0);
	});
}

test('a title edit permits the unchanged audio normalization to complete', async context => {
	const fixture = createFixture(context);
	const job = fixture.service.handleClipAction('normalize-peak');
	await fixture.started;
	fixture.edit({ title: 'Room tone' });
	fixture.finish();
	await job;
	assert.equal(fixture.commits.length, 1);
});

function createFixture(context: test.TestContext) {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	context.after(() => { lifetime.beginDisposal(); lifetime.finishDisposal(); });
	const generation = new EditorProjectGeneration(); generation.activate('project');
	let persisted = createSoundscaperProject({ id: 'project', now: '2026-10-08T04:00:00.000Z', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 38_400, channelCount: 1 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 38_400, sourceDurationFrames: 38_400 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	let begin: () => void = () => {};
	const started = new Promise<void>(resolve => { begin = resolve; });
	let finish: () => void = () => {};
	const analysis = new Promise<{ peakAmplitude: number; integratedLufs: number }>(resolve => {
		finish = () => resolve({ peakAmplitude: 0.1, integratedLufs: -20 });
	});
	const commits: AudioEditorCommand[] = [];
	const dependencies: ClipPropertyServiceDependencies = { lifetime,
		copy: { audioClipNotFound: '', clipPitchRange: '', clipSpeedPositive: '', timelineFramesFinite: '' },
		getProject: () => projectForRuntimeConsumers(persisted) as unknown as ClipTransformProject,
		getSelectedClipId: () => 'clip', editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: token => { generation.assertCurrent(token); },
		createId: prefix => prefix, commit: command => { commits.push(command); },
		sourceBuffers: new Map([['source', { sampleRate: 48_000, length: 38_400, numberOfChannels: 1,
			getChannelData: () => new Float32Array(38_400).fill(0.1) }]]),
		analyzeChannels: () => { begin(); return analysis; },
	};
	return { service: createClipPropertyService(dependencies), commits, started, finish,
		edit: (changes: Readonly<Record<string, unknown>>) => {
			persisted = applySoundscaperProjectCommand(persisted, { type: 'clip/update', clipId: 'clip', changes });
		} };
}
