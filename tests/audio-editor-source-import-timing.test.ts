/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import {
	createImportVideoFile,
	type ImportVideoRuntime,
} from '../src/common/editor/controller/source-import.ts';
import { createFixture } from './audio-editor-source-import.test.ts';
import { videoFile } from './helpers/audio-editor-source-import-fixture.ts';

type MutableImportVideoRuntime = {
	-readonly [Name in keyof ImportVideoRuntime]: ImportVideoRuntime[Name];
};

test('video import rollback cannot delete a newer media generation', async () => {
	const fixture = createFixture();
	fixture.options.activateFails = true;
	fixture.options.replaceMediaBeforeRollback = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/activation failed/u,
	);
	assert.deepEqual(fixture.mediaDiscardAttempts, ['video-source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
});

test('video import does not delete media that failed before persistence', async () => {
	const fixture = createFixture();
	fixture.options.writeMediaFails = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/media write failed/u,
	);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.equal(fixture.calls.includes('revoke:video-source-1'), true);
	assert.equal(fixture.calls.at(-1), 'dispose');
});

test('failed exact-timing import preserves newer original and timing generations', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	const originalStore = runtime.store as Record<string, unknown> & {
		beginMediaAssetWrite(...args: unknown[]): Promise<unknown>;
	};
	const storageKeys: string[] = [];
	runtime.store = {
		...originalStore,
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
		async beginMediaAssetWrite(...args: unknown[]) {
			storageKeys.push(String(args[0]));
			return originalStore.beginMediaAssetWrite(...args);
		},
	};
	runtime.ffmpeg = {
		...(runtime.ffmpeg as Readonly<Record<string, unknown>>),
		async probeVideoTiming() {
			return {
				timescale: 1_000,
				presentationTicks: [0n, 40n, 80n],
				finalFrameDurationTicks: 40n,
				nominalRate: { num: 25, den: 1 },
			};
		},
	};
	runtime.activateVideoSource = async () => {
		for (const storageKey of storageKeys) fixture.replaceMediaGeneration(storageKey);
		throw new Error('activation failed after exact timing publication');
	};

	await assert.rejects(
		createImportVideoFile(runtime)(new File([Uint8Array.of(1, 2, 3)], 'exact.mp4', { type: 'video/mp4' }), {
			destination: 'project-bin', trackId: null, timelineStartFrame: 0,
		}),
		/activation failed after exact timing publication/u,
	);
	assert.equal(storageKeys.length, 2);
	assert.deepEqual(fixture.mediaDiscardAttempts, [...storageKeys].reverse());
	assert.deepEqual(fixture.deletedMedia, []);
});

test('probe failure stores genuinely conformed CFR media and reprobes its exact timing', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	const originalFfmpeg = runtime.ffmpeg as Readonly<Record<string, unknown>>;
	let probeCalls = 0;
	let conformedInput: Blob | null = null;
	runtime.ffmpeg = {
		...originalFfmpeg,
		async probeVideoTiming() {
			probeCalls += 1;
			if (probeCalls === 1) throw new Error('unsupported original timebase');
			return {
				timescale: 1_000,
				presentationTicks: [0n, 40n, 80n],
				finalFrameDurationTicks: 40n,
				nominalRate: { num: 25, den: 1 },
			};
		},
		async conformVideoToCfr(input: Blob) {
			conformedInput = input;
			return new File([Uint8Array.of(9, 8, 7)], 'conformed.mp4', { type: 'video/mp4' });
		},
	};
	const originalStore = runtime.store as Record<string, unknown>;
	runtime.store = {
		...originalStore,
		async getMediaAssetMetadata() { return null; },
		async writeMediaAsset(storageKey: string, body: Blob) {
			fixture.calls.push(`write-media:${storageKey}`);
			return { sha256: await digestMediaContent(body), size: body.size };
		},
		async beginMediaAssetWrite(storageKey: string) {
			const chunks: ArrayBuffer[] = [];
			let bytesWritten = 0;
			return {
				maximumChunkBytes: 8,
				get bytesWritten() { return bytesWritten; },
				async write(bytes: Uint8Array) {
					chunks.push(Uint8Array.from(bytes).buffer);
					bytesWritten += bytes.byteLength;
				},
				async commit() { throw new Error('Timing publication must retain ownership.'); },
				async commitOwned() {
					const body = new Blob(chunks);
					fixture.calls.push(`write-media:${storageKey}`);
					return {
						metadata: { sha256: await digestMediaContent(body), size: body.size },
						async discardIfCurrent() { return true; },
					};
				},
				async abort() { chunks.length = 0; },
			};
		},
	};
	const original = new File([Uint8Array.of(1, 2, 3, 4)], 'vfr.mov', { type: 'video/quicktime' });

	await createImportVideoFile(runtime)(original, {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.equal(conformedInput, original);
	assert.equal(probeCalls, 2);
	const source = fixture.addedSources.find(({ kind }) => kind === 'video');
	assert.ok(source);
	assert.equal(source.mimeType, 'video/mp4');
	assert.equal(source.videoCodec, 'h264');
	assert.deepEqual(source.frameRate, { num: 25, den: 1 });
	assert.equal((source.timingDecision as Record<string, unknown>).mode, 'conform-cfr-at-ingest');
	assert.ok(source.timingAsset);
});

test('probe fallback fails closed when CFR conformance is unavailable', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	runtime.ffmpeg = {
		async decode() { return { channels: [], sampleRate: 48_000 }; },
		async probeVideoTiming() { throw new Error('unsupported original timebase'); },
	};
	const original = new File([Uint8Array.of(1, 2, 3, 4)], 'unprobed.mov', {
		type: 'video/quicktime',
	});

	await assert.rejects(
		createImportVideoFile(runtime)(original, {
			destination: 'project-bin', trackId: null, timelineStartFrame: 0,
		}),
		/CFR conformance is unavailable/iu,
	);
	assert.equal(fixture.addedSources.length, 0);
	assert.equal(fixture.calls.some((call) => call.startsWith('write-media:')), false);
});
