/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
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
import type { DesktopLibraryLoadedProjectBundle } from '../desktop/project-library-projects.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const PROJECT_ID = 'managed-media-freshness-project';
const SOURCE_ID = 'managed-media-freshness-source';
const WRITE_ID = '1'.repeat(32);

interface AudioSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	readonly sampleFormat: string;
	readonly chunkFrames: number;
}

test('a prior-revision row is hidden but identical content can be rebound without another upload', async () => {
	const current = project(8);
	const source = current.sources[0] as AudioSource;
	const stale = media(project(7), source, 'a'.repeat(64));
	const host = fakeHost(current, [stale]);
	const service = new DesktopSharedProjectMediaService(host, { randomId: () => WRITE_ID });

	assert.deepEqual((await service.readProjectBundle(current.id))?.sources, []);
	const admission = await service.beginSourceWrite(declaration(current, source, 'b'.repeat(64)));
	assert.equal(admission.status, 'ready');
	assert.equal(host.publications[0]?.expectedProjectRevision, current.revision);
	assert.equal(host.publications[0]?.expectedProjectSha256, '0'.repeat(64));
	if (admission.status === 'ready') await service.abortSourceWrite(admission.writeId);

	const recreated = media(current, source, 'c'.repeat(64), 'f'.repeat(64));
	const recreatedHost = fakeHost(current, [recreated]);
	const recreatedService = new DesktopSharedProjectMediaService(recreatedHost, { randomId: () => WRITE_ID });
	assert.deepEqual((await recreatedService.readProjectBundle(current.id))?.sources, []);
	const recreatedAdmission = await recreatedService.beginSourceWrite(
		declaration(current, source, 'c'.repeat(64)),
	);
	assert.equal(recreatedAdmission.status, 'present');
	assert.equal(recreatedHost.publications.length, 1);
	if (recreatedAdmission.status === 'present') assert.notEqual(recreatedAdmission.source.bindingId, recreated.id);
});

test('present admission rejects stale renderer revisions and mismatched catalog bytes before body I/O', async () => {
	const current = project(8);
	const source = current.sources[0] as AudioSource;
	const existing = media(current, source, 'a'.repeat(64));
	const host = fakeHost(current, [existing]);
	const service = new DesktopSharedProjectMediaService(host);

	await assert.rejects(
		service.beginSourceWrite(declaration(current, source, 'b'.repeat(64))),
		/managed audio.*declaration/iu,
	);
	await assert.rejects(service.beginSourceWrite({
		...declaration(current, source, existing.sha256),
		projectRevision: current.revision - 1,
	}), /project revision/iu);
	assert.equal(host.publications.length, 0);

	const corruptHost = fakeHost(current, [{ ...existing, byteLength: existing.byteLength + 1 }]);
	await assert.rejects(
		new DesktopSharedProjectMediaService(corruptHost).beginSourceWrite(
			declaration(current, source, existing.sha256),
		),
		/canonical PCM geometry/iu,
	);
	assert.equal(corruptHost.publications.length, 0);
});

function fakeHost(projectValue: AudioEditorProjectCurrent, mediaValues: readonly DesktopLibraryMedia[]) {
	const publications: DesktopProjectLibraryHostPublishMediaOptions[] = [];
	const loaded = bundle(projectValue, mediaValues);
	return {
		publications,
		async readProjectBundleById(projectId: string) {
			return projectId === projectValue.id ? loaded : null;
		},
		async publishManagedMedia(options: DesktopProjectLibraryHostPublishMediaOptions) {
			publications.push(options);
			const binding = createDesktopLibraryAudioMediaBinding(
				options.projectId,
				options.storageKey,
				options.expectedProjectRevision,
				options.expectedProjectSha256,
			);
			return Object.freeze({ ...binding, byteLength: options.byteLength, sha256: options.sha256 });
		},
		async readManagedMedia() { return new Uint8Array(); },
	};
}

function project(revision: number): AudioEditorProjectCurrent {
	const source = createAudioSourceV9({
		id: SOURCE_ID,
		name: 'Managed media freshness source',
		mimeType: 'audio/wav',
		storageKey: 'stable-storage-key',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 2,
	});
	const clip = createAudioClipV9({ id: 'freshness-clip', sourceId: source.id, durationFrames: 4 });
	return createCurrentAudioEditorProject({
		id: PROJECT_ID,
		title: 'Managed media freshness',
		revision,
		now: '2026-08-01T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [createAudioTrackV9({ id: 'freshness-track', clipIds: [clip.id] })],
	});
}

function media(
	projectValue: AudioEditorProjectCurrent,
	source: AudioSource,
	sha256: string,
	projectSha256 = '0'.repeat(64),
): DesktopLibraryMedia {
	const binding = createDesktopLibraryAudioMediaBinding(
		projectValue.id,
		sourceBindingKey(source),
		projectValue.revision,
		projectSha256,
	);
	return Object.freeze({ ...binding, byteLength: canonicalBytes(source), sha256 });
}

function declaration(
	projectValue: AudioEditorProjectCurrent,
	source: AudioSource,
	sha256: string,
): DesktopSharedSourceWriteDeclaration {
	return Object.freeze({
		byteLength: canonicalBytes(source),
		encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
		projectId: projectValue.id,
		projectRevision: projectValue.revision,
		sha256,
		sourceId: source.id,
	});
}

function bundle(
	projectValue: AudioEditorProjectCurrent,
	mediaValues: readonly DesktopLibraryMedia[],
): DesktopLibraryLoadedProjectBundle {
	const catalog: DesktopLibraryProject = Object.freeze({
		id: 'managed-media-freshness-entry',
		projectId: projectValue.id,
		name: projectValue.title,
		metadataFile: 'projects/managed-media-freshness-entry/project.scape',
		preferredProduct: 'soundscaper',
		updatedAtMs: 1,
		projectSchemaVersion: 15,
		projectRevision: projectValue.revision,
		byteLength: 1,
		sha256: '0'.repeat(64),
	});
	return Object.freeze({ catalog, project: projectValue, media: Object.freeze([...mediaValues]) });
}

function sourceBindingKey(source: AudioSource): string {
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

function canonicalBytes(source: AudioSource): number {
	const chunks = source.frameCount === 0 ? 0 : Math.ceil(source.frameCount / source.chunkFrames);
	return source.frameCount * source.channelCount * Float32Array.BYTES_PER_ELEMENT + chunks * 4;
}
