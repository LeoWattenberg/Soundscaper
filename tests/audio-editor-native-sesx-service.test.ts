/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const SESSION_ID = 'a'.repeat(64);
const SAMPLE_RATE = 48_000;
const SESX = `<?xml version="1.0"?><!DOCTYPE sesx><sesx version="1.9">
<session sampleRate="48000" audioChannelType="stereo"><tracks>
<audioTrack id="1" index="1"><trackParameters><name>Voice</name></trackParameters>
<trackAudioParameters audioChannelType="stereo"/>
<audioClip id="0" fileID="0" name="First" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800"/>
<audioClip id="1" fileID="1" name="Second" startPoint="4800" endPoint="9600" sourceInPoint="0" sourceOutPoint="4800"/>
</audioTrack></tracks></session>
<files><file id="0" relativePath="Audio/first.wav"/><file id="1" relativePath="Audio/second.wav"/></files>
</sesx>`;

function sessionFile(name = 'Session.sesx'): File {
	const file = new File([SESX], name, { type: 'application/xml' });
	registerDesktopReadCapability(file, SESSION_ID);
	return file;
}

function wav(): Blob {
	const samples = new Float32Array(6_000).fill(0.25);
	return new Blob([encodeWav([samples, samples], { sampleRate: SAMPLE_RATE, float: true }) as Uint8Array<ArrayBuffer>], {
		type: 'audio/wav',
	});
}

function uniqueIds(): (prefix: string) => string {
	let next = 0;
	return (prefix) => `${prefix}-${++next}`;
}

interface LookupCall { readonly relativePath: string; readonly mediaRootId?: string }

function desktopFiles(options: Readonly<{
	secondInFolder?: boolean; cancelFolder?: boolean; secondMissing?: boolean; secondScanLimited?: boolean; audio?: Blob;
}> = {}) {
	const audio = options.audio ?? wav();
	const calls: LookupCall[] = [];
	const released: string[] = [];
	const activeDescriptors = new Set<string>();
	let folders = 0;
	const files = {
		isDesktop: true,
		async resolveSesxMedia(request: { sessionReadId: string; relativePath: string; mediaRootId?: string }) {
			assert.equal(request.sessionReadId, SESSION_ID);
			assert.equal(activeDescriptors.size, 0, 'each read capability is retired before the next lookup');
			calls.push({ relativePath: request.relativePath, ...(request.mediaRootId ? { mediaRootId: request.mediaRootId } : {}) });
			if (request.relativePath === 'Audio/second.wav' && request.mediaRootId && options.secondScanLimited) {
				return { status: 'scan-limited' as const };
			}
			if (request.relativePath === 'Audio/second.wav'
				&& (options.secondMissing || options.secondScanLimited || (options.secondInFolder && !request.mediaRootId))) {
				return { status: 'missing' as const };
			}
			activeDescriptors.add(request.relativePath);
			return { status: 'found' as const, descriptor: {
				id: request.relativePath, name: request.relativePath.split('/').at(-1),
				readProfile: 'linked-audio-range-v1', size: audio.size,
				url: `soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/${request.relativePath}`,
				mimeType: 'audio/wav',
			} };
		},
		async chooseSesxMediaFolder(request: { sessionReadId: string }) {
			assert.equal(request.sessionReadId, SESSION_ID);
			folders += 1;
			return options.cancelFolder
				? { status: 'cancelled' as const }
				: { status: 'selected' as const, mediaRootId: 'root-1' };
		},
		async withReadDescriptors<Value>(descriptors: readonly { id: string }[], _request: { signal?: AbortSignal }, consume: (blobs: readonly Blob[]) => PromiseLike<Value> | Value): Promise<Value> {
			assert.equal(descriptors.length, 1);
			try { return await consume([audio]); }
			finally { activeDescriptors.delete(descriptors[0]!.id); }
		},
		async releaseSesxSession(id: string) {
			assert.equal(activeDescriptors.size, 0, 'session release must not strand media reads');
			released.push(id);
			return true;
		},
	};
	return { fileService: files as unknown as NativeProjectFileService, calls, released, folderCount: () => folders };
}

test('desktop SESX import finds media beside the session, retries a chosen folder, and activates editable audio', async () => {
	const desktop = desktopFiles({ secondInFolder: true });
	const written: Array<{ sourceId: string; frames: number }> = [];
	const fixture = createFixture({
		createStableId: uniqueIds(),
		fileService: desktop.fileService,
		store: {
			estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
			beginSourceWrite: async (sourceId) => ({
				write: async (channels) => { written.push({ sourceId, frames: channels[0]?.length ?? 0 }); },
				commit: async () => undefined,
				abort: async () => undefined,
			}),
			deleteSource: async () => undefined,
		},
	});
	const result = await createNativeProjectService(fixture.runtime).openSesx(sessionFile());
	assert.ok(result);
	assert.equal(result.project.schemaVersion, 17);
	assert.equal(result.project.sources.length, 2);
	assert.equal(result.project.clips.length, 2);
	assert.equal(written.length, 2);
	assert.deepEqual(fixture.switched, [result.project.id]);
	assert.deepEqual(desktop.calls, [
		{ relativePath: 'Audio/first.wav' },
		{ relativePath: 'Audio/second.wav' },
		{ relativePath: 'Audio/second.wav', mediaRootId: 'root-1' },
	]);
	assert.equal(desktop.folderCount(), 1);
	assert.deepEqual(desktop.released, [SESSION_ID]);
	assert.equal(fixture.state.importing, false);
	assert.equal(fixture.statuses.at(-1)?.state, 'success');
});

test('cancelled media-folder search opens available SESX clips and reports missing media', async () => {
	const desktop = desktopFiles({ secondMissing: true, cancelFolder: true });
	const fixture = createFixture({ fileService: desktop.fileService, createStableId: uniqueIds() });
	const result = await createNativeProjectService(fixture.runtime).openSesx(sessionFile());
	assert.ok(result);
	assert.equal(result.project.clips.length, 1);
	assert.ok((result.report as { items: { code: string }[] }).items.some((item) => item.code === 'sesx.media-missing'));
	assert.deepEqual(desktop.released, [SESSION_ID]);
	assert.equal(desktop.folderCount(), 1);
});

test('a bounded folder scan reports unresolved media and keeps already imported SESX clips', async () => {
	const desktop = desktopFiles({ secondScanLimited: true });
	const fixture = createFixture({ fileService: desktop.fileService, createStableId: uniqueIds() });
	const result = await createNativeProjectService(fixture.runtime).openSesx(sessionFile());
	assert.ok(result);
	assert.equal(result.project.clips.length, 1);
	assert.ok((result.report as { items: { code: string }[] }).items.some((item) => item.code === 'sesx.media-scan-limited'));
	assert.deepEqual(fixture.switched, [result.project.id]);
	assert.deepEqual(desktop.released, [SESSION_ID]);
});

test('failed SESX staging rolls back earlier audio and releases the media session', async () => {
	const desktop = desktopFiles();
	let admissions = 0;
	const deleted: string[] = [];
	const fixture = createFixture({
		createStableId: uniqueIds(),
		fileService: desktop.fileService,
		preflightStorage: async () => {
			admissions += 1;
			if (admissions === 2) throw new Error('quota changed');
		},
		store: {
			estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
			beginSourceWrite: async () => ({
				write: async () => undefined, commit: async () => undefined, abort: async () => undefined,
			}),
			deleteSource: async (id) => { deleted.push(id); },
		},
	});
	await assert.rejects(createNativeProjectService(fixture.runtime).openSesx(sessionFile()), /quota changed/u);
	assert.equal(deleted.length, 1);
	assert.deepEqual(fixture.switched, []);
	assert.equal(fixture.state.importing, false);
	assert.deepEqual(desktop.released, [SESSION_ID]);
});

test('an unsafe SESX relative path falls back to a basename inside the granted session', async () => {
	const desktop = desktopFiles();
	const fixture = createFixture({ fileService: desktop.fileService, createStableId: uniqueIds() });
	const file = new File([SESX.replace('relativePath="Audio/first.wav"', 'relativePath="../outside/first.wav"')], 'Session.sesx');
	registerDesktopReadCapability(file, SESSION_ID);
	await createNativeProjectService(fixture.runtime).openSesx(file);
	assert.equal(desktop.calls[0]?.relativePath, 'first.wav');
});

test('compressed SESX audio uses the bounded decoder and reports a skipped surround source', async () => {
	const desktop = desktopFiles({ audio: new Blob(['compressed']), secondMissing: true, cancelFolder: true });
	const dispose: string[] = [];
	const fixture = createFixture({
		fileService: desktop.fileService, createStableId: uniqueIds(),
		prepareDawprojectAudio: async (_blob, name) => {
			assert.equal(name, 'first.mp3');
			return {
				descriptor: { container: 'compressed-audio', frameCount: 6_000, channelCount: 2,
					sampleRate: SAMPLE_RATE, mimeType: 'audio/mpeg' },
				async stream({ onChunk }) {
					const samples = new Float32Array(6_000).fill(0.5);
					await onChunk([samples, samples]);
				},
				dispose: () => { dispose.push('disposed'); },
			};
		},
	});
	const file = new File([SESX.replace('first.wav', 'first.mp3')], 'Session.sesx');
	registerDesktopReadCapability(file, SESSION_ID);
	const result = await createNativeProjectService(fixture.runtime).openSesx(file);
	assert.ok(result);
	assert.equal(result.project.sources.length, 1);
	assert.deepEqual(dispose, ['disposed']);
	assert.deepEqual(desktop.released, [SESSION_ID]);

	const surround = desktopFiles({ audio: new Blob(['compressed']) });
	const other = createFixture({
		fileService: surround.fileService, createStableId: uniqueIds(),
		prepareDawprojectAudio: async (_blob, name) => ({
			descriptor: { container: 'compressed-audio', frameCount: 6_000, channelCount: name === 'first.wav' ? 6 : 2,
				sampleRate: SAMPLE_RATE, mimeType: 'audio/mpeg' },
			async stream({ onChunk }) {
				const samples = new Float32Array(6_000).fill(0.5);
				await onChunk([samples, samples]);
			},
			dispose: () => undefined,
		}),
	});
	const partial = await createNativeProjectService(other.runtime).openSesx(sessionFile());
	assert.ok(partial);
	assert.equal(partial.project.clips.length, 1);
	assert.ok((partial.report as { items: { code: string }[] }).items.some((item) => item.code === 'sesx.media-unsupported'));
	assert.deepEqual(other.switched, [partial.project.id]);
	assert.deepEqual(surround.released, [SESSION_ID]);
});

test('SESX import requires the desktop read capability and extension', async () => {
	const desktop = desktopFiles();
	const fixture = createFixture({ fileService: desktop.fileService });
	const service = createNativeProjectService(fixture.runtime);
	await assert.rejects(service.openSesx(new File([SESX], 'Session.sesx')), /desktop.*File.*Open|capability/iu);
	await assert.rejects(service.openSesx(sessionFile('Session.aup4')), TypeError);
	await assert.rejects(createNativeProjectService(createFixture().runtime).openSesx(sessionFile()), /desktop/iu);
	assert.deepEqual(desktop.released, []);
});
