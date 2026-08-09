/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10, type AudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import type {
	DesktopLibraryMedia,
	DesktopLibraryProject,
} from '../desktop/project-library-contract.ts';
import {
	DesktopSharedProjectMediaService,
	MAXIMUM_SHARED_SOURCE_SESSIONS,
	type DesktopSharedSourceWriteAdmission,
	type DesktopSharedSourceWriteDeclaration,
} from '../desktop/project-library-editor-media-service.ts';
import type {
	DesktopProjectLibraryHostPublishMediaOptions,
} from '../desktop/project-library-host.ts';
import {
	createDesktopLibraryAudioMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
} from '../desktop/project-library-media.ts';
import type {
	DesktopLibraryLoadedProjectBundle,
} from '../desktop/project-library-projects.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const PROJECT_SHA256 = '0'.repeat(64);
const SOURCE_SHA256 = '1'.repeat(64);
const PAYLOAD = Uint8Array.of(4, 0, 0, 0, 0, 0, 0, 0);

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}

class StalledPublicationHost {
	readonly gates: Deferred<void>[] = [];
	readonly #bundle: DesktopLibraryLoadedProjectBundle;

	constructor(project: AudioEditorProjectV10) {
		this.#bundle = Object.freeze({
			catalog: catalogProject(project),
			media: Object.freeze([]),
			project,
		});
	}

	readProjectBundleById(projectId: string): Promise<DesktopLibraryLoadedProjectBundle | null> {
		return Promise.resolve(projectId === this.#bundle.project.id ? this.#bundle : null);
	}

	async publishManagedMedia(
		options: DesktopProjectLibraryHostPublishMediaOptions,
	): Promise<DesktopLibraryMedia> {
		const gate = deferred<void>();
		this.gates.push(gate);
		let inputFailure: unknown;
		try {
			for await (const _chunk of options.chunks) {
				// Drain the bounded input before publication finalization.
			}
		} catch (error) {
			inputFailure = error;
		}
		await gate.promise;
		if (inputFailure) throw inputFailure;
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
	}

	readManagedMedia(): Promise<Uint8Array> {
		return Promise.reject(new Error('Unexpected managed-media read'));
	}

	releaseAll(): void {
		for (const gate of this.gates) gate.resolve(undefined);
	}
}

test('finishing uploads retain all four capacity slots until publication settles', async (context) => {
	const fixture = serviceFixture(context);
	const uploads = await openUploads(fixture.service, fixture.declaration, true);
	const finishing = uploads.map((admission) => fixture.service.finishSourceWrite({
		writeId: readyId(admission),
		sha256: SOURCE_SHA256,
	}));

	await assert.rejects(
		fixture.service.beginSourceWrite(fixture.declaration),
		/session capacity is exhausted/u,
	);
	fixture.host.gates[0]?.resolve(undefined);
	await finishing[0];

	const replacement = await fixture.service.beginSourceWrite(fixture.declaration);
	assert.equal(replacement.status, 'ready');
	const abortingReplacement = fixture.service.abortSourceWrite(readyId(replacement));
	fixture.host.gates.at(-1)?.resolve(undefined);
	assert.equal(await abortingReplacement, true);
	for (const gate of fixture.host.gates.slice(1, MAXIMUM_SHARED_SOURCE_SESSIONS)) {
		gate.resolve(undefined);
	}
	await Promise.all(finishing.slice(1));
});

test('aborting uploads retain all four capacity slots until cleanup settles', async (context) => {
	const fixture = serviceFixture(context);
	const uploads = await openUploads(fixture.service, fixture.declaration, false);
	const aborting = uploads.map((admission) => fixture.service.abortSourceWrite(readyId(admission)));

	await assert.rejects(
		fixture.service.beginSourceWrite(fixture.declaration),
		/session capacity is exhausted/u,
	);
	fixture.host.gates[0]?.resolve(undefined);
	assert.equal(await aborting[0], true);

	const replacement = await fixture.service.beginSourceWrite(fixture.declaration);
	assert.equal(replacement.status, 'ready');
	const abortingReplacement = fixture.service.abortSourceWrite(readyId(replacement));
	fixture.host.gates.at(-1)?.resolve(undefined);
	assert.equal(await abortingReplacement, true);
	for (const gate of fixture.host.gates.slice(1, MAXIMUM_SHARED_SOURCE_SESSIONS)) {
		gate.resolve(undefined);
	}
	assert.deepEqual(await Promise.all(aborting.slice(1)), [true, true, true]);
});

test('service disposal waits for a finishing publication', async (context) => {
	const fixture = serviceFixture(context);
	const [upload] = await openUploads(fixture.service, fixture.declaration, true, 1);
	if (!upload) throw new Error('Expected one managed-source upload');
	const finishing = fixture.service.finishSourceWrite({
		writeId: readyId(upload),
		sha256: SOURCE_SHA256,
	});
	let disposed = false;
	const disposal = fixture.service.dispose().then(() => { disposed = true; });
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(disposed, false);

	fixture.host.gates[0]?.resolve(undefined);
	await Promise.all([finishing, disposal]);
	assert.equal(disposed, true);
});

function serviceFixture(context: TestContext): Readonly<{
	declaration: DesktopSharedSourceWriteDeclaration;
	host: StalledPublicationHost;
	service: DesktopSharedProjectMediaService;
}> {
	const project = projectFixture();
	const host = new StalledPublicationHost(project);
	let nextId = 0;
	const service = new DesktopSharedProjectMediaService(host, {
		randomId: () => (++nextId).toString(16).padStart(32, '0'),
	});
	context.after(async () => {
		host.releaseAll();
		await service.dispose();
	});
	return Object.freeze({
		declaration: Object.freeze({
			byteLength: PAYLOAD.byteLength,
			encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
			projectId: project.id,
			projectRevision: project.revision,
			sha256: SOURCE_SHA256,
			sourceId: String(project.sources[0]?.id),
		}),
		host,
		service,
	});
}

async function openUploads(
	service: DesktopSharedProjectMediaService,
	declaration: DesktopSharedSourceWriteDeclaration,
	writeBody: boolean,
	count = MAXIMUM_SHARED_SOURCE_SESSIONS,
): Promise<DesktopSharedSourceWriteAdmission[]> {
	const uploads: DesktopSharedSourceWriteAdmission[] = [];
	for (let index = 0; index < count; index += 1) {
		const admission = await service.beginSourceWrite(declaration);
		uploads.push(admission);
		if (writeBody) {
			await service.writeSourceChunk({
				writeId: readyId(admission),
				offset: 0,
				bytes: PAYLOAD,
			});
		}
	}
	return uploads;
}

function readyId(admission: DesktopSharedSourceWriteAdmission): string {
	if (admission.status !== 'ready') throw new Error('Expected a ready managed-source upload');
	return admission.writeId;
}

function projectFixture(): AudioEditorProjectV10 {
	const source = createAudioSourceV9({
		id: 'lifecycle-audio-source',
		storageKey: 'lifecycle-audio-storage',
		name: 'Lifecycle audio',
		mimeType: 'audio/wav',
		frameCount: 1,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 1,
	});
	const clip = createAudioClipV9({
		id: 'lifecycle-audio-clip',
		sourceId: source.id,
		durationFrames: 1,
	});
	return createAudioEditorProjectV10({
		id: 'managed-upload-lifecycle-project',
		title: 'Managed upload lifecycle',
		revision: 2,
		now: '2026-08-01T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [createAudioTrackV9({ id: 'lifecycle-audio-track', clipIds: [clip.id] })],
	});
}

function catalogProject(project: AudioEditorProjectV10): DesktopLibraryProject {
	return Object.freeze({
		id: 'managed-upload-lifecycle-entry',
		projectId: project.id,
		name: project.title,
		metadataFile: 'projects/managed-upload-lifecycle-entry/project.scape',
		preferredProduct: 'soundscaper',
		updatedAtMs: 1,
		projectSchemaVersion: 10,
		projectRevision: project.revision,
		byteLength: 1,
		sha256: PROJECT_SHA256,
	});
}

function deferred<Value>(): Deferred<Value> {
	let resolve: Deferred<Value>['resolve'] = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return Object.freeze({ promise, resolve });
}
