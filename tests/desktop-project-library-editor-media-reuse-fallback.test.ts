/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { DesktopLibraryMedia, DesktopLibraryProject } from '../desktop/project-library-contract.ts';
import {
	DesktopSharedProjectMediaService,
	type DesktopSharedSourceWriteDeclaration,
} from '../desktop/project-library-editor-media-service.ts';
import type { DesktopProjectLibraryHostPublishMediaOptions } from '../desktop/project-library-host.ts';
import {
	createDesktopLibraryAudioMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
} from '../desktop/project-library-media.ts';
import { DesktopLibraryMediaReuseUnavailableError } from '../desktop/project-library-media-reuse.ts';
import type { DesktopLibraryLoadedProjectBundle } from '../desktop/project-library-projects.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const PROJECT_SHA256 = '0'.repeat(64);
const WRITE_ID = '1'.repeat(32);

test('an unavailable hard-link optimization falls back to a normal bounded upload', async () => {
	const fixture = mediaFixture();
	const calls: DesktopProjectLibraryHostPublishMediaOptions[] = [];
	const received: Uint8Array[] = [];
	const host = {
		async readProjectBundleById(projectId: string) {
			return projectId === fixture.project.id ? fixture.bundle : null;
		},
		async publishManagedMedia(options: DesktopProjectLibraryHostPublishMediaOptions) {
			calls.push(options);
			if (options.reuseExistingBody) throw new DesktopLibraryMediaReuseUnavailableError();
			for await (const chunk of options.chunks) received.push(chunk.slice());
			const binding = createDesktopLibraryAudioMediaBinding(
				options.projectId,
				options.storageKey,
				options.expectedProjectRevision,
				options.expectedProjectSha256,
			);
			return Object.freeze({
				...binding,
				byteLength: options.byteLength,
				sha256: options.sha256,
			});
		},
		async readManagedMedia() { throw new Error('Unexpected managed-media read'); },
	};
	const service = new DesktopSharedProjectMediaService(host, { randomId: () => WRITE_ID });

	const admission = await service.beginSourceWrite(fixture.declaration);
	assert.equal(admission.status, 'ready');
	if (admission.status !== 'ready') throw new Error('Expected upload fallback admission');
	await service.writeSourceChunk({
		writeId: admission.writeId,
		offset: 0,
		bytes: fixture.bytes,
	});
	const completed = await service.finishSourceWrite({
		writeId: admission.writeId,
		sha256: fixture.declaration.sha256,
	});

	assert.equal(calls.length, 2);
	assert.equal(calls[0]?.reuseExistingBody, true);
	assert.notEqual(calls[1]?.reuseExistingBody, true);
	assert.deepEqual(received, [fixture.bytes]);
	assert.equal(completed.sha256, fixture.declaration.sha256);
});

function mediaFixture() {
	const source = createAudioSourceV9({
		id: 'reuse-fallback-source',
		name: 'Reuse fallback.wav',
		mimeType: 'audio/wav',
		storageKey: 'reuse-fallback-storage',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 2,
	});
	const clip = createAudioClipV9({
		id: 'reuse-fallback-clip',
		sourceId: source.id,
		durationFrames: source.frameCount,
	});
	const project = createCurrentAudioEditorProject({
		id: 'reuse-fallback-project',
		title: 'Reuse fallback',
		revision: 8,
		now: '2026-08-01T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [createAudioTrackV9({ id: 'reuse-fallback-track', clipIds: [clip.id] })],
	});
	const byteLength = source.frameCount * source.channelCount * Float32Array.BYTES_PER_ELEMENT + 8;
	const bytes = Uint8Array.from({ length: byteLength }, (_, index) => index + 1);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const donorBinding = createDesktopLibraryAudioMediaBinding(
		project.id,
		sourceBindingKey(source),
		project.revision - 1,
		'f'.repeat(64),
	);
	const donor: DesktopLibraryMedia = Object.freeze({ ...donorBinding, byteLength, sha256 });
	const catalog: DesktopLibraryProject = Object.freeze({
		id: 'reuse-fallback-entry',
		projectId: project.id,
		name: project.title,
		metadataFile: 'projects/reuse-fallback-entry/project.scape',
		preferredProduct: 'soundscaper',
		updatedAtMs: 1,
		projectSchemaVersion: 12,
		projectRevision: project.revision,
		byteLength: 1,
		sha256: PROJECT_SHA256,
	});
	const bundle: DesktopLibraryLoadedProjectBundle = Object.freeze({
		catalog,
		project,
		media: Object.freeze([donor]),
	});
	const declaration: DesktopSharedSourceWriteDeclaration = Object.freeze({
		byteLength,
		encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
		projectId: project.id,
		projectRevision: project.revision,
		sha256,
		sourceId: source.id,
	});
	return Object.freeze({ bundle, bytes, declaration, project });
}

function sourceBindingKey(source: Readonly<Record<string, unknown>>): string {
	return JSON.stringify([
		source.storageKey,
		source.frameCount,
		source.channelCount,
		source.sampleRate,
		source.originalSampleRate,
		source.sampleFormat,
		source.chunkFrames,
	]);
}
