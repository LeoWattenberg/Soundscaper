/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import {
	FRAMESCAPER_SCAPE_ASSET_KINDS as ASSET_KINDS,
	collectFramescaperScapeAssetReferences as collectReferences,
	planFramescaperScapeExportAssets as planExport,
	validateFramescaperScapeAssetReferenceBytes as validateBytes,
	validateFramescaperScapeImportAssets as validateImport,
} from '../src/framescaper/editor-scape-asset-plan.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProject(PROFILE, {} as never) as unknown as Data;
}

function asset(overrides: Data = {}): Data {
	return {
		kind: ASSET_KINDS[0],
		sourceId: 'asset-1',
		encoding: 'framescaper-asset-v1',
		entry: 'assets/asset-1',
		mimeType: 'application/octet-stream',
		sha256: 'ab'.repeat(32),
		size: 10,
		...overrides,
	};
}

test('the durable asset kinds are published as a closed inventory', () => {
	assert.deepEqual([...ASSET_KINDS], [
		'framescaper-still', 'framescaper-freeze-render', 'framescaper-video-proxy',
		'framescaper-proxy-timing', 'framescaper-cube-lut', 'framescaper-motion-analysis',
	]);
});

test('a project with no durable assets references none', () => {
	assert.deepEqual(collectReferences(project() as never), []);
});

test('a project with no durable assets plans no export bodies', async () => {
	assert.deepEqual(
		await planExport(project() as never, { loadSource: async () => null } as never),
		[],
	);
});

test('an archive matching the project authority is admitted', () => {
	const validated = validateImport(project() as never, { assets: [] } as never) as unknown as Data;

	assert.deepEqual(validated.references, []);
	assert.equal((validated.descriptorByArchiveId as Map<string, unknown>).size, 0);
});

test('an archive carrying a durable asset the project never referenced is refused', () => {
	assert.throws(
		() => validateImport(project() as never, { assets: [asset()] } as never),
		/incomplete durable finishing asset inventory/u,
	);
});

test('an archive carrying assets of another product is ignored, not counted', () => {
	assert.doesNotThrow(
		() => validateImport(
			project() as never,
			{ assets: [asset({ kind: 'soundscaper-something-else' })] } as never,
		),
		'only the Framescaper durable kinds participate in the inventory count',
	);
});

test('reference byte validation applies only to the roles that carry parsed bodies', () => {
	assert.doesNotThrow(
		() => validateBytes({ role: 'still' } as never, new Uint8Array(1)),
		'a role with no parsed body has nothing to validate',
	);
});
