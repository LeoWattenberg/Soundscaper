/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareMixRenderOperationCommit } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-commit.ts';
import { preserveProductionMixRenderRouting } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-routing.ts';
import { createMixRenderSnapshot } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import { normalizeMixRenderOptions } from '../src/common/editor/controller/track-audio/mix-render-options.ts';
import type { ControllerProject, ControllerSource, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

const now = '2026-10-07T00:00:00.000Z';

test('one combined in-place print removes only its baked VCA membership', () => {
	const project = fixture();
	const original = structuredClone(project);
	const target = project.tracks[0]! as unknown as ControllerTrack;
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, [target], {
		mixDown: true, renderEffects: true,
	}) as unknown as typeof project;
	assert.deepEqual(snapshot.mixer.vcas[0]?.members, [{ kind: 'track', id: 'voice' }]);
	assert.equal(snapshot.mixer.vcas[0]?.gain, 0.5);
	const applied = renderCommit(project, target, true);
	assert.deepEqual(applied.mixer.vcas[0]?.members, [
		{ kind: 'track', id: 'other' }, { kind: 'master' },
	]);
	assert.deepEqual(applied.mixer.vcas[1], project.mixer.vcas[1]);
	assert.equal(applied.mixer.vcas[0]?.gain, 0.5);
	assert.deepEqual(project, original);
});

test('an individual print retains the VCA controls excluded from its snapshot', () => {
	const project = fixture();
	const target = project.tracks[0]! as unknown as ControllerTrack;
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, [target], {
		mixDown: false, renderEffects: true,
	}) as unknown as typeof project;
	assert.deepEqual(snapshot.mixer.vcas, []);
	assert.deepEqual(renderCommit(project, target, false).mixer.vcas, project.mixer.vcas);
});

test('an individual sibling inherits its source track VCA controls without changing original members', () => {
	const project = fixture();
	const target = project.tracks[0]! as unknown as ControllerTrack;
	const applied = renderCommit(project, target, false, false);
	const sibling = applied.tracks.find(({ id }) => !project.tracks.some(track => track.id === id));
	assert.ok(sibling);
	assert.deepEqual(applied.mixer.vcas[0]?.members, [
		...project.mixer.vcas[0]!.members, { kind: 'track', id: sibling.id },
	]);
	assert.deepEqual(applied.mixer.vcas[1], project.mixer.vcas[1]);
});

function renderCommit(project: ReturnType<typeof fixture>, target: ControllerTrack, mixDown: boolean, replaceOriginals = true) {
	let counter = 0;
	const createId = (prefix: string) => `${prefix}-${++counter}`;
	const prepared = prepareMixRenderOperationCommit(project as unknown as ControllerProject, [{
		targetTracks: [target], source: source('printed') as unknown as ControllerSource,
		startFrame: 0, name: 'Voice',
	}], normalizeMixRenderOptions({ mixDown, renderEffects: true, replaceOriginals }), { createId });
	const routed = preserveProductionMixRenderRouting(project as unknown as ControllerProject,
		prepared, (candidate, command) => applySoundscaperProjectCommand(candidate, command, { now }) as never,
		createId);
	return applySoundscaperProjectCommand(project, routed.command, { now });
}

function fixture() {
	const tracks = ['voice', 'other'].map(id => createAudioTrack({ id, name: id, clipIds: [`${id}-clip`] }));
	const base = createSoundscaperProject({ id: 'vca-mix', title: 'VCA mix', now,
		tracks, sources: tracks.map(({ id }) => source(`${id}-source`)),
		clips: tracks.map(({ id }) => createAudioClip({ id: `${id}-clip`, sourceId: `${id}-source`,
			title: id, timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
			durationFrames: 48_000 })),
		sequences: [{ id: 'main', trackIds: tracks.map(({ id }) => id) }], primarySequenceId: 'main',
	});
	return createSoundscaperProject({ ...base, mixer: { ...base.mixer, vcas: [
		{ id: 'fader', name: 'Fader', gain: 0.5, mute: false, members: [
			{ kind: 'track', id: 'voice' }, { kind: 'track', id: 'other' }, { kind: 'master' },
		] },
		{ id: 'unrelated', name: 'Other fader', gain: 0.75, mute: false,
			members: [{ kind: 'track', id: 'other' }] },
	] } });
}

function source(id: string) {
	return createAudioSource({ id, storageKey: id, name: id, mimeType: 'audio/wav', frameCount: 48_000,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536 });
}
