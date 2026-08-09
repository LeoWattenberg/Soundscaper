/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopLibraryMediaBinding } from '../desktop/project-library-media-binding.ts';
import { desktopSharedManagedSourceBindingKey } from '../desktop/project-library-editor-media-service.ts';
import { createDesktopProjectLibrarySmokeEvidence } from '../desktop/project-library-smoke-evidence.js';

test('desktop smoke evidence snapshots the current document and exact revision-bound media', async () => {
	const project = {
		id: 'smoke-project', title: 'Smoke project', revision: 3,
		sources: [
			{
				id: 'audio-source', kind: 'audio', storageKey: 'audio-storage',
				frameCount: 4, channelCount: 1, sampleRate: 48_000,
				originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 4,
			},
			{
				id: 'video-source', kind: 'video', storageKey: 'video-storage',
				mimeType: 'video/mp4', sampleFrameCount: 1_600, sourceFrameCount: 1,
				sampleRate: 48_000, width: 1_920, height: 1_080,
				frameRate: { num: 30, den: 1 }, videoCodec: 'h264', audioCodec: null,
				hasAudio: false,
			},
		],
	};
	const sha256 = 'ab'.repeat(32);
	const audio = mediaFor('audio-f32le-chunks-v1', project, project.sources[0], sha256, 64);
	const video = mediaFor('video-original-v1', project, project.sources[1], sha256, 128);
	const evidence = await createDesktopProjectLibrarySmokeEvidence({
		snapshot: () => ({ owner: { product: 'framescaper' } }),
		readCatalog: () => ({ revision: 7, projects: [{ projectId: project.id, preferredProduct: 'framescaper' }] }),
		readProjectBundleById: async (projectId) => {
			assert.equal(projectId, project.id);
			return {
				catalog: { projectId: project.id, projectRevision: project.revision, sha256 },
				project,
				media: [{ id: 'unrelated', byteLength: 1, sha256: 'cd'.repeat(32) }, video, audio],
			};
		},
	}, project.id, {
		createMediaBinding: createDesktopLibraryMediaBinding,
		sourceBindingKey: desktopSharedManagedSourceBindingKey,
	});

	assert.deepEqual(evidence.project, {
		id: project.id, title: project.title, revision: project.revision, sha256,
	});
	assert.deepEqual(evidence.sources, [
		sourceEvidence(project.sources[0], audio, 'audio-f32le-chunks-v1'),
		sourceEvidence(project.sources[1], video, 'video-original-v1'),
	]);
	assert.equal(evidence.catalogRevision, 7);
});

function mediaFor(encoding, project, source, sha256, byteLength) {
	const binding = createDesktopLibraryMediaBinding(
		encoding, project.id, desktopSharedManagedSourceBindingKey(source), project.revision, sha256,
	);
	return { id: binding.id, relativeFile: binding.relativeFile, byteLength, sha256 };
}

function sourceEvidence(source, media, encoding) {
	return {
		bindingId: media.id, byteLength: media.byteLength, encoding,
		kind: source.kind, sha256: media.sha256, sourceId: source.id, storageKey: source.storageKey,
	};
}
