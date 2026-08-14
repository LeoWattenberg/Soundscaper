/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import {
	BlobReader,
	BlobWriter,
	TextReader,
	TextWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createVideoTrackV10 } from '../../src/common/editor/project-v10.ts';
import type { ScapeArchiveEntry } from '../../src/common/editor/scape-archive-envelope.ts';
import type { ScapeArchiveReader } from '../../src/common/editor/scape-archive-reader.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV18,
} from '../../src/framescaper/editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectV18 } from '../../src/framescaper/editor-project-v18.ts';
import { FramescaperScapeProjectFileV18 } from '../../src/framescaper/scape-project-file-v18.ts';
import { FramescaperScapeArchiveV18 } from '../../src/framescaper/scape-project-preservation-v18.ts';
import {
	ARCHIVE_ORIGINAL_BYTES,
	ARCHIVE_ORIGINAL_SHA,
	ARCHIVE_SOURCE_ID,
	archiveProject,
	createFramescaperV18ArchiveFixture,
	type FramescaperV18ArchiveFixture,
} from './framescaper-v18-archive-fixture.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

export interface FramescaperScapeFileFixtureV18 {
	readonly profile: typeof PROFILE;
	readonly storage: FramescaperV18ArchiveFixture;
	readonly archive: FramescaperScapeArchiveV18;
	readonly file: FramescaperScapeProjectFileV18;
}

export async function setupFramescaperScapeFileV18(
	context: TestContext,
): Promise<FramescaperScapeFileFixtureV18> {
	const storage = await createFramescaperV18ArchiveFixture(context);
	let generation = 0;
	const archive = new FramescaperScapeArchiveV18(PROFILE, {
		store: storage.store,
		port: storage.port,
		opfs: storage.opfs,
		now: () => 1_786_550_400_000,
		createGeneration: () => `file-generation-${String(++generation).padStart(4, '0')}`,
	});
	return {
		profile: PROFILE,
		storage,
		archive,
		file: new FramescaperScapeProjectFileV18(PROFILE, { archive, store: storage.store }),
	};
}

export async function zipPayloads(blob: Blob): Promise<Map<string, number[] | null>> {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false, strictness: 'strict' });
	try {
		const result = new Map<string, number[] | null>();
		for (const entry of await reader.getEntries()) {
			if (entry.filename === 'project.json' || entry.filename === 'manifest.json') {
				result.set(entry.filename, null);
				continue;
			}
			const dataEntry = entry as unknown as {
				getData?: (writer: Uint8ArrayWriter) => Promise<Uint8Array>;
			};
			assert.ok(dataEntry.getData);
			result.set(entry.filename, [...await dataEntry.getData(new Uint8ArrayWriter())]);
		}
		return result;
	} finally {
		await reader.close();
	}
}

export async function zipProjectDocument(blob: Blob): Promise<unknown> {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false, strictness: 'strict' });
	try {
		const entry = (await reader.getEntries()).find(({ filename }) => filename === 'project.json') as
			| { getData?: (writer: TextWriter) => Promise<string> }
			| undefined;
		assert.ok(entry?.getData);
		return JSON.parse(await entry.getData(new TextWriter()));
	} finally {
		await reader.close();
	}
}

export function nestedArchiveProject(
	options: Readonly<{ attached: boolean }>,
): FramescaperProjectV18 {
	const project = structuredClone(archiveProject(options)) as unknown as Record<string, unknown>;
	const sourceClip = structuredClone(
		(project.clips as Record<string, unknown>[])[0]!,
	);
	(project.clips as Record<string, unknown>[]).push({
		...sourceClip,
		id: 'nested-source-clip',
		title: 'Nested source',
		sequenceId: 'nested-source-sequence',
	});
	(project.tracks as Record<string, unknown>[]).push(createVideoTrackV10({
		id: 'nested-source-track', name: 'Nested source', clipIds: ['nested-source-clip'], locked: true,
	}) as unknown as Record<string, unknown>);
	const sourceSequence = structuredClone(
		(project.sequences as Record<string, unknown>[])[0]!,
	);
	(project.sequences as Record<string, unknown>[]).push({
		...sourceSequence,
		id: 'nested-source-sequence',
		name: 'Nested source',
		trackIds: ['nested-source-track'],
		trackNodes: [{ kind: 'track', id: 'nested-source-track', parentFolderId: null }],
	});
	project.subsequences = [{
		id: 'nested-placement',
		sequenceId: 'main-sequence',
		sourceSequenceId: 'nested-source-sequence',
		sequenceStartFrame: 10,
		sequenceFrameCount: 10,
		sourceInFrame: 0,
		sourceFrameCount: 10,
	}];
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV18(PROFILE, project);
	return project as unknown as FramescaperProjectV18;
}

export function multicameraArchiveProject(
	options: Readonly<{ attached: boolean }>,
): FramescaperProjectV18 {
	const project = structuredClone(archiveProject(options)) as unknown as Record<string, unknown>;
	const sources = project.sources as Record<string, unknown>[];
	sources.push({
		...structuredClone(sources[0]!),
		id: 'archive-video-b',
		name: 'Video B',
		storageKey: 'archive-video-b',
		proxyAttachment: null,
	});
	project.multicameraGroups = [{
		id: 'archive-multicamera-group',
		projectId: project.id,
		sequenceId: 'main-sequence',
		outputClipId: 'archive-clip',
		activeMemberId: 'archive-camera-a',
		members: [{
			id: 'archive-camera-a', groupId: 'archive-multicamera-group',
			sourceId: ARCHIVE_SOURCE_ID, syncOffsetSamples: 0,
		}, {
			id: 'archive-camera-b', groupId: 'archive-multicamera-group',
			sourceId: 'archive-video-b', syncOffsetSamples: 0,
		}],
	}];
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV18(PROFILE, project);
	return project as unknown as FramescaperProjectV18;
}

export async function seedMulticameraArchiveOriginal(
	fixture: FramescaperV18ArchiveFixture,
): Promise<void> {
	const writer = await fixture.store.beginMediaAssetWrite('archive-video-b', {
		name: 'media/archive-video-b/original',
		kind: 'video',
		encoding: 'original',
		mimeType: 'video/mp4',
	}, {
		expectedBytes: ARCHIVE_ORIGINAL_BYTES.byteLength,
		expectedSha256: ARCHIVE_ORIGINAL_SHA,
	});
	await writer.write(ARCHIVE_ORIGINAL_BYTES);
	await writer.commitOwned();
}

export function archiveClipboardDescriptor(): Readonly<Record<string, unknown>> {
	return {
		schemaVersion: 2,
		sampleRate: 48_000,
		durationFrames: 10,
		tracks: [{
			sourceTrackId: 'video-track',
			sourceTrackName: 'Video',
			sourceTrackType: 'video',
			sourceLaneGroupId: null,
			clips: [{
				key: 'archive-clip:0:10',
				kind: 'video',
				sourceId: ARCHIVE_SOURCE_ID,
				offsetFrame: 0,
				sourceStartFrame: 0,
				durationFrames: 10,
			}],
		}],
	};
}

export function trackingReaderFactory(
	onClose: () => void,
	onBodyRead: (filename: string) => void,
): (input: Blob, signal?: AbortSignal) => ScapeArchiveReader {
	return (input, signal) => {
		const reader = new ZipReader(new BlobReader(input), {
			signal, strictness: 'strict', useWebWorkers: false,
		});
		return {
			async *getEntriesGenerator(options) {
				for await (const raw of reader.getEntriesGenerator(options)) {
					const entry = raw as unknown as ScapeArchiveEntry;
					if (entry.filename === 'project.json' || entry.filename === 'manifest.json') {
						yield entry;
						continue;
					}
					yield {
						...entry,
						getData: async (writable, readOptions) => {
							if (!readOptions?.checkOverlappingEntryOnly) onBodyRead(entry.filename);
							return entry.getData!(writable, readOptions);
						},
					};
				}
				return true;
			},
			async close() { onClose(); await reader.close(); },
		};
	};
}

export async function rawArchive(project: unknown, manifest: unknown): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0, zip64: true, useWebWorkers: false,
	});
	await writer.add('project.json', new TextReader(JSON.stringify(project)), { level: 0 });
	await writer.add('media/archive-video/original', new Uint8ArrayReader(ARCHIVE_ORIGINAL_BYTES), { level: 0 });
	await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)), { level: 0 });
	return writer.close();
}

export function videoFallbackProject(sha256 = ARCHIVE_ORIGINAL_SHA): unknown {
	const project = structuredClone(archiveProject({ attached: false })) as unknown as Record<string, unknown>;
	const manifest = project.featureRequirements as { schemaVersion: 2; requirements: unknown[] };
	project.featureRequirements = {
		schemaVersion: manifest.schemaVersion,
		requirements: [...manifest.requirements, {
			id: 'test.future-video-render',
			featureId: 'org.example.future-video-render',
			displayName: 'Future video render',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'project-video-render-v1',
				kind: 'video',
				sourceId: 'archive-video',
				sha256,
			},
		}],
	};
	return project;
}
