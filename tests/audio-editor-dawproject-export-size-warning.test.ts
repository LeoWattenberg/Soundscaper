/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { DAWPROJECT_BLOB_EXPORT_BYTE_LIMIT } from '../src/common/editor/controller/import/internal/dawproject/dawproject-export-audio.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

test('DAWproject export acceptance enters streaming PCM and rejection leaves it unread', async () => {
	const source = createAudioSource({ id: 'audio-source', name: 'take.wav', channelCount: 2, frameCount: 1_000, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'audio-clip', sourceId: source.id, durationFrames: 1_000, sourceDurationFrames: 1_000 });
	const track = createAudioTrack({ id: 'audio-track', clipIds: [clip.id] });
	const project = createCurrentAudioEditorProject({ id: 'project-a', sources: [source], clips: [clip], tracks: [track] });
	const huge = { ...project, sources: [{ ...project.sources[0]!, frameCount: DAWPROJECT_BLOB_EXPORT_BYTE_LIMIT / 8 + 1 }] };
	for (const accept of [true, false]) {
		let reads = 0;
		let warnings = 0;
		const sentinel = new Error('Source reader was reached after approval');
		const fixture = createFixture({
			getProject: () => huge,
			async confirmFileSizeWarning(warning) {
				warnings++;
				assert.equal(reads, 0);
				assert.equal(warning.thresholdBytes, DAWPROJECT_BLOB_EXPORT_BYTE_LIMIT);
				return accept;
			},
			store: { ...createFixture().runtime.store, readSourceChunks() { reads++; return (async function* () { yield* []; throw sentinel; })(); } },
		});
		await assert.rejects(createNativeProjectService(fixture.runtime).saveDawproject(), accept ? sentinel : { name: 'AbortError' });
		assert.equal(warnings, 1);
		assert.equal(reads, accept ? 1 : 0);
	}
});
