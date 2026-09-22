#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Verify Kokoro's multi-artifact catalog and retained public readback. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, localModelEvidenceSha256 } from '../../desktop/local-model-catalog-integrity.ts';
import { validateLocalModelCatalog } from '../../desktop/local-model-catalog.ts';
import { KOKORO_VOICES_BY_LANGUAGE } from '../../src/common/editor/assistance/kokoro-voices-v1.ts';
import { verifyMirroredArtifact } from '../lib/local-model-mirror-publication.mjs';

const MODEL_ID = 'kokoro-82m-v1.0';
const CHECKS = Object.freeze(['public-head', 'byte-range', 'cors', 'full-sha256']);
const REQUIREMENTS = Object.freeze([
	'weights-and-code-license-review',
	'training-data-provenance-record',
	'model-card-and-use-restrictions',
	'versioned-download-notices-and-hashes',
]);
const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^[a-f\d]{40}$/u;
const root = resolve(import.meta.dirname, '../..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sourceArtifacts(candidate) {
	assert.equal(candidate?.schemaVersion, 1, 'Kokoro source candidate schema is unsupported.');
	assert.equal(candidate.modelId, MODEL_ID, 'Kokoro source candidate identity changed.');
	assert.equal(candidate.version, '1.0.0', 'Kokoro source candidate version changed.');
	const source = candidate.onnxSource;
	assert.equal(source?.repository, 'onnx-community/Kokoro-82M-v1.0-ONNX',
		'Kokoro source repository changed.');
	assert.match(source.revision, REVISION, 'Kokoro source revision must be a commit.');
	assert.ok(Array.isArray(source.artifacts), 'Kokoro source artifacts are missing.');
	const voices = Object.values(KOKORO_VOICES_BY_LANGUAGE).flat().map((voice) => `${voice}.bin`);
	assert.deepEqual(source.artifacts.map(({ fileName }) => fileName).toSorted(),
		['model.onnx', 'tokenizer.json', ...voices].toSorted(),
		'Kokoro source artifacts must include its model, tokenizer, and all 54 voices.');
	return source.artifacts.map((artifact) => {
		assert.match(artifact.sha256, SHA256, `${artifact.fileName} source SHA-256 is invalid.`);
		assert.ok(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0,
			`${artifact.fileName} source length is invalid.`);
		const sourcePath = artifact.fileName === 'model.onnx' ? 'onnx/model.onnx'
			: artifact.fileName === 'tokenizer.json' ? 'tokenizer.json'
				: `voices/${artifact.fileName}`;
		assert.equal(artifact.sourcePath, sourcePath,
			`${artifact.fileName} source path does not match its role.`);
		assert.equal(artifact.url,
			`https://huggingface.co/${source.repository}/resolve/${source.revision}/${sourcePath}`,
			`${artifact.fileName} source URL does not bind the pinned revision.`);
		return {
			fileName: artifact.fileName, byteLength: artifact.byteLength,
			sha256: artifact.sha256, url: artifact.url,
		};
	});
}

function assertNotices(notices, artifacts) {
	assert.equal(typeof notices, 'string', 'Kokoro offline notices are missing.');
	const lines = notices.split('\n');
	for (const { fileName, sha256 } of artifacts) {
		assert.ok(lines.some((line) => line.includes(`\`${fileName}\``)
			&& line.includes(`\`${sha256}\``)),
			`Kokoro offline notice is missing ${fileName} and its SHA-256.`);
	}
}

/**
 * The receipt records a completed public HEAD, Range, CORS, and full-body SHA
 * check for each artifact. --verify-public repeats those checks against the CDN.
 */
export function verifyKokoroModelRelease({ candidate, catalog, licensingEvidence,
	notices, receiptBytes }) {
	const pinned = sourceArtifacts(candidate);
	const validated = validateLocalModelCatalog(catalog, { licensingEvidence });
	const entry = validated.entries.find(({ modelId }) => modelId === MODEL_ID);
	assert.ok(entry, 'Kokoro is not included in the production catalog.');
	assert.equal(entry.version, candidate.version, 'Kokoro catalog version differs from source.');
	assert.equal(entry.task, 'text-to-speech', 'Kokoro catalog task is wrong.');
	assert.deepEqual(entry.platforms,
		['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'],
		'Kokoro catalog platforms differ from its five-target plan.');
	assert.equal(entry.upstream.source,
		`https://huggingface.co/${candidate.onnxSource.repository}`,
		'Kokoro catalog upstream source differs from its candidate.');
	assert.equal(entry.upstream.revision, candidate.onnxSource.revision,
		'Kokoro catalog upstream revision differs from its candidate.');
	assert.equal(entry.distribution.kind, 'identity-mirrored',
		'Kokoro catalog must distribute exact upstream bytes.');
	assert.equal(canonicalJson(entry.upstream.artifacts), canonicalJson(pinned),
		'Kokoro catalog upstream artifacts differ from their source pins.');
	const expectedArtifacts = pinned.map(({ fileName, byteLength, sha256 }) => ({
		fileName, byteLength, sha256,
		url: `${validated.publication.publicBaseUrl}${MODEL_ID}/${entry.version}/${fileName}`,
	}));
	assert.equal(canonicalJson(entry.artifacts), canonicalJson(expectedArtifacts),
		'Kokoro catalog mirror artifacts differ from the pinned source.');

	const rows = licensingEvidence.filter(({ id }) => id === MODEL_ID);
	assert.equal(rows.length, 1, 'Kokoro needs exactly one licensing evidence row.');
	const row = rows[0];
	assert.equal(entry.licensingEvidence.sha256, localModelEvidenceSha256(row),
		'Kokoro catalog licensing evidence digest differs from the reviewed row.');
	assert.equal(row.distributionStatus, 'permitted', 'Kokoro licensing does not permit distribution.');
	assert.deepEqual(row.blockedBy, [], 'Kokoro licensing evidence remains blocked.');
	for (const name of REQUIREMENTS) {
		assert.equal(row.requirements?.[name]?.status, 'recorded',
			`Kokoro licensing requirement ${name} is incomplete.`);
	}
	assertNotices(notices, expectedArtifacts);

	assert.ok(Buffer.isBuffer(receiptBytes) && receiptBytes.length > 0,
		'Kokoro public readback receipt is missing.');
	const receipt = JSON.parse(receiptBytes.toString('utf8'));
	assert.deepEqual(Object.keys(receipt).sort(),
		['artifacts', 'checkedAt', 'checks', 'modelId', 'schemaVersion', 'version'],
		'Kokoro public readback receipt has unexpected fields.');
	assert.equal(receipt.schemaVersion, 1, 'Kokoro public readback receipt schema is unsupported.');
	assert.equal(receipt.modelId, MODEL_ID, 'Kokoro public readback model identity differs.');
	assert.equal(receipt.version, entry.version, 'Kokoro public readback version differs.');
	assert.ok(typeof receipt.checkedAt === 'string'
		&& !Number.isNaN(Date.parse(receipt.checkedAt)),
		'Kokoro public readback timestamp is invalid.');
	assert.deepEqual(receipt.checks, CHECKS, 'Kokoro public readback checks are incomplete.');
	assert.equal(canonicalJson(receipt.artifacts), canonicalJson(expectedArtifacts),
		'Kokoro public readback artifacts differ from the catalog.');

	const releasePins = {
		catalogEntrySha256: digest(canonicalJson(entry)),
		publicReadbackSha256: digest(receiptBytes),
		licensingEvidenceSha256: localModelEvidenceSha256(row),
	};
	assert.deepEqual(candidate.releaseEvidence, releasePins,
		'Kokoro release pins do not match the reviewed catalog, licensing, and public readback.');
	return Object.freeze({
		schemaVersion: 1, status: 'catalog-inclusion-verified', modelId: MODEL_ID,
		artifactCount: expectedArtifacts.length,
		...releasePins,
	});
}

async function main() {
	const verifyPublic = process.argv.length === 3 && process.argv[2] === '--verify-public';
	if (process.argv.length !== 2 && !verifyPublic) {
		throw new Error('Usage: node scripts/models/verify-kokoro-model-release.mjs [--verify-public]');
	}
	const read = async (path) => readFile(resolve(root, path));
	const [candidateBytes, catalogBytes, licensingBytes, notices, receiptBytes] =
		await Promise.all([
			read('config/assistance-kokoro-model-source-candidate.json'),
			read('config/local-model-catalog.json'),
			read('config/production-licensing-matrix.json'),
			read('THIRD_PARTY_LICENSES.md'),
			read(`evidence/local-model-publication/${MODEL_ID}.json`),
		]);
	const catalog = JSON.parse(catalogBytes.toString('utf8'));
	const result = verifyKokoroModelRelease({
		candidate: JSON.parse(candidateBytes.toString('utf8')),
		catalog,
		licensingEvidence: JSON.parse(licensingBytes.toString('utf8')).localModelEvidence,
		notices: notices.toString('utf8'), receiptBytes,
	});
	if (verifyPublic) {
		const entry = catalog.entries.find(({ modelId }) => modelId === MODEL_ID);
		for (const artifact of entry.artifacts) {
			await verifyMirroredArtifact({ url: artifact.url, artifact });
			process.stderr.write(`${artifact.fileName}: public readback verified\n`);
		}
	}
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
