/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createIsolatedTrackRenderProjectV21, type IsolatedTrackRenderProjectV21 } from '../src/common/editor/controller/shared/isolated-track-render-project-v21.ts';
import { createMixRenderSnapshot } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { validateAdmAuthoredRouting, type RoutingProject } from '../src/common/editor/adm-project-metadata.ts';
import { createDefaultAdmMetadata, setAdmEditorAssignment } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

for (const processing of ['dry', 'authored', 'sidechain'] as const) {
	test(`${processing} isolated capture preserves source channel order before ADM programme routing`, () => {
		const authored = fixture(processing === 'sidechain');
		const before = structuredClone(authored);
		assert.deepEqual(validateAdmAuthoredRouting(authored.metadata.adm, authored as unknown as RoutingProject), []);
		const capture = createIsolatedTrackRenderProjectV21(authored as unknown as IsolatedTrackRenderProjectV21, {
			trackId: 'right', effects: [], preserveTrackProcessing: processing !== 'dry',
		});
		const metadata = capture.metadata as typeof authored.metadata;
		assert.equal(metadata.adm, null, 'pre-master mono capture cannot route channel zero into the programme right output');
		assert.equal(metadata.title, authored.metadata.title);
		assert.equal(capture.masterChannels, authored.masterChannels);
		assert.deepEqual(capture.sources, authored.sources);
		assert.deepEqual(capture.clips, authored.clips);
		assert.deepEqual(authored, before, 'the saved ADM programme remains unchanged');
		if (processing === 'sidechain') assert.ok(capture.mixer.edges.some(edge => edge.kind === 'sidechain'));
	});
}

test('a programme mix keeps its authored ADM routing while a private capture removes it', () => {
	const project = fixture(false);
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject,
		project.tracks as unknown as readonly ControllerTrack[]);
	assert.deepEqual((snapshot.metadata as typeof project.metadata).adm, project.metadata.adm);
});

function fixture(sidechain: boolean) {
	const sources = ['left', 'right'].map(id => createAudioSource({
		id: `${id}-source`, storageKey: `pcm:${id}`, frameCount: 48, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	}));
	const clips = sources.map((source, index) => createAudioClip({
		id: `clip-${index}`, sourceId: source.id, title: source.id,
		timelineStartFrame: 0, durationFrames: 48, sourceStartFrame: 0, sourceDurationFrames: 48,
	}));
	const project = createSoundscaperProject({ id: 'isolated-adm', title: 'Isolated ADM',
		now: '2026-10-09T12:00:00.000Z', sources, clips,
		tracks: ['left', 'right'].map((id, index) => createAudioTrack({ id, name: id, clipIds: [clips[index]!.id],
			effects: sidechain && id === 'right' ? [createEffect('gate', { id: 'right-gate' })] : [] })),
	});
	const adm = setAdmEditorAssignment(createDefaultAdmMetadata(project, 'stereo'), {
		stripKind: 'track', stripId: 'right', sourceChannel: 0, bedChannel: 'R', gain: 1,
	});
	return { ...project, metadata: { ...project.metadata, title: 'Keep this metadata', adm },
		mixer: { ...project.mixer, edges: [...project.mixer.edges, ...(sidechain ? [{
			id: 'left-detector', kind: 'sidechain' as const, source: { kind: 'track' as const, id: 'left' },
			destination: { kind: 'effect-sidechain' as const, strip: { kind: 'track' as const, id: 'right' }, effectId: 'right-gate' },
			position: 'post-fader' as const, level: 1, enabled: true, channelMap: [0],
		}] : [])] } };
}
