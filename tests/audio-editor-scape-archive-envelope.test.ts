/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

import {
	readScapeArchiveEnvelope,
	SCAPE_ARCHIVE_LIMITS,
	type ScapeArchiveEntry,
	type ScapeManifest,
} from '../src/common/editor/scape-archive-envelope.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { importScapeProject, inspectScapeProject } from '../src/common/editor/scape-project.js';

const DIGEST = '0'.repeat(64);
const TEXT_ENCODER = new TextEncoder();
const BASELINE_SCAPE_OPTIONS = Object.freeze({
	currentProjectSchemaFamily: 'soundscaper' as const,
	loadProject: (project: unknown) => ({
		project: project as Record<string, unknown>,
		readOnly: false,
		reason: null,
	}),
});

test('strict .scape envelope accepts the canonical manifest ownership graph', async () => {
	const fixture = envelopeFixture();
	const envelope = await readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry));

	assert.equal(envelope.projectText, fixture.projectText);
	assert.equal(envelope.manifest.assets[0]?.sourceId, 'source-1');
	assert.deepEqual([...envelope.entryByName.keys()], ['manifest.json', 'project.json', 'audio/source-1.f32c']);
	assert.equal(fixture.entry('manifest.json').reads, 1);
	assert.equal(fixture.entry('project.json').reads, 1);
	assert.equal(fixture.entry('audio/source-1.f32c').reads, 0);
});

test('archive identity admission precedes every asset getData call', async (context) => {
	const scenarios = [{
		name: 'retired format 2',
		mutateManifest(manifest: ScapeManifest) { Reflect.set(manifest, 'formatVersion', 2); },
		expected: /predates.*baseline/iu,
	}, {
		name: 'unknown manifest family',
		mutateManifest(manifest: ScapeManifest) { Reflect.set(manifest.project, 'schemaFamily', 'unknown'); },
		expected: /unsupported project schema family/iu,
	}, {
		name: 'malformed manifest version',
		mutateManifest(manifest: ScapeManifest) { Reflect.set(manifest.project, 'schemaVersion', 0); },
		expected: /positive safe integer/iu,
	}, {
		name: 'manifest and root disagreement',
		project: { id: 'project-1', schemaFamily: 'framescaper', schemaVersion: 1 },
		mutateManifest(manifest: ScapeManifest) { Reflect.set(manifest.project, 'schemaFamily', 'soundscaper'); },
		expected: /manifest project identity does not match/iu,
	}];

	for (const scenario of scenarios) await context.test(scenario.name, async () => {
		const fixture = envelopeFixture(
			scenario.mutateManifest,
			[],
			scenario.project,
		);
		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			scenario.expected,
		);
		assert.equal(fixture.entry('audio/source-1.f32c').calls, 0);
		assert.equal(fixture.entry('audio/source-1.f32c').reads, 0);
	});
});

test('strict .scape envelope rejects encrypted entries and cumulative expansion before reading metadata bodies', async (context) => {
	await context.test('entry count', async () => {
		const fixture = envelopeFixture();
		assert.equal(SCAPE_ARCHIVE_LIMITS.maximumEntryCount, 4_096);

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry), {
				maximumEntryCount: fixture.entries.length - 1,
			}),
			/too many entries/iu,
		);
		assert.equal(fixture.totalReads(), 0);
	});

	await context.test('unsafe central-directory size', async () => {
		const fixture = envelopeFixture();
		fixture.entry('project.json').entry.compressedSize = Number.MAX_SAFE_INTEGER + 1;

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/invalid compressed size/iu,
		);
		assert.equal(fixture.totalReads(), 0);
	});

	await context.test('encrypted entry', async () => {
		const fixture = envelopeFixture();
		fixture.entry('audio/source-1.f32c').entry.encrypted = true;

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/encrypted entries are not supported/iu,
		);
		assert.equal(fixture.totalReads(), 0);
	});

	await context.test('cumulative declared expansion', async () => {
		const fixture = envelopeFixture();
		const totalBytes = fixture.entries.reduce((sum, { entry }) => sum + entry.uncompressedSize, 0);

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry), {
				maximumExpandedBytes: totalBytes - 1,
			}),
			/exceeds the declared expansion limit/iu,
		);
		assert.equal(fixture.totalReads(), 0);
	});

	await context.test('hard limits cannot be raised by a caller override', async () => {
		const fixture = envelopeFixture();

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry), {
				maximumExpandedBytes: SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes + 1,
			}),
			/cannot exceed the hard limit/iu,
		);
		assert.equal(fixture.totalReads(), 0);
	});
});

test('strict .scape envelope rejects compressed and inconsistent STORE entries before local reads', async (context) => {
	await context.test('compressed entry', async () => {
		const fixture = envelopeFixture();
		fixture.entry('project.json').entry.compressionMethod = 8;

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/portable Scape entries must use STORE/iu,
		);
		assert.equal(fixture.totalCalls(), 0);
	});

	await context.test('STORE size mismatch', async () => {
		const fixture = envelopeFixture();
		fixture.entry('project.json').entry.compressedSize -= 1;

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/STORE entry.*inconsistent compressed and uncompressed sizes/iu,
		);
		assert.equal(fixture.totalCalls(), 0);
	});
});

test('strict .scape envelope bounds manifest and project JSON before storage work', async (context) => {
	await context.test('manifest central-directory size', async () => {
		const fixture = envelopeFixture();
		const manifest = fixture.entry('manifest.json');

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry), {
				maximumManifestBytes: manifest.entry.uncompressedSize - 1,
			}),
			/manifest\.json exceeds the metadata limit/iu,
		);
		assert.equal(fixture.totalReads(), 0);
	});

	await context.test('manifest emitted bytes', async () => {
		const fixture = envelopeFixture();
		const manifest = fixture.entry('manifest.json');
		manifest.entry.compressedSize -= 1;
		manifest.entry.uncompressedSize -= 1;

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry), {
				maximumManifestBytes: manifest.bytes.byteLength - 1,
			}),
			/manifest\.json exceeds the read limit/iu,
		);
		assert.equal(manifest.reads, 1);
		assert.equal(fixture.entry('project.json').reads, 0);
	});

	await context.test('project descriptor and entry size', async () => {
		const fixture = envelopeFixture();

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry), {
				maximumProjectBytes: TEXT_ENCODER.encode(fixture.projectText).byteLength - 1,
			}),
			/project\.json exceeds the metadata limit/iu,
		);
		assert.equal(fixture.entry('manifest.json').reads, 1);
		assert.equal(fixture.entry('project.json').reads, 0);
	});

	await context.test('project emitted bytes', async () => {
		const fixture = envelopeFixture((manifest) => { manifest.project.size -= 1; });
		const project = fixture.entry('project.json');
		project.entry.compressedSize -= 1;
		project.entry.uncompressedSize -= 1;

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry), {
				maximumProjectBytes: project.bytes.byteLength - 1,
			}),
			/project\.json exceeds the read limit/iu,
		);
		assert.equal(fixture.entry('manifest.json').reads, 1);
		assert.equal(project.reads, 1);
	});
});

test('strict .scape envelope requires descriptor sizes to match central-directory metadata', async (context) => {
	for (const target of ['project', 'asset'] as const) {
		await context.test(target, async () => {
			const fixture = envelopeFixture((manifest) => {
				if (target === 'project') manifest.project.size += 1;
				else manifest.assets[0]!.size += 1;
			});

			await assert.rejects(
				readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
				/declared size does not match its archive entry/iu,
			);
			assert.equal(fixture.entry('manifest.json').reads, 1);
			assert.equal(fixture.entry('project.json').reads, 0);
			assert.equal(fixture.entry('audio/source-1.f32c').reads, 0);
		});
	}
});

test('strict .scape envelope enforces one-to-one reserved and asset entry ownership', async (context) => {
	await context.test('canonical project entry', async () => {
		const fixture = envelopeFixture((manifest) => { manifest.project.entry = 'alternate.json'; }, [
			entryFixture('alternate.json', '{}'),
		]);

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/project descriptor must own project\.json/iu,
		);
	});

	await context.test('descriptor alias', async () => {
		const fixture = envelopeFixture((manifest) => { manifest.assets[0]!.entry = 'project.json'; });

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/project\.json is reserved/iu,
		);
	});

	await context.test('duplicate source descriptor', async () => {
		const duplicate = entryFixture('audio/source-duplicate.f32c', 'asset');
		const fixture = envelopeFixture((manifest) => {
			manifest.assets.push({ ...manifest.assets[0]!, entry: duplicate.entry.filename });
		}, [duplicate]);

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/duplicate Scape source asset: source-1/iu,
		);
	});

	await context.test('unreferenced extra entry', async () => {
		const fixture = envelopeFixture(undefined, [entryFixture('extra.bin', 'not-owned')]);

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/unreferenced entry: extra\.bin/iu,
		);
	});

	await context.test('directory entry', async () => {
		const directory = entryFixture('audio/', new Uint8Array());
		directory.entry.directory = true;
		const fixture = envelopeFixture(undefined, [directory]);

		await assert.rejects(
			readScapeArchiveEnvelope(fixture.entries.map(({ entry }) => entry)),
			/unsupported directory entry/iu,
		);
		assert.equal(fixture.totalReads(), 0);
	});
});

test('inspect and import share fail-closed envelope validation before storage writes', async () => {
	const archive = await archiveWithUnreferencedEntry();
	let storageWrites = 0;
	const store = {
		loadProject: async () => null,
		saveProject: async () => { storageWrites += 1; },
		beginSourceWrite: async () => {
			storageWrites += 1;
			throw new Error('unexpected source write');
		},
		beginMediaAssetWrite: async () => { storageWrites += 1; throw new Error('unexpected write'); },
	};

	await assert.rejects(importScapeProject(archive, store, BASELINE_SCAPE_OPTIONS), /unreferenced entry: extra\.bin/iu);
	await assert.rejects(inspectScapeProject(archive, null, BASELINE_SCAPE_OPTIONS), /unreferenced entry: extra\.bin/iu);
	assert.equal(storageWrites, 0);
});

test('inspect and import require a project-source and manifest-asset bijection before storage access', async (context) => {
	const audioSource = {
		kind: 'audio',
		id: 'source-1',
		storageKey: 'source-1',
		name: 'source.wav',
		mimeType: 'audio/wav',
		frameCount: 1,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	};
	const cases = [{
		name: 'orphan manifest descriptor',
		project: portableProject([]),
		assets: [archiveAsset('orphan-source', 'audio')],
		expected: /one-to-one mapping/iu,
	}, {
		name: 'missing manifest descriptor',
		project: portableProject([audioSource]),
		assets: [],
		expected: /one-to-one mapping/iu,
	}, {
		name: 'incompatible descriptor kind',
		project: portableProject([audioSource]),
		assets: [archiveAsset('source-1', 'video')],
		expected: /source source-1 has an incompatible asset kind/iu,
	}];

	for (const scenario of cases) {
		await context.test(scenario.name, async () => {
			const archive = await archiveWithProjectAssets(scenario.project, scenario.assets);
			const calls: string[] = [];
			const store = storageCallTracker(calls);

			await assert.rejects(inspectScapeProject(archive, store, BASELINE_SCAPE_OPTIONS), scenario.expected);
			await assert.rejects(importScapeProject(archive, store, BASELINE_SCAPE_OPTIONS), scenario.expected);
			assert.deepEqual(calls, []);
		});
	}
});

interface EntryFixture {
	entry: ScapeArchiveEntry;
	bytes: Uint8Array;
	calls: number;
	reads: number;
}

function entryFixture(filename: string, contents: string | Uint8Array): EntryFixture {
	const bytes = typeof contents === 'string' ? TEXT_ENCODER.encode(contents) : contents;
	const fixture: EntryFixture = {
		entry: {
			filename,
			directory: false,
			encrypted: false,
			compressionMethod: 0,
			compressedSize: bytes.byteLength,
			uncompressedSize: bytes.byteLength,
			getData: async (writable, options) => {
				fixture.calls += 1;
				if (options?.checkOverlappingEntryOnly) return;
				fixture.reads += 1;
				const writer = writable.getWriter();
				await writer.write(bytes);
				await writer.close();
			},
		},
		bytes,
		calls: 0,
		reads: 0,
	};
	return fixture;
}

function envelopeFixture(
	mutateManifest?: (manifest: ScapeManifest) => void,
	extraEntries: EntryFixture[] = [],
	project: Readonly<Record<string, unknown>> = {
		id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
	},
) {
	const projectText = JSON.stringify(project);
	const projectBytes = TEXT_ENCODER.encode(projectText);
	const assetBytes = TEXT_ENCODER.encode('asset');
	const manifest: ScapeManifest = {
		format: 'scape-project',
		formatVersion: 1,
		createdAt: '2026-07-28T00:00:00.000Z',
		project: {
			entry: 'project.json',
			mimeType: 'application/json',
			schemaFamily: project.schemaFamily as 'soundscaper' | 'framescaper',
			schemaVersion: project.schemaVersion as number,
			size: projectBytes.byteLength,
			sha256: DIGEST,
		},
		assets: [{
			sourceId: 'source-1',
			kind: 'audio',
			entry: 'audio/source-1.f32c',
			encoding: 'audio-f32le-chunks-v1',
			mimeType: 'audio/wav',
			size: assetBytes.byteLength,
			sha256: DIGEST,
		}],
	};
	mutateManifest?.(manifest);
	const entries = [
		entryFixture('manifest.json', JSON.stringify(manifest)),
		entryFixture('project.json', projectBytes),
		entryFixture('audio/source-1.f32c', assetBytes),
		...extraEntries,
	];
	return {
		entries,
		manifest,
		projectText,
		entry: (filename: string) => {
			const fixture = entries.find(({ entry }) => entry.filename === filename);
			if (!fixture) throw new Error(`Missing test entry ${filename}`);
			return fixture;
		},
		totalCalls: () => entries.reduce((sum, entry) => sum + entry.calls, 0),
		totalReads: () => entries.reduce((sum, entry) => sum + entry.reads, 0),
	};
}

async function archiveWithUnreferencedEntry(): Promise<Blob> {
	const project = baselineProject(createCurrentAudioEditorProject({
		id: 'scape-envelope-project',
		title: 'Envelope project',
		sources: [],
		clips: [],
	}));
	const projectText = JSON.stringify(project);
	const projectBytes = TEXT_ENCODER.encode(projectText);
	const manifest = {
		format: 'scape-project',
		formatVersion: 1,
		createdAt: '2026-07-28T00:00:00.000Z',
		project: {
			entry: 'project.json',
			mimeType: 'application/json',
			schemaFamily: project.schemaFamily,
			schemaVersion: project.schemaVersion,
			size: projectBytes.byteLength,
			sha256: DIGEST,
		},
		assets: [],
	};
	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0,
		useWebWorkers: false,
		zip64: true,
	});
	await writer.add('project.json', new TextReader(projectText), { level: 0, zip64: true });
	await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)), { level: 0, zip64: true });
	await writer.add('extra.bin', new TextReader('not-owned'), { level: 0, zip64: true });
	return writer.close(undefined, { zip64: true });
}

interface PortableArchiveAsset {
	readonly sourceId: string;
	readonly kind: 'audio' | 'video';
	readonly entry: string;
	readonly encoding: string;
	readonly contents: string;
}

function portableProject(sources: readonly Record<string, unknown>[]) {
	return baselineProject(createCurrentAudioEditorProject({
		id: 'scape-source-bijection-project',
		title: 'Source bijection project',
		sources,
		clips: [],
		tracks: [],
	}));
}

function archiveAsset(sourceId: string, kind: 'audio' | 'video'): PortableArchiveAsset {
	return {
		sourceId,
		kind,
		entry: kind === 'video' ? `video/${sourceId}.original` : `audio/${sourceId}.f32c`,
		encoding: kind === 'video' ? 'original' : 'audio-f32le-chunks-v1',
		contents: 'asset',
	};
}

async function archiveWithProjectAssets(
	project: Readonly<Record<string, unknown>> & Readonly<{
		schemaFamily: 'soundscaper';
		schemaVersion: 1;
	}>,
	assets: readonly PortableArchiveAsset[],
): Promise<Blob> {
	const projectText = JSON.stringify(project);
	const projectBytes = TEXT_ENCODER.encode(projectText);
	const manifest = {
		format: 'scape-project',
		formatVersion: 1,
		createdAt: '2026-07-28T00:00:00.000Z',
		project: {
			entry: 'project.json',
			mimeType: 'application/json',
			schemaFamily: project.schemaFamily,
			schemaVersion: project.schemaVersion,
			size: projectBytes.byteLength,
			sha256: sha256(projectBytes),
		},
		assets: assets.map((asset) => {
			const bytes = TEXT_ENCODER.encode(asset.contents);
			return {
				sourceId: asset.sourceId,
				kind: asset.kind,
				entry: asset.entry,
				encoding: asset.encoding,
				size: bytes.byteLength,
				sha256: sha256(bytes),
			};
		}),
	};
	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0,
		useWebWorkers: false,
		zip64: true,
	});
	await writer.add('project.json', new TextReader(projectText), { level: 0, zip64: true });
	for (const asset of assets) {
		await writer.add(asset.entry, new TextReader(asset.contents), { level: 0, zip64: true });
	}
	await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)), { level: 0, zip64: true });
	return writer.close(undefined, { zip64: true });
}

function baselineProject(
	project: ReturnType<typeof createCurrentAudioEditorProject>,
): Omit<ReturnType<typeof createCurrentAudioEditorProject>, 'schemaVersion'> & Readonly<{
	schemaFamily: 'soundscaper';
	schemaVersion: 1;
}> {
	return { ...project, schemaFamily: 'soundscaper', schemaVersion: 1 };
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function storageCallTracker(calls: string[]) {
	const called = (name: string, result: unknown) => async () => {
		calls.push(name);
		return result;
	};
	return {
		loadProject: called('loadProject', null),
		listProjectRevisions: called('listProjectRevisions', []),
		getSourceMetadata: called('getSourceMetadata', null),
		getMediaAssetMetadata: called('getMediaAssetMetadata', null),
		beginSourceWrite: called('beginSourceWrite', null),
		beginMediaAssetWrite: called('beginMediaAssetWrite', null),
		saveProject: called('saveProject', undefined),
		deleteProject: called('deleteProject', undefined),
		deleteSource: called('deleteSource', undefined),
	};
}
