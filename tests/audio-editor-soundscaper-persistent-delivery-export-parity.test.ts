/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export-service.ts';
import { createDeferredEditorExportService } from '../src/common/editor/controller/deferred-export-service.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import {
	bindSoundscaperPersistentDeliverySave,
	createSoundscaperPersistentDeliverySaveTarget,
} from '../src/common/editor/soundscaper-persistent-delivery-save-target.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import {
	createDirectPcmExportFixture,
	createPreparedStream,
	directPlan,
} from './helpers/direct-pcm-export-fixture.ts';

const CLAIM = '7'.repeat(48);
const WRITE = '8'.repeat(48);

test('direct and persistent production exports produce identical bytes and delivery reports', async () => {
	const staged = encodeWav([new Float32Array(2), new Float32Array(2)], {
		sampleRate: 48_000, bitDepth: 24, float: false, dither: 'none', metadata: {}, markers: [],
	});
	const plan = directPlan({
		cart: null, ixml: null, markers: [], metadata: {},
		outputFileBytesPerRender: staged.byteLength,
	} as never);
	const fixtureOptions = {
		encoderFinalByteLength: staged.byteLength,
		encoderInitialChunks: [staged], encoderWriteChunks: () => [new Uint8Array(0)], encoderFinalChunks: [],
	};
	const directFixture = createDirectPcmExportFixture(plan, fixtureOptions);
	const directDestination = createPreparedStream({ publishedFileName: 'mix.wav' });
	directFixture.setPrepared(directDestination.prepared);
	let releaseDirectPreparation!: () => void;
	let signalDirectPreparation!: () => void;
	const directPreparationStarted = new Promise<void>((resolve) => { signalDirectPreparation = resolve; });
	const directPreparation = new Promise<void>((resolve) => { releaseDirectPreparation = resolve; });
	const direct = createEditorExportService({
		...directFixture.runtime,
		prepareProjectForExport: async () => { signalDirectPreparation(); await directPreparation; },
	});
	const directOutcomePromise = direct.handleExportAction('start', {
		saveTarget: { id: 'direct-target' }, useFileSystemAccess: true,
	});
	await directPreparationStarted;
	assert.equal(direct.persistentAudioDeliveryAvailable(), false);
	let persistentIdleNotified = false;
	const persistentIdle = direct.whenPersistentAudioDeliveryAvailable()
		.then(() => { persistentIdleNotified = true; });
	await Promise.resolve();
	assert.equal(persistentIdleNotified, false);
	releaseDirectPreparation();
	const directOutcome = await directOutcomePromise;
	await persistentIdle;
	assert.equal(direct.persistentAudioDeliveryAvailable(), true);
	assert.equal(directFixture.errors.length, 0, String(directFixture.errors[0]));

	const persistentFixture = createDirectPcmExportFixture(plan, fixtureOptions);
	const written: Uint8Array[] = [];
	let offset = 0;
	const persistentBridge = {
		async beginWrite() {
			return { writeId: WRITE, chunkSize: 4 * 1024 * 1024 };
		},
		async writeChunk(request: Readonly<{ writeId: string; offset: number; bytes: Uint8Array }>) {
			assert.equal(request.writeId, WRITE);
			assert.equal(request.offset, offset);
			written.push(request.bytes.slice());
			offset += request.bytes.byteLength;
			return { nextOffset: offset };
		},
		async patchFinalPrefix(request: Readonly<{ writeId: string; bytes: Uint8Array }>) {
			assert.equal(request.writeId, WRITE);
			written[0]?.set(request.bytes);
			return { byteLength: offset };
		},
		async finishWrite(writeId: string) {
			assert.equal(writeId, WRITE);
			return { byteLength: offset };
		},
		async abortWrite() { throw new Error('persistent parity export must not abort'); },
	};
	const durableProgress: number[] = [];
	const createRenderEngine = persistentFixture.runtime.createCacheAwareRenderEngine as () => Record<string, unknown>;
	const persistent = createDeferredEditorExportService({
		...persistentFixture.runtime,
		createCacheAwareRenderEngine: () => {
			const engine = createRenderEngine() as Record<string, (...args: never[]) => unknown>;
			return {
				...engine,
				async renderMixRealtime(request: Readonly<Record<string, unknown>>) {
					(request.onProgress as ((value: unknown) => void) | undefined)?.({ progress: 0.4 });
					return engine.renderMixRealtime!(request as never);
				},
			};
		},
		taskProgress: {
			begin: () => ({ setPhase: () => true, finish: () => true }),
			getSnapshot: () => ({ kind: 'export' }), updateActive: () => true,
		},
		updateExportProgress: () => undefined,
		fileService: createAudioEditorFileService({
			bridge: {},
			document: null,
			urlApi: {},
		}),
	} as unknown as Parameters<typeof createDeferredEditorExportService>[0]);
	const derived = await persistent.derivePersistentAudioDeliveryPlan({ useFileSystemAccess: true });
	const persistentOutcome = await persistent.executePersistentAudioDeliveryPlan({
		...derived,
		destination: createSoundscaperPersistentDeliverySaveTarget(CLAIM, persistentBridge),
		onProgress: (progress: number) => { durableProgress.push(progress); },
	});
	assert.equal(persistentFixture.errors.length, 0, String(persistentFixture.errors[0]));

	assert.deepEqual(concat(directDestination.chunks), concat(written));
	assert.ok(durableProgress.includes(0.4), 'ordinary render progress is teed to the durable worker callback');
	assert.equal((directOutcome as { fileName: string }).fileName, (persistentOutcome as { fileName: string }).fileName);
	assert.equal((directOutcome as { size: number }).size, (persistentOutcome as { size: number }).size);
	assert.deepEqual(
		(directFixture.state as { deliveryReport?: unknown }).deliveryReport,
		(persistentFixture.state as { deliveryReport?: unknown }).deliveryReport,
	);
});

test('persistent delivery rejects bidi-spoofed on-disk file names', () => {
	const writer = {
		beginWrite: () => ({}),
		writeChunk: () => ({}),
		patchFinalPrefix: () => ({}),
		finishWrite: () => ({}),
		abortWrite: () => ({}),
	};
	const target = createSoundscaperPersistentDeliverySaveTarget(CLAIM, writer);
	assert.throws(
		() => bindSoundscaperPersistentDeliverySave(target, 'report\u202efdp.wav'),
		/file name is invalid/iu,
	);
});

function concat(chunks: readonly Uint8Array[]): Uint8Array {
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}
