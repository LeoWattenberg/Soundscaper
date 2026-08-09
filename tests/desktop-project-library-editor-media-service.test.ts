/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type {
	DesktopLibraryMedia,
	DesktopLibraryProject,
} from '../desktop/project-library-contract.ts';
import {
	DesktopSharedProjectMediaService,
	MAXIMUM_SHARED_SOURCE_CHUNK_BYTES,
	MAXIMUM_SHARED_SOURCE_READS,
	MAXIMUM_SHARED_SOURCE_SESSIONS,
	type DesktopSharedSourceWriteDeclaration,
} from '../desktop/project-library-editor-media-service.ts';
import type {
	DesktopProjectLibraryHostPublishMediaOptions,
} from '../desktop/project-library-host.ts';
import {
	createDesktopLibraryAudioMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	type DesktopLibraryManagedMediaReadOptions,
} from '../desktop/project-library-media.ts';
import type {
	DesktopLibraryLoadedProjectBundle,
} from '../desktop/project-library-projects.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
} from '../src/common/editor/project-v9.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';

const NOW = '2026-08-01T12:00:00.000Z';
const PROJECT_ID = 'media-service-project';
const WRITE_ID = '1'.repeat(32);

interface TestAudioSource extends Readonly<Record<string, unknown>> {
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

interface ProjectFixture {
	readonly project: AudioEditorProjectCurrent;
	readonly reachableAudio: TestAudioSource;
	readonly uncataloguedAudio: TestAudioSource;
	readonly unreachableAudio: TestAudioSource;
	readonly videoSourceId: string;
}

interface MediaReadCall {
	readonly bindingId: string;
	readonly options: DesktopLibraryManagedMediaReadOptions;
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly reject: (reason?: unknown) => void;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}

type PublishHandler = (
	options: DesktopProjectLibraryHostPublishMediaOptions,
) => Promise<DesktopLibraryMedia>;

type ReadHandler = (
	bindingId: string,
	options: DesktopLibraryManagedMediaReadOptions,
) => Promise<Uint8Array>;

type BundleReadHandler = (
	projectId: string,
	signal?: AbortSignal,
) => Promise<DesktopLibraryLoadedProjectBundle | null>;

class FakeManagedMediaHost {
	readonly bundleReads: Array<Readonly<{ projectId: string; signal?: AbortSignal }>> = [];
	readonly publications: DesktopProjectLibraryHostPublishMediaOptions[] = [];
	readonly mediaReads: MediaReadCall[] = [];
	readonly #bundle: DesktopLibraryLoadedProjectBundle;
	readonly #bundleRead: BundleReadHandler;
	readonly #publish: PublishHandler;
	readonly #read: ReadHandler;

	constructor(
		bundle: DesktopLibraryLoadedProjectBundle,
		options: Readonly<{
			bundleRead?: BundleReadHandler;
			publish?: PublishHandler;
			read?: ReadHandler;
		}> = {},
	) {
		this.#bundle = bundle;
		this.#bundleRead = options.bundleRead
			?? ((projectId) => Promise.resolve(projectId === this.#bundle.project.id ? this.#bundle : null));
		this.#publish = options.publish ?? ((publication) => Promise.resolve(mediaForPublication(publication)));
		this.#read = options.read ?? (() => Promise.reject(new Error('Unexpected managed-media read')));
	}

	readProjectBundleById(
		projectId: string,
		signal?: AbortSignal,
	): Promise<DesktopLibraryLoadedProjectBundle | null> {
		this.bundleReads.push(Object.freeze({ projectId, ...(signal ? { signal } : {}) }));
		return this.#bundleRead(projectId, signal);
	}

	publishManagedMedia(options: DesktopProjectLibraryHostPublishMediaOptions): Promise<DesktopLibraryMedia> {
		this.publications.push(options);
		return this.#publish(options);
	}

	readManagedMedia(bindingId: string, options: DesktopLibraryManagedMediaReadOptions): Promise<Uint8Array> {
		this.mediaReads.push(Object.freeze({ bindingId, options }));
		return this.#read(bindingId, options);
	}
}

test('project bundles expose only reachable catalog-backed audio mappings', async () => {
	const fixture = projectFixture();
	const exposed = mediaForSource(fixture.project, fixture.reachableAudio, 'a'.repeat(64));
	const unreachable = mediaForSource(fixture.project, fixture.unreachableAudio, 'b'.repeat(64));
	const unrelatedVideoBinding = createDesktopLibraryAudioMediaBinding(
		fixture.project.id,
		'catalogued-video-body',
		fixture.project.revision,
		'0'.repeat(64),
	);
	const video = Object.freeze({
		...unrelatedVideoBinding,
		byteLength: 512,
		sha256: 'c'.repeat(64),
	});
	const host = new FakeManagedMediaHost(bundle(fixture.project, [exposed, unreachable, video]));
	const service = new DesktopSharedProjectMediaService(host);

	const result = await service.readProjectBundle(fixture.project.id);

	assert.ok(result);
	assert.equal(result.document, serializeScapeProjectDocument(fixture.project));
	assert.deepEqual(result.sources, [{
		bindingId: exposed.id,
		byteLength: canonicalByteLength(fixture.reachableAudio),
		encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
		kind: 'audio',
		sha256: exposed.sha256,
		sourceId: fixture.reachableAudio.id,
		storageKey: fixture.reachableAudio.storageKey,
	}]);
	assert.equal(host.publications.length, 0);
});

test('source-write admission rejects incorrect geometry and encoding-kind mismatches', async () => {
	const fixture = projectFixture();
	const host = new FakeManagedMediaHost(bundle(fixture.project));
	const service = new DesktopSharedProjectMediaService(host, { randomId: () => WRITE_ID });
	const declaration = uploadDeclaration(fixture.project, fixture.reachableAudio, 'd'.repeat(64));

	await assert.rejects(
		service.beginSourceWrite({ ...declaration, byteLength: declaration.byteLength + 1 }),
		/canonical PCM geometry/u,
	);
	await assert.rejects(
		service.beginSourceWrite({ ...declaration, sourceId: fixture.videoSourceId }),
		/encoding.*source kind/u,
	);
	assert.equal(host.publications.length, 0);
});

test('concurrent source-write admission reserves four slots before awaiting bundle reads', async () => {
	const fixture = projectFixture();
	const sha256 = 'd'.repeat(64);
	const existing = mediaForSource(fixture.project, fixture.reachableAudio, sha256);
	const loaded = bundle(fixture.project, [existing]);
	const reads: Array<Deferred<DesktopLibraryLoadedProjectBundle | null>> = [];
	const host = new FakeManagedMediaHost(loaded, {
		bundleRead: async () => {
			const pending = deferred<DesktopLibraryLoadedProjectBundle | null>();
			reads.push(pending);
			return pending.promise;
		},
	});
	const service = new DesktopSharedProjectMediaService(host);
	const declaration = uploadDeclaration(fixture.project, fixture.reachableAudio, sha256);
	const admissions = Array.from(
		{ length: MAXIMUM_SHARED_SOURCE_SESSIONS },
		() => service.beginSourceWrite(declaration),
	);
	const refused = service.beginSourceWrite(declaration);

	assert.equal(reads.length, MAXIMUM_SHARED_SOURCE_SESSIONS, 'pending bundle reads consume admission slots');
	await assert.rejects(refused, /session capacity is exhausted/u);
	const failure = new Error('injected bundle read failure');
	const firstFailure = assert.rejects(admissions[0] as Promise<unknown>, (error) => error === failure);
	reads[0]?.reject(failure);
	await firstFailure;

	const replacement = service.beginSourceWrite(declaration);
	assert.equal(reads.length, MAXIMUM_SHARED_SOURCE_SESSIONS + 1, 'a failed begin releases its reserved slot');
	for (const pending of reads.slice(1)) pending.resolve(loaded);
	const admitted = await Promise.all([...admissions.slice(1), replacement]);
	assert.ok(admitted.every(({ status }) => status === 'present'));

	const afterPresent = service.beginSourceWrite(declaration);
	assert.equal(reads.length, MAXIMUM_SHARED_SOURCE_SESSIONS + 2, 'present results release their reserved slots');
	reads.at(-1)?.resolve(loaded);
	assert.equal((await afterPresent).status, 'present');
});

test('source writes are sequential, chunk-bounded, and complete with the declared digest', async () => {
	const fixture = projectFixture();
	const payload = Uint8Array.from({ length: canonicalByteLength(fixture.reachableAudio) }, (_, index) => index + 1);
	const sha256 = createHash('sha256').update(payload).digest('hex');
	const received: Uint8Array[] = [];
	const host = new FakeManagedMediaHost(bundle(fixture.project), {
		publish: async (options) => {
			const hash = createHash('sha256');
			let byteLength = 0;
			for await (const chunk of options.chunks) {
				received.push(chunk.slice());
				hash.update(chunk);
				byteLength += chunk.byteLength;
			}
			assert.equal(byteLength, options.byteLength);
			assert.equal(hash.digest('hex'), options.sha256);
			return mediaForPublication(options);
		},
	});
	const service = new DesktopSharedProjectMediaService(host, { randomId: () => WRITE_ID });

	const admission = await service.beginSourceWrite(
		uploadDeclaration(fixture.project, fixture.reachableAudio, sha256),
	);
	assert.equal(admission.status, 'ready');
	if (admission.status !== 'ready') throw new Error('Expected a ready source-write admission');
	assert.equal(admission.chunkSize, MAXIMUM_SHARED_SOURCE_CHUNK_BYTES);
	await assert.rejects(service.writeSourceChunk({
		writeId: admission.writeId,
		offset: 0,
		bytes: new Uint8Array(MAXIMUM_SHARED_SOURCE_CHUNK_BYTES + 1),
	}), /chunk exceeds its byte limit/u);
	await assert.rejects(service.writeSourceChunk({
		writeId: admission.writeId,
		offset: 1,
		bytes: payload.subarray(0, 1),
	}), /offset is out of sequence/u);
	assert.deepEqual(await service.writeSourceChunk({
		writeId: admission.writeId,
		offset: 0,
		bytes: payload.subarray(0, 7),
	}), { nextOffset: 7 });
	assert.deepEqual(await service.writeSourceChunk({
		writeId: admission.writeId,
		offset: 7,
		bytes: payload.subarray(7),
	}), { nextOffset: payload.byteLength });

	const completed = await service.finishSourceWrite({ writeId: admission.writeId, sha256 });
	assert.equal(completed.sha256, sha256);
	assert.equal(completed.byteLength, payload.byteLength);
	assert.deepEqual(received, [payload.subarray(0, 7), payload.subarray(7)]);
	assert.equal(host.publications.length, 1);
	assert.equal(host.publications[0]?.expectedProjectRevision, fixture.project.revision);
	assert.equal(host.publications[0]?.expectedProjectSha256, '0'.repeat(64));
});

test('a digest change aborts an active source write', async () => {
	const fixture = projectFixture();
	const payload = new Uint8Array(canonicalByteLength(fixture.reachableAudio));
	const sha256 = createHash('sha256').update(payload).digest('hex');
	let publicationFailure: unknown;
	const host = new FakeManagedMediaHost(bundle(fixture.project), {
		publish: async (options) => {
			try {
				for await (const _chunk of options.chunks) {
					// Consume until the service closes or aborts the stream.
				}
				return mediaForPublication(options);
			} catch (error) {
				publicationFailure = error;
				throw error;
			}
		},
	});
	const service = new DesktopSharedProjectMediaService(host, { randomId: () => WRITE_ID });
	const admission = await service.beginSourceWrite(
		uploadDeclaration(fixture.project, fixture.reachableAudio, sha256),
	);
	assert.equal(admission.status, 'ready');
	if (admission.status !== 'ready') throw new Error('Expected a ready source-write admission');
	await service.writeSourceChunk({ writeId: admission.writeId, offset: 0, bytes: payload });

	await assert.rejects(
		service.finishSourceWrite({ writeId: admission.writeId, sha256: 'f'.repeat(64) }),
		/changed while it was being transferred/u,
	);
	assert.ok(publicationFailure instanceof Error);
	assert.match(publicationFailure.message, /changed while it was being transferred/u);
	assert.equal(await service.abortSourceWrite(admission.writeId), false);
});

test('managed-media reads delegate their bounded range and abort signal to the host', async () => {
	const fixture = projectFixture();
	const controller = new AbortController();
	const body = Uint8Array.from([10, 20, 30, 40, 50, 60]);
	const host = new FakeManagedMediaHost(bundle(fixture.project), {
		read: (_bindingId, options) => {
			if (options.length > 4) return Promise.reject(new RangeError('Fake host read limit exceeded'));
			return Promise.resolve(body.slice(options.offset, options.offset + options.length));
		},
	});
	const service = new DesktopSharedProjectMediaService(host);

	assert.deepEqual(await service.readSourceChunk('m'.padEnd(65, 'a'), {
		offset: 1,
		length: 3,
		signal: controller.signal,
	}), Uint8Array.from([20, 30, 40]));
	assert.equal(host.mediaReads[0]?.bindingId, 'm'.padEnd(65, 'a'));
	assert.equal(host.mediaReads[0]?.options.offset, 1);
	assert.equal(host.mediaReads[0]?.options.length, 3);
	assert.equal(host.mediaReads[0]?.options.signal, controller.signal);
	await assert.rejects(service.readSourceChunk('m'.padEnd(65, 'a'), {
		offset: 0,
		length: 5,
	}), /Fake host read limit exceeded/u);
	assert.equal(host.mediaReads.length, 2);
});

test('managed-media reads reserve and release four bounded concurrency slots', async () => {
	const fixture = projectFixture();
	const reads: Array<Deferred<Uint8Array>> = [];
	const host = new FakeManagedMediaHost(bundle(fixture.project), {
		read: async () => {
			const pending = deferred<Uint8Array>();
			reads.push(pending);
			return pending.promise;
		},
	});
	const service = new DesktopSharedProjectMediaService(host);
	const bindingId = 'm'.padEnd(65, 'a');
	const active = Array.from(
		{ length: MAXIMUM_SHARED_SOURCE_READS },
		() => service.readSourceChunk(bindingId, { offset: 0, length: 1 }),
	);
	const refused = service.readSourceChunk(bindingId, { offset: 1, length: 1 });

	assert.equal(reads.length, MAXIMUM_SHARED_SOURCE_READS);
	await assert.rejects(refused, /read capacity is exhausted/u);
	reads[0]?.resolve(Uint8Array.of(1));
	assert.deepEqual(await active[0], Uint8Array.of(1));

	const replacement = service.readSourceChunk(bindingId, { offset: 1, length: 1 });
	assert.equal(reads.length, MAXIMUM_SHARED_SOURCE_READS + 1);
	for (const pending of reads.slice(1)) pending.resolve(Uint8Array.of(2));
	assert.deepEqual(await replacement, Uint8Array.of(2));
	await Promise.all(active.slice(1));
});

test('disposing the service aborts a pending upload and its blocked chunk write', async () => {
	const fixture = projectFixture();
	const chunkReceived = deferred<void>();
	const resumeConsumer = deferred<void>();
	let publicationFailure: unknown;
	let receivedChunk: Uint8Array | undefined;
	const host = new FakeManagedMediaHost(bundle(fixture.project), {
		publish: async (options) => {
			const iterator = options.chunks[Symbol.asyncIterator]();
			try {
				const first = await iterator.next();
				assert.equal(first.done, false);
				receivedChunk = first.value.slice();
				chunkReceived.resolve();
				await resumeConsumer.promise;
				await iterator.next();
				throw new Error('Disposed upload unexpectedly remained readable');
			} catch (error) {
				publicationFailure = error;
				throw error;
			}
		},
	});
	const service = new DesktopSharedProjectMediaService(host, { randomId: () => WRITE_ID });
	const declaration = uploadDeclaration(fixture.project, fixture.reachableAudio, 'e'.repeat(64));
	const admission = await service.beginSourceWrite(declaration);
	assert.equal(admission.status, 'ready');
	if (admission.status !== 'ready') throw new Error('Expected a ready source-write admission');
	const chunk = Uint8Array.from([1, 2, 3]);
	const pendingWrite = service.writeSourceChunk({ writeId: admission.writeId, offset: 0, bytes: chunk });
	await chunkReceived.promise;

	const disposal = service.dispose();
	await assert.rejects(pendingWrite, /service was disposed/u);
	resumeConsumer.resolve();
	await disposal;
	assert.deepEqual(receivedChunk, chunk);
	assert.ok(publicationFailure instanceof Error);
	assert.match(publicationFailure.message, /service was disposed/u);
	await assert.rejects(service.beginSourceWrite(declaration), /service is disposed/u);
});

function projectFixture(): ProjectFixture {
	const reachableAudio = audioSource('reachable-audio');
	const uncataloguedAudio = audioSource('uncatalogued-audio');
	const unreachableAudio = audioSource('unreachable-audio');
	const video = createVideoSourceV9({
		id: 'reachable-video',
		name: 'Reachable video',
		mimeType: 'video/mp4',
		storageKey: 'reachable-video-storage',
		frameCount: 12,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
		posterStorageKey: 'reachable-video-poster',
		thumbnailStorageKey: 'reachable-video-thumbnail',
	});
	const reachableClip = createAudioClipV9({
		id: 'reachable-audio-clip',
		sourceId: reachableAudio.id,
		durationFrames: reachableAudio.frameCount,
	});
	const project = createCurrentAudioEditorProject({
		id: PROJECT_ID,
		title: 'Managed media service fixture',
		revision: 7,
		now: NOW,
		sampleRate: 48_000,
		sources: [reachableAudio, uncataloguedAudio, unreachableAudio, video],
		clips: [reachableClip],
		tracks: [createAudioTrackV9({
			id: 'reachable-audio-track',
			clipIds: [reachableClip.id],
		})],
		projectBin: { clips: [
			createAudioClipV9({
				id: 'uncatalogued-audio-bin-clip',
				sourceId: uncataloguedAudio.id,
				durationFrames: uncataloguedAudio.frameCount,
				binItemId: 'uncatalogued-audio-bin-item',
			}),
			createVideoClipV9({
				id: 'reachable-video-bin-clip',
				sourceId: video.id,
				durationFrames: 2,
				binItemId: 'reachable-video-bin-item',
			}),
		] },
	});
	return Object.freeze({
		project,
		reachableAudio,
		uncataloguedAudio,
		unreachableAudio,
		videoSourceId: String(video.id),
	});
}

function audioSource(id: string): TestAudioSource {
	return createAudioSourceV9({
		id,
		name: id,
		mimeType: 'audio/wav',
		storageKey: `${id}-storage`,
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 2,
	}) as TestAudioSource;
}

function bundle(
	project: AudioEditorProjectCurrent,
	media: readonly DesktopLibraryMedia[] = [],
): DesktopLibraryLoadedProjectBundle {
	return Object.freeze({ catalog: catalogProject(project), project, media: Object.freeze([...media]) });
}

function catalogProject(project: AudioEditorProjectCurrent): DesktopLibraryProject {
	return Object.freeze({
		id: 'media-service-entry',
		projectId: project.id,
		name: project.title,
		metadataFile: 'projects/media-service-entry/project.scape',
		preferredProduct: 'soundscaper',
		updatedAtMs: 1,
		projectSchemaVersion: 12,
		projectRevision: project.revision,
		byteLength: 1,
		sha256: '0'.repeat(64),
	});
}

function mediaForSource(
	project: AudioEditorProjectCurrent,
	source: TestAudioSource,
	sha256: string,
): DesktopLibraryMedia {
	const binding = createDesktopLibraryAudioMediaBinding(
		project.id, sourceBindingKey(source), project.revision, '0'.repeat(64),
	);
	return Object.freeze({ ...binding, byteLength: canonicalByteLength(source), sha256 });
}

function mediaForPublication(options: DesktopProjectLibraryHostPublishMediaOptions): DesktopLibraryMedia {
	const binding = createDesktopLibraryAudioMediaBinding(
		options.projectId,
		options.storageKey,
		options.expectedProjectRevision,
		options.expectedProjectSha256,
	);
	return Object.freeze({ ...binding, byteLength: options.byteLength, sha256: options.sha256 });
}

function uploadDeclaration(
	project: AudioEditorProjectCurrent,
	source: TestAudioSource,
	sha256: string,
): DesktopSharedSourceWriteDeclaration {
	return Object.freeze({
		byteLength: canonicalByteLength(source),
		encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
		projectId: project.id,
		projectRevision: project.revision,
		sha256,
		sourceId: source.id,
	});
}

function sourceBindingKey(source: TestAudioSource): string {
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

function canonicalByteLength(source: TestAudioSource): number {
	const chunks = source.frameCount === 0 ? 0 : Math.ceil(source.frameCount / source.chunkFrames);
	return source.frameCount * source.channelCount * Float32Array.BYTES_PER_ELEMENT + chunks * 4;
}

function deferred<Value>(): Deferred<Value> {
	let resolve: Deferred<Value>['resolve'] = () => undefined;
	let reject: Deferred<Value>['reject'] = () => undefined;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return Object.freeze({ promise, reject, resolve });
}
