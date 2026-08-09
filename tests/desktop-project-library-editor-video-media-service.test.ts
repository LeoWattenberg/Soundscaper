/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type {
	DesktopLibraryMedia,
	DesktopLibraryProject,
} from '../desktop/project-library-contract.ts';
import {
	desktopSharedManagedSourceBindingKey,
	DesktopSharedProjectMediaService,
	type DesktopSharedSourceWriteDeclaration,
} from '../desktop/project-library-editor-media-service.ts';
import type {
	DesktopProjectLibraryHostPublishMediaOptions,
} from '../desktop/project-library-host.ts';
import {
	createDesktopLibraryVideoMediaBinding,
	createDesktopLibraryVideoTimingBinding,
	DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_TIMING_ENCODING,
	type DesktopLibraryManagedMediaReadOptions,
} from '../desktop/project-library-media.ts';
import type { DesktopLibraryLoadedProjectBundle } from '../desktop/project-library-projects.ts';
import { managedSourceBinding } from '../src/common/editor/storage/desktop-shared-project-media-sources.ts';
import {
	createVideoClipV9,
	createVideoSourceV9,
} from '../src/common/editor/project-v9.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';

const PROJECT_DIGEST = '0'.repeat(64);
const WRITE_ID = '2'.repeat(32);

test('project bundles expose exact reachable managed original-video descriptors', async () => {
	const fixture = videoFixture();
	const media = mediaForVideo(fixture.project, fixture.source, 11, 'a'.repeat(64));
	const host = new FakeManagedMediaHost(bundle(fixture.project, [media]));
	const service = new DesktopSharedProjectMediaService(host);

	const result = await service.readProjectBundle(fixture.project.id);

	assert.ok(result);
	assert.deepEqual(result.sources, [{
		bindingId: media.id,
		byteLength: media.byteLength,
		encoding: DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
		kind: 'video',
		sha256: media.sha256,
		sourceId: fixture.source.id,
		storageKey: fixture.source.storageKey,
	}]);
});

test('project bundles and present admission carry the video timing sidecar independently', async () => {
	const fixture = videoFixture();
	const sourceSha256 = 'c'.repeat(64);
	const timing = createVideoTimingAssetPublication(sourceSha256, {
		timescale: 1_000,
		presentationTicks: [0n],
		finalFrameDurationTicks: 40n,
	});
	const project = createCurrentAudioEditorProject({
		...fixture.project,
		sources: fixture.project.sources.map((source) => source.id === fixture.source.id ? {
			...source,
			contentSha256: sourceSha256,
			sourceFrameCount: timing.reference.frameCount,
			timingAsset: timing.reference,
		} : source),
	});
	const original = mediaForVideo(project, fixture.source, 11, sourceSha256);
	const timingBindingKey = JSON.stringify([
		timing.reference.storageKey,
		timing.reference.byteLength,
		timing.reference.sha256,
		timing.reference.frameCount,
		timing.reference.timescale,
		timing.reference.finalFrameDurationTicks,
		timing.reference.encoding,
	]);
	const timingBinding = createDesktopLibraryVideoTimingBinding(
		project.id,
		timingBindingKey,
		project.revision,
		PROJECT_DIGEST,
	);
	const timingMedia = Object.freeze({
		...timingBinding,
		byteLength: timing.reference.byteLength,
		sha256: timing.reference.sha256,
	});
	const host = new FakeManagedMediaHost(bundle(project, [original, timingMedia]));
	const service = new DesktopSharedProjectMediaService(host);
	const result = await service.readProjectBundle(project.id);
	assert.deepEqual(result?.sources.map(({ kind }) => kind), ['video', 'video-timing']);
	assert.deepEqual(await service.beginSourceWrite({
		byteLength: timing.reference.byteLength,
		encoding: DESKTOP_LIBRARY_VIDEO_TIMING_ENCODING,
		projectId: project.id,
		projectRevision: project.revision,
		sha256: timing.reference.sha256,
		sourceId: fixture.source.id,
	}), {
		status: 'present',
		source: {
			bindingId: timingBinding.id,
			byteLength: timing.reference.byteLength,
			encoding: DESKTOP_LIBRARY_VIDEO_TIMING_ENCODING,
			kind: 'video-timing',
			sha256: timing.reference.sha256,
			sourceId: fixture.source.id,
			storageKey: timing.reference.storageKey,
		},
	});
});

test('timing CAS binding is body-stable across source-specific digest bindings', () => {
	const timing = createVideoTimingAssetPublication('c'.repeat(64), {
		timescale: 1_000,
		presentationTicks: [0n],
		finalFrameDurationTicks: 40n,
	});
	const transfer = {
		id: 'video-a',
		kind: 'video-timing' as const,
		...timing.reference,
		mimeType: 'application/vnd.soundscaper.video-timing' as const,
	};
	const alias = { ...transfer, id: 'video-b', sourceSha256: 'd'.repeat(64) };
	assert.equal(managedSourceBinding(transfer), managedSourceBinding(alias));
	assert.equal(
		desktopSharedManagedSourceBindingKey(transfer),
		desktopSharedManagedSourceBindingKey(alias),
	);
	assert.equal(
		managedSourceBinding(transfer),
		desktopSharedManagedSourceBindingKey(transfer),
	);
});

test('video source writes use the existing bounded upload session and exact project fence', async () => {
	const fixture = videoFixture();
	const bytes = Uint8Array.of(1, 3, 5, 7, 9);
	const sha256 = digest(bytes);
	const received: Uint8Array[] = [];
	const host = new FakeManagedMediaHost(bundle(fixture.project), {
		publish: async (options) => {
			for await (const chunk of options.chunks) received.push(chunk.slice());
			return mediaForPublication(options);
		},
	});
	const service = new DesktopSharedProjectMediaService(host, { randomId: () => WRITE_ID });

	const admission = await service.beginSourceWrite(videoDeclaration(fixture, bytes.byteLength, sha256));
	assert.equal(admission.status, 'ready');
	if (admission.status !== 'ready') throw new Error('Expected a ready video write');
	assert.deepEqual(await service.writeSourceChunk({
		writeId: admission.writeId,
		offset: 0,
		bytes: bytes.subarray(0, 2),
	}), { nextOffset: 2 });
	assert.deepEqual(await service.writeSourceChunk({
		writeId: admission.writeId,
		offset: 2,
		bytes: bytes.subarray(2),
	}), { nextOffset: bytes.byteLength });
	const descriptor = await service.finishSourceWrite({ writeId: admission.writeId, sha256 });

	assert.deepEqual(received, [bytes.subarray(0, 2), bytes.subarray(2)]);
	assert.equal(descriptor.kind, 'video');
	assert.equal(descriptor.encoding, DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING);
	assert.equal(descriptor.byteLength, bytes.byteLength);
	assert.equal(host.publications[0]?.expectedProjectRevision, fixture.project.revision);
	assert.equal(host.publications[0]?.expectedProjectSha256, PROJECT_DIGEST);
	assert.equal(host.publications[0]?.encoding, DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING);
});

test('present video admission revalidates the exact body and project fence without accepting upload bytes', async () => {
	const fixture = videoFixture();
	const media = mediaForVideo(fixture.project, fixture.source, 5, 'a'.repeat(64));
	const host = new FakeManagedMediaHost(bundle(fixture.project, [media]));
	const service = new DesktopSharedProjectMediaService(host);

	const admission = await service.beginSourceWrite(videoDeclaration(
		fixture,
		media.byteLength,
		media.sha256,
	));
	assert.deepEqual(admission, {
		status: 'present',
		source: {
			bindingId: media.id,
			byteLength: media.byteLength,
			encoding: DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
			kind: 'video',
			sha256: media.sha256,
			sourceId: fixture.source.id,
			storageKey: fixture.source.storageKey,
		},
	});
	assert.equal(host.publications.length, 1);
	assert.equal(host.publications[0]?.expectedProjectRevision, fixture.project.revision);
	assert.equal(host.publications[0]?.expectedProjectSha256, PROJECT_DIGEST);
	assert.equal(host.publications[0]?.encoding, DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING);
	await assert.rejects(async () => {
		for await (const _chunk of host.publications[0]?.chunks ?? []) { /* forbidden */ }
	}, /must not consume a new body/iu);
	await assert.rejects(
		service.beginSourceWrite(videoDeclaration(fixture, media.byteLength, 'b'.repeat(64))),
		/retained media.*source-write declaration/iu,
	);
	await assert.rejects(
		service.beginSourceWrite(videoDeclaration(fixture, media.byteLength + 1, media.sha256)),
		/retained media.*byte geometry/iu,
	);
	assert.equal(host.publications.length, 1);
});

test('video admission rejects empty bodies and encoding-kind mismatches before publication', async () => {
	const fixture = videoFixture();
	const host = new FakeManagedMediaHost(bundle(fixture.project));
	const service = new DesktopSharedProjectMediaService(host, { randomId: () => WRITE_ID });

	await assert.rejects(
		service.beginSourceWrite(videoDeclaration(fixture, 0, digest(new Uint8Array()))),
		/original video.*positive|byte length.*positive/iu,
	);
	await assert.rejects(service.beginSourceWrite({
		...videoDeclaration(fixture, 1, 'b'.repeat(64)),
		encoding: 'audio-f32le-chunks-v1',
	}), /encoding.*kind|accepts only audio/iu);
	assert.equal(host.publications.length, 0);
});

interface TestVideoSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'video';
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec: string;
	readonly hasAudio: boolean;
}

interface VideoFixture {
	readonly project: AudioEditorProjectCurrent;
	readonly source: TestVideoSource;
}

class FakeManagedMediaHost {
	readonly publications: DesktopProjectLibraryHostPublishMediaOptions[] = [];
	readonly #bundle: DesktopLibraryLoadedProjectBundle;
	readonly #publish: (
		options: DesktopProjectLibraryHostPublishMediaOptions,
	) => Promise<DesktopLibraryMedia>;

	constructor(
		bundleValue: DesktopLibraryLoadedProjectBundle,
		options: Readonly<{
			publish?: (
				publication: DesktopProjectLibraryHostPublishMediaOptions,
			) => Promise<DesktopLibraryMedia>;
		}> = {},
	) {
		this.#bundle = bundleValue;
		this.#publish = options.publish ?? ((publication) => Promise.resolve(mediaForPublication(publication)));
	}

	readProjectBundleById(projectId: string): Promise<DesktopLibraryLoadedProjectBundle | null> {
		return Promise.resolve(projectId === this.#bundle.project.id ? this.#bundle : null);
	}

	publishManagedMedia(options: DesktopProjectLibraryHostPublishMediaOptions): Promise<DesktopLibraryMedia> {
		this.publications.push(options);
		return this.#publish(options);
	}

	readManagedMedia(_bindingId: string, _options: DesktopLibraryManagedMediaReadOptions): Promise<Uint8Array> {
		return Promise.reject(new Error('Unexpected managed-media read'));
	}
}

function videoFixture(): VideoFixture {
	const source = createVideoSourceV9({
		id: 'managed-video',
		name: 'Managed video',
		mimeType: 'video/mp4',
		storageKey: 'managed-video-storage',
		frameCount: 120,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
	}) as TestVideoSource;
	const clip = createVideoClipV9({
		id: 'managed-video-bin-clip',
		sourceId: source.id,
		durationFrames: source.frameCount,
		binItemId: 'managed-video-bin-item',
	});
	const project = createCurrentAudioEditorProject({
		id: 'managed-video-project',
		title: 'Managed video project',
		revision: 8,
		now: '2026-08-01T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [source],
		projectBin: { clips: [clip] },
	});
	return Object.freeze({ project, source });
}

function videoDeclaration(
	fixture: VideoFixture,
	byteLength: number,
	sha256: string,
): DesktopSharedSourceWriteDeclaration {
	return Object.freeze({
		byteLength,
		encoding: DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
		projectId: fixture.project.id,
		projectRevision: fixture.project.revision,
		sha256,
		sourceId: fixture.source.id,
	});
}

function bundle(
	project: AudioEditorProjectCurrent,
	media: readonly DesktopLibraryMedia[] = [],
): DesktopLibraryLoadedProjectBundle {
	return Object.freeze({ catalog: catalogProject(project), project, media: Object.freeze([...media]) });
}

function catalogProject(project: AudioEditorProjectCurrent): DesktopLibraryProject {
	return Object.freeze({
		id: 'managed-video-entry',
		projectId: project.id,
		name: project.title,
		metadataFile: 'projects/managed-video-entry/project.scape',
		preferredProduct: 'soundscaper',
		updatedAtMs: 1,
		projectSchemaVersion: 11,
		projectRevision: project.revision,
		byteLength: 1,
		sha256: PROJECT_DIGEST,
	});
}

function mediaForVideo(
	project: AudioEditorProjectCurrent,
	source: TestVideoSource,
	byteLength: number,
	sha256: string,
): DesktopLibraryMedia {
	const binding = createDesktopLibraryVideoMediaBinding(
		project.id,
		desktopSharedManagedSourceBindingKey(
			project.sources.find(({ id }) => id === source.id) as Parameters<
				typeof desktopSharedManagedSourceBindingKey
			>[0],
		),
		project.revision,
		PROJECT_DIGEST,
	);
	return Object.freeze({ ...binding, byteLength, sha256 });
}

function mediaForPublication(options: DesktopProjectLibraryHostPublishMediaOptions): DesktopLibraryMedia {
	const binding = createDesktopLibraryVideoMediaBinding(
		options.projectId,
		options.storageKey,
		options.expectedProjectRevision,
		options.expectedProjectSha256,
	);
	return Object.freeze({ ...binding, byteLength: options.byteLength, sha256: options.sha256 });
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
