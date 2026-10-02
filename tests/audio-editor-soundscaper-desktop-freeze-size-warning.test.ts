/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperDesktopProjectLibraryHandshake } from '../desktop/soundscaper-project-library-contract.ts';
import { FileSizeWarningRequiredError } from '../src/common/editor/controller/shared/file-size-warning.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import { scapeAudioSourceLayout } from '../src/common/editor/scape-archive-media.ts';
import { acquireSoundscaperDesktopFreezeBodies, type SoundscaperDesktopFreezeStore } from '../src/soundscaper/desktop-project-library-freeze-media.ts';
import { SoundscaperDesktopFreezeSizeAdmission } from '../src/soundscaper/desktop-project-library-freeze-size-warning.ts';
import { snapshotSoundscaperDesktopProject, soundscaperDesktopBodiesForProject, type SoundscaperDesktopBundleSnapshot, type SoundscaperDesktopRendererBridge } from '../src/soundscaper/desktop-project-library-renderer-contract.ts';
import { connectSoundscaperDesktopProjectLibraryRenderer, type SoundscaperDesktopProjectLibraryShadowStore } from '../src/soundscaper/desktop-project-library-renderer.ts';
import { createSoundscaperDesktopDocumentApproval, soundscaperDesktopMediaWarningOptions } from '../src/soundscaper/desktop-project-library-publication-warning.ts';
import { SOUNDSCAPER_PROJECT_RUNTIME_PROFILE } from '../src/soundscaper/editor-project-runtime-profile.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const THRESHOLD = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes;

test('large Soundscaper freeze inventory confirms before any body acquisition', async () => {
	const fixture = freezeFixture();
	const reached = new Error('acquisition reached');
	let metadataReads = 0;
	const store = { getSourceMetadata: () => { metadataReads += 1; throw reached; } } as unknown as SoundscaperDesktopFreezeStore;
	const bridge = {} as Pick<SoundscaperDesktopRendererBridge, 'readBodyChunk'>;
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies(fixture, bridge, store, undefined,
		{ confirmFileSizeWarning: async (warning) => { assert.equal(warning.byteLength, fixture.bundle.bodies[0]!.byteLength); return false; } }),
		{ name: 'AbortError' });
	assert.equal(metadataReads, 0);
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies(fixture, bridge, store, undefined,
		{ confirmFileSizeWarning: async () => true }), (error) => error === reached);
	assert.equal(metadataReads, 1);
});

test('a freeze decision rechecks cancellation and currentness before storage reads', async () => {
	const fixture = freezeFixture();
	const abort = new AbortController();
	let metadataReads = 0;
	const store = { getSourceMetadata: () => { metadataReads += 1; } } as unknown as SoundscaperDesktopFreezeStore;
	const bridge = {} as Pick<SoundscaperDesktopRendererBridge, 'readBodyChunk'>;
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies(fixture, bridge, store, abort.signal,
		{ confirmFileSizeWarning: async () => { abort.abort(); return true; } }), { name: 'AbortError' });
	let current = true;
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies(fixture, bridge, store, undefined,
		{ assertCurrent: () => { if (!current) throw new Error('stale owner'); },
			confirmFileSizeWarning: async () => { current = false; return true; } }), /stale owner/u);
	assert.equal(metadataReads, 0);
});

test('freeze chunk count and exact descriptor size remain strict before confirmation', async () => {
	let prompts = 0;
	const options = { confirmFileSizeWarning: async () => { prompts += 1; return true; } };
	const store = {} as SoundscaperDesktopFreezeStore;
	const bridge = {} as Pick<SoundscaperDesktopRendererBridge, 'readBodyChunk'>;
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies(freezeFixture(65_537 * 16_384), bridge, store,
		undefined, options), /chunk limit/u);
	const fixture = freezeFixture();
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies({ ...fixture,
		bundle: { ...fixture.bundle, bodies: [{ ...fixture.bundle.bodies[0]!, byteLength: 1 }] } }, bridge, store,
		undefined, options), /exact.*length|descriptor/iu);
	assert.equal(prompts, 0);
});

test('freeze admission reuses only accepted owner/project bounds for automatic operations', async () => {
	const admission = new SoundscaperDesktopFreezeSizeAdmission();
	let prompts = 0;
	const confirm = async () => { prompts += 1; return true; };
	const warning = { label: 'Desktop project media', byteLength: THRESHOLD + 1, thresholdBytes: THRESHOLD };
	admission.setConfirmation(confirm);
	assert.equal(await admission.options('project', {}, true).confirmFileSizeWarning!(warning), true);
	assert.equal(await admission.options('project', {}).confirmFileSizeWarning!(warning), true);
	assert.equal(prompts, 1);
	await assert.rejects(admission.options('other', {}).confirmFileSizeWarning!(warning), FileSizeWarningRequiredError);
	await assert.rejects(admission.options('project', {}).confirmFileSizeWarning!({ ...warning, byteLength: THRESHOLD + 2 }), FileSizeWarningRequiredError);
	assert.equal(await admission.options('project', { confirmFileSizeWarning: confirm }).confirmFileSizeWarning!(warning), true);
	assert.equal(prompts, 2);
	admission.forget('project');
	await assert.rejects(admission.options('project', {}).confirmFileSizeWarning!(warning), FileSizeWarningRequiredError);
});

test('scoped document approval preserves the original explicit media warning options', () => {
	const callback = async () => true;
	const options = { confirmFileSizeWarning: callback, assertCurrent: () => undefined };
	const approved = createSoundscaperDesktopDocumentApproval(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		{ byteLength: 12, sha256: 'a'.repeat(64) }, options);
	assert.deepEqual(soundscaperDesktopMediaWarningOptions(approved), options);
});

test('desktop renderer confirms large media before native publication or recipient shadow acquisition', async () => {
	const source = createAudioSource({ ...freezeFixture().project.sources[0]!, sampleFormat: 'float32', originalSampleRate: 48_000 });
	const live = createAudioSource({ ...source, id: 'live-source', storageKey: 'live-body', frameCount: 2 });
	const clip = createAudioClip({ id: 'live-clip', sourceId: live.id, durationFrames: 2, sourceDurationFrames: 2 });
	const track = createAudioTrack({ id: 'freeze-track', clipIds: [clip.id], audioFreeze: { schemaVersion: 1,
		derivedSourceId: source.id, inputDigestSha256: 'ab'.repeat(32), rackDigestSha256: 'ab'.repeat(32),
		automationDigestSha256: 'ab'.repeat(32), freshnessDigestSha256: 'ab'.repeat(32),
		renderStartFrame: 0, renderFrameCount: source.frameCount, capturePosition: 'post-insert-pre-strip' } });
	const project = createSoundscaperProject({ id: 'large-freeze-project', title: 'Large freeze',
		sources: [source, live], tracks: [track], clips: [clip], sequences: [{ id: 'main', trackIds: [track.id] }], primarySequenceId: 'main' });
	const snapshot = snapshotSoundscaperDesktopProject(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE, project);
	const bodies = soundscaperDesktopBodiesForProject(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE, project, snapshot.sha256).bodies;
	let remote: unknown = null;
	let begins = 0;
	let bodyReads = 0;
	const reached = new Error('native admission reached');
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	const bridge = { connect: async () => handshake, handshakeState: () => 'admitted',
		listProjects: async () => ({ metadataRevision: 0, projects: [] }), readProjectBundle: async () => remote,
		beginPublication: async () => { begins += 1; throw reached; }, abortPublication: async () => true,
		readBodyChunk: async () => { bodyReads += 1; throw new Error('unexpected body read'); } };
	for (const method of ['claimProjectWriteFence', 'checkProjectWriteFence', 'writePublicationChunk', 'finishPublication',
		'deleteProject', 'duplicateProject', 'persistNativePluginState', 'readNativePluginState']) {
		Object.defineProperty(bridge, method, { enumerable: true, value: async () => { throw new Error(`unexpected ${method}`); } });
	}
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'soundscaperProjectLibraryDesktop');
	Object.defineProperty(globalThis, 'soundscaperProjectLibraryDesktop', { configurable: true, enumerable: true, value: Object.freeze({ v1: Object.freeze(bridge) }) });
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		storageManager: { estimate: async () => ({ quota: 1024 ** 3, usage: 0 }), persist: async () => true,
			persisted: async () => true } as unknown as StorageManager });
	try {
		await store.ready();
		const renderer = await connectSoundscaperDesktopProjectLibraryRenderer(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
			{ store: store as unknown as SoundscaperDesktopProjectLibraryShadowStore });
		assert.ok(renderer);
		await assert.rejects(renderer.createScapeProjectIfAbsent(project, { confirmFileSizeWarning: async () => false }), { name: 'AbortError' });
		assert.equal(begins, 0);
		await assert.rejects(renderer.createScapeProjectIfAbsent(project, { confirmFileSizeWarning: async () => true }), (error) => error === reached);
		assert.equal(begins, 1);
		const entryId = 'largefreeze';
		remote = { metadataRevision: 1, document: snapshot.document, bodies, project: {
			id: entryId, projectId: project.id, name: project.title, metadataFile: `${entryId}/0-${snapshot.sha256}.json`,
			preferredProduct: 'soundscaper', updatedAtMs: Date.parse(String(project.updatedAt)), schemaFamily: project.schemaFamily,
			schemaVersion: project.schemaVersion, projectRevision: 0, byteLength: snapshot.byteLength, sha256: snapshot.sha256 } };
		renderer.setFileSizeWarningConfirmation(async () => false);
		await assert.rejects(renderer.readProject(String(project.id)), { name: 'AbortError' });
		assert.equal(bodyReads, 0);
		assert.equal(await store.loadProject(String(project.id)), null);
	} finally {
		await store.close();
		if (previous) Object.defineProperty(globalThis, 'soundscaperProjectLibraryDesktop', previous);
		else Reflect.deleteProperty(globalThis, 'soundscaperProjectLibraryDesktop');
	}
});

function freezeFixture(frameCount = 536_870_913): SoundscaperDesktopBundleSnapshot {
	const source = { id: 'freeze-source', kind: 'audio', name: 'Large freeze', storageKey: 'freeze-body',
		mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 32, frameCount, chunkFrames: 16_384,
		contentSha256: 'ab'.repeat(32) };
	const layout = scapeAudioSourceLayout(source);
	return { project: { id: 'large-freeze-project', sources: [source] } as unknown as SoundscaperProject,
		bundle: { metadataRevision: 1, project: { projectId: 'large-freeze-project', projectRevision: 1,
			sha256: 'cd'.repeat(32) }, bodies: [{ kind: 'audio-freeze', encoding: 'audio-f32le-chunks-v1',
			bindingId: `f${'ab'.repeat(32)}`, sourceId: source.id, storageKey: source.storageKey,
			mimeType: 'application/vnd.soundscaper.audio-f32le-chunks', byteLength: layout.archiveBytes,
			sha256: source.contentSha256 }] } } as unknown as SoundscaperDesktopBundleSnapshot;
}
