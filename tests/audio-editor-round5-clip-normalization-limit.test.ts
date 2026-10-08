/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipPropertyService, type ClipPropertyServiceDependencies } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';

for (const action of ['normalize-peak', 'normalize-lufs'] as const) {
	test(`${action} rejects an unattainable gain without publishing a substituted value`, async context => {
		const fixture = createFixture(context, 0.002, -60);
		await assert.rejects(fixture.service.handleClipAction(action), error => {
			assert.ok(error instanceof RangeError);
			assert.match(error.message, /maximum clip gain/u);
			assert.equal(localizedErrorMessage(error)?.key, 'clipNormalizationGainLimit');
			return true;
		});
		assert.equal(fixture.commits.length, 0);
		assert.equal(fixture.project.clips[0]?.gain, 0.5);
	});

	test(`${action} retains ordinary attainable normalization`, async context => {
		const fixture = createFixture(context, 0.25, -20);
		await fixture.service.handleClipAction(action);
		const command = fixture.commits[0];
		assert.equal(command?.type, 'clip/update');
		if (command?.type !== 'clip/update') assert.fail('Expected one gain command.');
		assert.equal(command.changes.gain, action === 'normalize-peak' ? 10 ** (-1 / 20) / 0.25 : 10 ** (6 / 20));
	});
}

function createFixture(context: test.TestContext, peakAmplitude: number, integratedLufs: number) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	context.after(() => { lifetime.beginDisposal(); lifetime.finishDisposal(); });
	const generation = new EditorProjectGeneration();
	generation.activate('project');
	const clip = createAudioClip({ id: 'clip', sourceId: 'source', gain: 0.5, durationFrames: 38_400, sourceDurationFrames: 38_400 });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 38_400, channelCount: 1 });
	const project = { id: 'project', schemaVersion: 23, title: 'Recording', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [] } as ClipTransformProject;
	const buffer = { sampleRate: 48_000, length: 38_400, numberOfChannels: 1,
		getChannelData: () => new Float32Array(38_400).fill(peakAmplitude) };
	const commits: AudioEditorCommand[] = [];
	const copy = { audioClipNotFound: '', clipPitchRange: '', clipSpeedPositive: '', timelineFramesFinite: '',
		clipNormalizationGainLimit: 'Normalization requires more than the maximum clip gain.' };
	const dependencies: ClipPropertyServiceDependencies = { lifetime, copy, sourceBuffers: new Map([['source', buffer]]),
		getProject: () => project, getSelectedClipId: () => 'clip', editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: token => { generation.assertCurrent(token); },
		createId: prefix => prefix, commit: command => { commits.push(command); },
		analyzeChannels: async () => ({ peakAmplitude, integratedLufs }) };
	return { service: createClipPropertyService(dependencies), commits, project, lifetime };
}
