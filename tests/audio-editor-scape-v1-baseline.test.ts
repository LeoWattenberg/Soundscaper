/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

import {
	ProjectReimportRequiredError,
	type ProjectSchemaFamily,
} from '../src/common/editor/project-schema-identity.ts';
import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import {
	prepareScapeExport,
	serializeScapeExportManifest,
} from '../src/common/editor/scape-export-plan.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import {
	importScapeProject,
	inspectScapeProject,
} from '../src/common/editor/scape-project.js';
import {
	planScapeVideoProxyArchiveAssets,
} from '../src/common/editor/scape-video-proxy-archive-plan.ts';

const CREATED_AT = '2026-08-28T10:00:00.000Z';
const DIGEST = 'a'.repeat(64);
const TEXT_ENCODER = new TextEncoder();

test('format 1 exports repeat the family-qualified project identity and admit video at schema 1', async () => {
	const project = baselineProject('framescaper', [{
		kind: 'video',
		id: 'video-1',
		storageKey: 'video-1',
		name: 'picture.mov',
		mimeType: 'video/quicktime',
	}]);
	const plan = await prepareScapeExport(project, {
		getMediaAssetMetadata: () => ({ size: 4 }),
	}, { output: 'stream' });
	assert.deepEqual(plan.projectDescriptor.schemaFamily, 'framescaper');
	assert.deepEqual(plan.projectDescriptor.schemaVersion, 1);
	const descriptor = {
		sourceId: 'video-1',
		kind: 'video',
		entry: 'media/video-1/original',
		encoding: 'original',
		mimeType: 'video/quicktime',
		size: 4,
		sha256: DIGEST,
	};
	const serialized = serializeScapeExportManifest(plan, [descriptor]);
	assert.equal(serialized.manifest.formatVersion, 1);
	assert.equal(serialized.manifest.project.schemaFamily, 'framescaper');
	assert.equal(serialized.manifest.project.schemaVersion, 1);
});

test('normal export rejects non-current identities before project or asset traversal', async (context) => {
	const scenarios = [{
		name: 'foreign family',
		identity: { schemaFamily: 'framescaper', schemaVersion: 1 },
		expected: /current-family baseline/iu,
	}, {
		name: 'future version',
		identity: { schemaFamily: 'soundscaper', schemaVersion: 2 },
		expected: /current-family baseline/iu,
	}, {
		name: 'unknown family',
		identity: { schemaFamily: 'unknown', schemaVersion: 1 },
		expected: /unsupported project schema family/iu,
	}];

	for (const scenario of scenarios) await context.test(scenario.name, async () => {
		let domainReads = 0;
		let assetReads = 0;
		const project = { ...scenario.identity };
		Object.defineProperty(project, 'sources', {
			enumerable: true,
			get() { domainReads += 1; return []; },
		});
		await assert.rejects(prepareScapeExport(project, {
			getMediaAssetMetadata() { assetReads += 1; return null; },
		}, {
			output: 'stream',
			currentProjectSchemaFamily: 'soundscaper',
		}), scenario.expected);
		assert.equal(domainReads, 0);
		assert.equal(assetReads, 0);
	});
});

test('the proxy and timing extension is attached to the unified format 1', () => {
	const timingDigest = 'b'.repeat(64);
	const planned = planScapeVideoProxyArchiveAssets([{
		storageKey: `video-proxy-sha256:${DIGEST}`,
		mimeType: 'video/mp4',
		byteLength: 4,
		sha256: DIGEST,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${timingDigest}`,
			sha256: timingDigest,
			sourceSha256: DIGEST,
			byteLength: 40,
			frameCount: 1,
			timescale: 1_000,
			finalFrameDurationTicks: '40',
		},
	}]);
	assert.equal(planned.formatVersion, 1);
	assert.deepEqual(planned.assets.map(({ kind }) => kind), ['video-proxy', 'video-timing']);
});

test('baseline binary payloads decode only for the current project family', () => {
	const encoded = serializeScapeProjectDocument({
		...baselineProject('framescaper'),
		opaqueExtensions: { bytes: Uint8Array.of(1, 2, 255) },
	});
	const current = parseScapeProjectDocument(encoded, {
		currentProjectSchemaFamily: 'framescaper',
	}) as { opaqueExtensions: { bytes: unknown } };
	assert.ok(current.opaqueExtensions.bytes instanceof Uint8Array);
	assert.deepEqual([...current.opaqueExtensions.bytes], [1, 2, 255]);

	const foreign = parseScapeProjectDocument(encoded, {
		currentProjectSchemaFamily: 'soundscaper',
	}) as { opaqueExtensions: { bytes: unknown } };
	assert.equal(foreign.opaqueExtensions.bytes instanceof Uint8Array, false);
});

test('inspection validates manifest/root identity and makes known foreign and future tuples opaque', async () => {
	const soundscaper = await archiveFor(baselineProject('soundscaper'));
	let migrations = 0;
	const current = await inspectScapeProject(soundscaper, null, {
		currentProjectSchemaFamily: 'soundscaper',
		loadProject: (project: unknown) => {
			migrations += 1;
			return { project: project as Record<string, unknown>, readOnly: false, reason: null };
		},
	});
	assert.equal(current.schemaFamily, 'soundscaper');
	assert.equal(current.schemaVersion, 1);
	assert.equal(current.readOnly, false);
	assert.equal(migrations, 1);

	const foreignProject = {
		...baselineProject('framescaper'),
		opaqueExtensions: {
			$soundscaperOpaqueBinary: {
				schemaVersion: 1, id: 0, type: 'Uint8Array', byteLength: 0, base64: '',
			},
		},
	};
	let foreignStoreReads = 0;
	const foreign = await inspectScapeProject(await archiveFor(foreignProject), {
		loadProject: () => {
			foreignStoreReads += 1;
			throw new Error('foreign project id reached the current-family store');
		},
	}, {
		currentProjectSchemaFamily: 'soundscaper',
		loadProject: () => { throw new Error('foreign project domain was traversed'); },
	});
	assert.equal(foreign.schemaFamily, 'framescaper');
	assert.equal(foreign.schemaVersion, 1);
	assert.equal(foreign.readOnly, true);
	assert.equal(foreign.reason, 'foreign-family');
	assert.equal(foreignStoreReads, 0);

	const future = await archiveFor({ ...baselineProject('soundscaper'), schemaVersion: 2 });
	const futureInspection = await inspectScapeProject(future, null, {
		currentProjectSchemaFamily: 'soundscaper',
		loadProject: () => { throw new Error('future project domain was traversed'); },
	});
	assert.equal(futureInspection.schemaFamily, 'soundscaper');
	assert.equal(futureInspection.schemaVersion, 2);
	assert.equal(futureInspection.readOnly, true);
	assert.equal(futureInspection.reason, 'newer-schema');
});

test('foreign and future archive copies preserve exact bytes and return the identity tuple', async () => {
	for (const project of [
		baselineProject('framescaper'),
		{ ...baselineProject('soundscaper'), schemaVersion: 2 },
	]) {
		const archive = await archiveFor(project);
		const expected = new Uint8Array(await archive.arrayBuffer());
		const chunks: Uint8Array[] = [];
		const result = await copyFutureScapeArchive(
			archive,
			(bytes) => { chunks.push(bytes); },
			{ currentProjectSchemaFamily: 'soundscaper' },
		);
		const actual = new Uint8Array(result.byteLength);
		let offset = 0;
		for (const chunk of chunks) {
			actual.set(chunk, offset);
			offset += chunk.byteLength;
		}
		assert.deepEqual(actual, expected);
		assert.equal(result.schemaFamily, project.schemaFamily);
		assert.equal(result.schemaVersion, project.schemaVersion);
	}
});

test('pre-baseline and mismatched Scape identities fail before storage writes', async (context) => {
	const cases = [{
		name: 'family-less format 1',
		project: { schemaVersion: 30, id: 'legacy', title: 'Legacy', sources: [] },
		manifestIdentity: { schemaVersion: 30 },
		expected: (error: unknown) => error instanceof ProjectReimportRequiredError
			&& error.code === 'REIMPORT_REQUIRED',
	}, {
		name: 'format 2',
		project: baselineProject('framescaper'),
		manifestIdentity: { schemaFamily: 'framescaper', schemaVersion: 1 },
		formatVersion: 2,
		expected: (error: unknown) => Boolean(error && typeof error === 'object'
			&& (error as { code?: unknown }).code === 'REIMPORT_REQUIRED'),
	}, {
		name: 'manifest/root family mismatch',
		project: {
			...baselineProject('soundscaper'),
			opaqueExtensions: {
				$soundscaperOpaqueBinary: {
					schemaVersion: 1,
					id: 0,
					type: 'Uint8Array',
					byteLength: 99,
					base64: '',
				},
			},
		},
		manifestIdentity: { schemaFamily: 'framescaper', schemaVersion: 1 },
		expected: /manifest project identity does not match/iu,
	}];

	for (const scenario of cases) await context.test(scenario.name, async () => {
		const archive = await archiveFor(
			scenario.project,
			scenario.manifestIdentity,
			scenario.formatVersion ?? 1,
		);
		let writes = 0;
		const store = {
			loadProject: async () => null,
			saveProject: async () => { writes += 1; },
			beginSourceWrite: async () => { writes += 1; throw new Error('unexpected source write'); },
			beginMediaAssetWrite: async () => { writes += 1; throw new Error('unexpected media write'); },
		};
		await assert.rejects(importScapeProject(archive, store, {
			currentProjectSchemaFamily: 'soundscaper',
			loadProject: (project: unknown) => ({
				project: project as Record<string, unknown>,
				readOnly: false,
			}),
		}), scenario.expected);
		assert.equal(writes, 0);
	});
});

function baselineProject(
	schemaFamily: ProjectSchemaFamily,
	sources: readonly Record<string, unknown>[] = [],
): Record<string, unknown> & { schemaFamily: ProjectSchemaFamily; schemaVersion: number } {
	return {
		schemaFamily,
		schemaVersion: 1,
		id: `${schemaFamily}-project`,
		title: `${schemaFamily} project`,
		sources: [...sources],
		featureRequirements: { schemaVersion: 2, requirements: [] },
	};
}

async function archiveFor(
	project: Record<string, unknown>,
	manifestIdentity: Record<string, unknown> = {
		schemaFamily: project.schemaFamily,
		schemaVersion: project.schemaVersion,
	},
	formatVersion = 1,
): Promise<Blob> {
	const projectText = JSON.stringify(project);
	const projectBytes = TEXT_ENCODER.encode(projectText);
	const manifestText = JSON.stringify({
		format: 'scape-project',
		formatVersion,
		createdAt: CREATED_AT,
		project: {
			entry: 'project.json',
			mimeType: 'application/json',
			...manifestIdentity,
			size: projectBytes.byteLength,
			sha256: digestScapeBytes(projectBytes),
		},
		assets: [],
	});
	const output = new BlobWriter('application/vnd.soundscaper.scape+zip');
	const writer = new ZipWriter(output, { zip64: true, useWebWorkers: false, level: 0 });
	await writer.add('project.json', new TextReader(projectText), { zip64: true, level: 0 });
	await writer.add('manifest.json', new TextReader(manifestText), { zip64: true, level: 0 });
	return writer.close(undefined, { zip64: true });
}
