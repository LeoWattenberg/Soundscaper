/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createCrossProductHandoffLaunchIntent } from
	'../src/common/cross-product-handoff-intent.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import {
	createFramescaperProject,
	validateFramescaperProject,
} from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { convertCrossProductEditableCopy } from
	'../src/common/transfer/cross-product-handoff-conversion.ts';
import { createEditableCopyTransferRuntime } from
	'../src/common/transfer/cross-product-handoff-transfer-runtime.ts';
import { createCrossProductHandoffReportSidecar } from
	'../src/common/transfer/cross-product-handoff-report-sidecar.ts';
import { loadTransferRuntime } from '../src/common/transfer/transfer-archive-runtime.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';

const NOW = '2026-08-29T12:00:00.000Z';

test('the real archive runtime carries Soundscaper PCM into a writable Framescaper copy', async (context) => {
	const samples = [0.25, -0.5, 0.75, 0] as const;
	const sourceStore = memoryStore(context, 'editable-copy-sound-source');
	const destinationStore = memoryStore(context, 'editable-copy-frame-destination');
	const source = soundscaperPcmProject(samples.length);
	const before = structuredClone(source);
	await persistPcm(sourceStore, 'sound-audio-source', samples);
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily: 'framescaper',
		invocationId: 'real-sound-to-frame',
		destinationProjectId: 'real-frame-copy',
	});
	const runtime = await loadTransferRuntime();
	const exportEditableCopy = runtime.exportEditableCopy;
	assert.ok(exportEditableCopy);
	const exported = await exportEditableCopy(source, sourceStore, {
		intent,
		maximumBlobBytes: 8 * 1024 * 1024,
	});
	assert.ok(exported.blob instanceof Blob);
	assert.equal(exported.fileExtension, '.fscape');
	assert.equal(exported.projectId, 'real-frame-copy');

	const imported = await runtime.importProject(exported.blob, destinationStore, {
		collision: 'cancel',
	}) as unknown as { readonly project: unknown; readonly readOnly: boolean };
	assert.equal(imported.readOnly, false);
	assert.equal(validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, imported.project), true);
	assert.deepEqual(projectIdentity(imported.project), {
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'real-frame-copy',
	});
	assert.deepEqual(await storedSamples(destinationStore, 'sound-audio-source'), samples);
	assert.deepEqual(await storedSamples(sourceStore, 'sound-audio-source'), samples);
	assert.deepEqual(source, before, 'archive conversion and import leave the source project unchanged');

	const bytes = new Uint8Array(await exported.blob.arrayBuffer());
	const retry = await runtime.importBundle({
		store: destinationStore,
		inspectProject: runtime.inspectProject,
		importProject: runtime.importProject,
		entries: [{
			projectId: exported.projectId,
			title: exported.title,
			fileName: `${exported.title}${exported.fileExtension}`,
			mimeType: 'application/vnd.kw.scape+zip',
			byteLength: bytes.byteLength,
			bytes,
			conversionReportSidecar: createCrossProductHandoffReportSidecar({
				entryId: exported.projectId,
				archive: bytes,
				report: exported.conversionReport,
			}),
		}],
	});
	assert.equal(retry.entries[0].reasonCode, 'already-present');
	assert.deepEqual(retry.entries[0].conversionReport, exported.conversionReport);
});

test('the real archive runtime retains mixed Framescaper PCM while dropping visual-only state', async (context) => {
	const samples = Array.from({ length: 48_000 }, (_, index) => (
		[0.125, -0.25, 0.5, -1][index % 4]!
	));
	const videoBytes = Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70);
	const sourceStore = memoryStore(context, 'editable-copy-frame-source');
	const destinationStore = memoryStore(context, 'editable-copy-sound-destination');
	const source = createFramescaperProject(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		framescaperBaselineOptions(),
	);
	const before = structuredClone(source);
	await persistPcm(sourceStore, 'audio-source', samples);
	await sourceStore.writeMediaAsset(
		'video-source', new Blob([videoBytes], { type: 'video/mp4' }),
		{ name: 'visual-only.mp4', mimeType: 'video/mp4' },
	);
	assert.deepEqual(await storedMediaBytes(sourceStore, 'video-source'), videoBytes);
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily: 'soundscaper',
		invocationId: 'real-frame-to-sound',
		destinationProjectId: 'real-sound-copy',
	});
	const runtime = await loadTransferRuntime();
	const exportEditableCopy = runtime.exportEditableCopy;
	assert.ok(exportEditableCopy);
	const exported = await exportEditableCopy(source as never, sourceStore, {
		intent,
		maximumBlobBytes: 8 * 1024 * 1024,
	});
	assert.ok(exported.blob instanceof Blob);
	assert.equal(exported.fileExtension, '.sscape');
	assert.equal(exported.projectId, 'real-sound-copy');

	const imported = await runtime.importProject(exported.blob, destinationStore, {
		collision: 'cancel',
	}) as unknown as {
		readonly project: Readonly<Record<string, unknown>>;
		readonly readOnly: boolean;
	};
	assert.equal(imported.readOnly, false);
	assert.equal(validateSoundscaperProject(imported.project), true);
	assert.deepEqual(projectIdentity(imported.project), {
		schemaFamily: 'soundscaper', schemaVersion: 1, id: 'real-sound-copy',
	});
	assert.deepEqual(records(imported.project.sources).map(({ id, kind }) => [id, kind]), [
		['audio-source', 'audio'],
	]);
	assert.deepEqual(records(imported.project.clips).map(({ id, kind }) => [id, kind]), [
		['audio-clip', 'audio'],
	]);
	assert.deepEqual(records(imported.project.tracks).map(({ id, type }) => [id, type]), [
		['audio-track', 'audio'],
	]);
	assert.deepEqual(record(imported.project.projectBin).clips, []);
	assert.deepEqual(await storedSamples(destinationStore, 'audio-source'), samples);
	assert.equal(await destinationStore.loadMediaAsset('video-source'), null,
		'the destination archive must not publish the omitted video body');
	assert.deepEqual(await storedMediaBytes(sourceStore, 'video-source'), videoBytes,
		'the source retains custody of its visual media body');
	assert.deepEqual(source, before, 'mixed projection leaves the Framescaper authority unchanged');
});

test('the editable-copy runtime substitutes only archive export and exposes its conversion report', async () => {
	const source = createSoundscaperProject({ id: 'runtime-source', now: NOW });
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'runtime-invocation', destinationProjectId: 'runtime-copy',
	});
	const reports: unknown[] = [];
	const calls: unknown[] = [];
	const base = {
		exportProject: async () => ({ blob: new Blob(['ordinary']) }),
		exportEditableCopy: async (project: unknown, store: unknown, options: Record<string, unknown>) => {
			calls.push({ project, store, options });
			const converted = convertCrossProductEditableCopy({ intent, sourceProject: project });
			return { blob: new Blob(['editable']), conversionReport: converted.report };
		},
		inspectProject: async () => ({}),
		importProject: async () => ({}),
		exportBundle: async function* () {},
		importBundle: async () => ({}),
		sendTransfer: async () => ({}),
		receiveTransfer: async () => ({}),
	};
	const runtime = createEditableCopyTransferRuntime(base as never, intent, (report) => reports.push(report));
	const exported = await runtime.exportProject(source, { name: 'source-store' }, { maximumBlobBytes: 1024 });
	assert.equal(await (exported?.blob as Blob).text(), 'editable');
	assert.equal(calls.length, 1);
	assert.deepEqual((calls[0] as { options: { intent: unknown } }).options.intent, intent);
	assert.equal(reports.length, 1);
	assert.equal((reports[0] as { destination: { projectId: string } }).destination.projectId, 'runtime-copy');
	assert.equal(runtime.inspectProject, base.inspectProject);
});

type ProjectStore = ReturnType<typeof createProjectStore>;

function memoryStore(context: TestContext, databaseName: string): ProjectStore {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName });
	context.after(async () => { await store.close(); });
	return store;
}

function soundscaperPcmProject(frameCount: number) {
	return createSoundscaperProject({
		id: 'real-sound-source', title: 'Real Sound source', now: NOW,
		sources: [createAudioSource({
			id: 'sound-audio-source', storageKey: 'sound-audio-source', name: 'Sound.wav',
			mimeType: 'audio/wav', frameCount, channelCount: 1,
			sampleRate: 48_000, originalSampleRate: 48_000,
		})],
		clips: [createAudioClip({
			id: 'sound-audio-clip', sourceId: 'sound-audio-source', title: 'Sound',
			timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: frameCount, durationFrames: frameCount,
		})],
		tracks: [createAudioTrack({
			id: 'sound-audio-track', name: 'Sound', clipIds: ['sound-audio-clip'],
		})],
		sequences: [{
			id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['sound-audio-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
}

async function persistPcm(
	store: ProjectStore,
	sourceId: string,
	samples: readonly number[],
): Promise<void> {
	const writer = await store.beginSourceWrite(sourceId, {
		name: `${sourceId}.wav`, mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await writer.write([Float32Array.from(samples)]);
	await writer.commit();
}

async function storedSamples(store: ProjectStore, sourceId: string): Promise<number[]> {
	const samples: number[] = [];
	for await (const value of store.readSourceChunks(sourceId)) {
		const channels = Array.isArray(value)
			? value
			: (value as Readonly<{ channels: readonly Float32Array[] }>).channels;
		samples.push(...channels[0] ?? []);
	}
	return samples;
}

async function storedMediaBytes(store: ProjectStore, sourceId: string): Promise<Uint8Array> {
	const media = await store.loadMediaAsset(sourceId);
	assert.ok(media);
	return new Uint8Array(await media.arrayBuffer());
}

function projectIdentity(value: unknown): Readonly<Record<string, unknown>> {
	const project = record(value);
	return {
		schemaFamily: project.schemaFamily,
		schemaVersion: project.schemaVersion,
		id: project.id,
	};
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value));
	return value.map(record);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, unknown>>;
}
