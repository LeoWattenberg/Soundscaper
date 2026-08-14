/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	assertPublishable,
	catalogWithMirroredArtifacts,
	fetchPinnedArtifact,
	findCatalogEntry,
	mirrorLocalModel,
	mirrorLocation,
} from '../scripts/lib/local-model-mirror.mjs';

const EVIDENCE = Object.freeze([
	{ id: 'silero-vad-v6', blockedBy: ['versioned-download-notices-and-hashes'] },
	{ id: 'spleeter', blockedBy: ['versioned-download-notices-and-hashes', 'weights-and-code-license-review'] },
]);

const PAYLOAD = 'silero weights';
const DIGEST = createHash('sha256').update(PAYLOAD).digest('hex');

const CATALOG = Object.freeze({
	schemaVersion: 1,
	publication: {
		bucket: 'soundscaper-assets',
		prefix: 'models',
		publicBaseUrl: 'https://assets.soundscaper.org/models/',
		jurisdiction: 'eu',
	},
	entries: [
		{
			modelId: 'silero-vad-v6',
			version: '6.2.1',
			upstream: {
				source: 'https://github.com/snakers4/silero-vad',
				revision: 'abc123',
				artifacts: [{
					fileName: 'silero_vad.onnx',
					byteLength: Buffer.byteLength(PAYLOAD),
					sha256: DIGEST,
					url: 'https://raw.githubusercontent.invalid/silero_vad.onnx',
				}],
			},
			artifacts: null,
		},
		{ modelId: 'unpinned-model', version: '1.0.0', upstream: null, artifacts: null },
	],
});

function stubFetch(body, status = 200) {
	return async () => ({
		status,
		body: (async function* stream() {
			if (body !== null) yield new Uint8Array(Buffer.from(body));
		})(),
	});
}

async function staging(t) {
	const root = await mkdtemp(join(tmpdir(), 'scape-model-mirror-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test('a mirrored artifact takes a versioned key under the publication prefix', () => {
	const entry = findCatalogEntry(CATALOG, 'silero-vad-v6');
	assert.deepEqual(mirrorLocation(CATALOG, entry, 'silero_vad.onnx'), {
		key: 'models/silero-vad-v6/6.2.1/silero_vad.onnx',
		url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	});
});

test('a model with no pinned upstream cannot be mirrored', () => {
	assert.throws(() => findCatalogEntry(CATALOG, 'unpinned-model'), /no pinned upstream/iu);
	assert.throws(() => findCatalogEntry(CATALOG, 'absent-model'), /not in the model catalog/iu);
});

test('a fetched artifact is verified against its pin', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;

	const result = await fetchPinnedArtifact({
		artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});

	assert.equal(result.reused, false);
	assert.equal(String(await readFile(result.path)), PAYLOAD);
});

test('bytes that disagree with the pin stop the run', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;

	// Same length as the pin, so this reaches the digest check rather than the
	// cheaper length check in front of it.
	assert.equal('silero weightz'.length, PAYLOAD.length);
	await assert.rejects(
		fetchPinnedArtifact({
			artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch('silero weightz'),
		}),
		/hashed .*, not the pinned/iu,
	);
	await assert.rejects(
		fetchPinnedArtifact({
			artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch('short'),
		}),
		/ended at 5 of 14 bytes/iu,
	);
	await assert.rejects(
		fetchPinnedArtifact({
			artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch('much longer than pinned'),
		}),
		/exceeded its pinned byte length/iu,
	);
	await assert.rejects(
		fetchPinnedArtifact({
			artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(null, 404),
		}),
		/returned HTTP 404/iu,
	);
});

test('an already-staged artifact is reused rather than refetched', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;

	await fetchPinnedArtifact({
		artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});
	const second = await fetchPinnedArtifact({
		artifact,
		modelId: 'silero-vad-v6',
		stagingRoot,
		fetchImpl: () => { throw new Error('must not refetch'); },
	});

	assert.equal(second.reused, true);
});

test('a staged file that no longer matches its pin is refetched', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;
	const first = await fetchPinnedArtifact({
		artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});
	await writeFile(first.path, 'corrupted....');

	const refetched = await fetchPinnedArtifact({
		artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});
	assert.equal(refetched.reused, false);
	assert.equal(String(await readFile(refetched.path)), PAYLOAD);
});

test('verifying does not publish', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);

	const result = await mirrorLocalModel({
		catalog: CATALOG,
		evidence: EVIDENCE,
		modelId: 'silero-vad-v6',
		stagingRoot,
		fetchImpl: stubFetch(PAYLOAD),
		execute: () => { throw new Error('must not publish'); },
	});

	assert.equal(result.published, false);
	assert.deepEqual(result.artifacts, [{
		fileName: 'silero_vad.onnx',
		byteLength: Buffer.byteLength(PAYLOAD),
		sha256: DIGEST,
		url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	}]);
});

test('publishing uploads every verified artifact to its versioned key', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const uploads = [];

	const result = await mirrorLocalModel({
		catalog: CATALOG,
		evidence: EVIDENCE,
		modelId: 'silero-vad-v6',
		stagingRoot,
		fetchImpl: stubFetch(PAYLOAD),
		publish: true,
		execute: (command) => {
			uploads.push({
				bucket: command.bucket,
				key: command.key,
				contentType: command.contentType,
				jurisdiction: command.jurisdiction,
			});
			return { status: 0 };
		},
	});

	assert.equal(result.published, true);
	assert.deepEqual(uploads, [{
		bucket: 'soundscaper-assets',
		key: 'models/silero-vad-v6/6.2.1/silero_vad.onnx',
		contentType: 'application/octet-stream',
		jurisdiction: 'eu',
	}]);
});

test('a failed upload stops the run rather than reporting success', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);

	await assert.rejects(
		mirrorLocalModel({
			catalog: CATALOG,
			evidence: EVIDENCE,
			modelId: 'silero-vad-v6',
			stagingRoot,
			fetchImpl: stubFetch(PAYLOAD),
			publish: true,
			execute: () => ({ status: 1, stderr: 'no such bucket' }),
		}),
		/publishing models\/silero-vad-v6.*failed: no such bucket/isu,
	);
});

test('recorded artifacts replace only the mirrored entry', () => {
	const artifacts = [{
		fileName: 'silero_vad.onnx',
		byteLength: Buffer.byteLength(PAYLOAD),
		sha256: DIGEST,
		url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	}];

	const updated = catalogWithMirroredArtifacts(CATALOG, 'silero-vad-v6', artifacts);

	assert.deepEqual(updated.entries[0].artifacts, artifacts);
	assert.equal(updated.entries[1].artifacts, null, 'other entries are untouched');
	assert.equal(CATALOG.entries[0].artifacts, null, 'the input catalog is not mutated');
	assert.throws(() => catalogWithMirroredArtifacts(CATALOG, 'silero-vad-v6', []), /nothing to record/iu);
});

test('a model whose licence review is unresolved cannot be published', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const catalog = {
		...CATALOG,
		entries: [{ ...CATALOG.entries[0], modelId: 'spleeter' }, ...CATALOG.entries.slice(1)],
	};

	await assert.rejects(
		mirrorLocalModel({
			catalog,
			evidence: EVIDENCE,
			modelId: 'spleeter',
			stagingRoot,
			fetchImpl: stubFetch(PAYLOAD),
			publish: true,
			execute: () => { throw new Error('must not upload'); },
		}),
		/blocked by weights-and-code-license-review/iu,
	);

	const verified = await mirrorLocalModel({
		catalog, evidence: EVIDENCE, modelId: 'spleeter', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});
	assert.equal(verified.published, false, 'verifying locally stays allowed');
});

test('publishing needs a licensing evidence record at all', () => {
	assert.throws(() => assertPublishable(EVIDENCE, 'absent-model'), /no licensing evidence record/iu);
	assert.throws(() => assertPublishable(null, 'silero-vad-v6'), /needs the licensing evidence register/iu);
	assert.deepEqual(assertPublishable(EVIDENCE, 'silero-vad-v6').id, 'silero-vad-v6');
});
