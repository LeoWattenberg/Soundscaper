/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { canonicalJson, localModelEvidenceSha256 } from '../desktop/local-model-catalog-integrity.ts';
import { verifyKokoroModelRelease } from '../scripts/models/verify-kokoro-model-release.mjs';

const root = resolve(import.meta.dirname, '..');
const candidate = JSON.parse(await readFile(resolve(root,
	'config/assistance-kokoro-model-source-candidate.json'), 'utf8'));
const publication = {
	bucket: 'soundscaper-assets', prefix: 'models',
	publicBaseUrl: 'https://assets.soundscaper.org/models/', jurisdiction: 'eu',
};

function fixture() {
	const licensingRow = {
		id: candidate.modelId, purpose: 'Local speech synthesis', runtimeFormat: 'onnx',
		codeLicense: 'Apache-2.0', weightsLicense: 'Apache-2.0', attributionRequired: false,
		distributionStatus: 'permitted', blockedBy: [],
		requirements: Object.fromEntries([
			'weights-and-code-license-review', 'training-data-provenance-record',
			'model-card-and-use-restrictions', 'versioned-download-notices-and-hashes',
		].map((key) => [key, { status: 'recorded', summary: key }])),
		provenanceSources: ['https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX'],
		evidence: ['tests/kokoro-model-release.test.js'],
	};
	const source = candidate.onnxSource;
	const upstreamArtifacts = source.artifacts.map(({ fileName, byteLength, sha256, url }) =>
		({ fileName, byteLength, sha256, url }));
	const artifacts = upstreamArtifacts.map(({ fileName, byteLength, sha256 }) => ({
		fileName, byteLength, sha256,
		url: `${publication.publicBaseUrl}${candidate.modelId}/${candidate.version}/${fileName}`,
	}));
	const entry = {
		modelId: candidate.modelId, version: candidate.version, task: 'text-to-speech',
		platforms: ['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'],
		minimumMemoryBytes: 8 * 1024 ** 3,
		licensingEvidence: { id: candidate.modelId, sha256: localModelEvidenceSha256(licensingRow) },
		upstream: {
			source: `https://huggingface.co/${source.repository}`,
			revision: source.revision, artifacts: upstreamArtifacts,
		},
		distribution: { kind: 'identity-mirrored' }, artifacts,
	};
	const value = {
		candidate: structuredClone(candidate),
		catalog: { schemaVersion: 2, publication, entries: [entry] },
		licensingEvidence: [licensingRow],
		notices: artifacts.map(({ fileName, sha256 }) =>
			`- \`${fileName}\`: SHA-256 \`${sha256}\`.`).join('\n'),
		receiptBytes: Buffer.from(`${JSON.stringify({
			schemaVersion: 1, checkedAt: '2026-09-22T00:00:00.000Z',
			modelId: candidate.modelId, version: candidate.version,
			checks: ['public-head', 'byte-range', 'cors', 'full-sha256'], artifacts,
		})}\n`),
	};
	const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
	value.candidate.releaseEvidence = {
		catalogEntrySha256: digest(canonicalJson(entry)),
		publicReadbackSha256: digest(value.receiptBytes),
		licensingEvidenceSha256: localModelEvidenceSha256(licensingRow),
	};
	return value;
}

test('Kokoro release binds all 56 source pins, mirror artifacts, notices, and public checks', () => {
	const result = verifyKokoroModelRelease(fixture());
	assert.equal(result.status, 'catalog-inclusion-verified');
	assert.equal(result.modelId, 'kokoro-82m-v1.0');
	assert.equal(result.artifactCount, 56);
	assert.match(result.catalogEntrySha256, /^[a-f\d]{64}$/u);
	assert.match(result.publicReadbackSha256, /^[a-f\d]{64}$/u);
});

test('Kokoro release rejects an omitted or changed voice and altered source revision', () => {
	for (const [change, expected] of [
		[(value) => { value.catalog.entries[0].artifacts.pop(); }, /catalog|artifact/u],
		[(value) => { value.catalog.entries[0].artifacts[0].sha256 = 'f'.repeat(64); }, /catalog|artifact|mirrored/u],
		[(value) => { value.candidate.onnxSource.revision = 'f'.repeat(40); }, /upstream|source/u],
		[(value) => { value.candidate.onnxSource.artifacts[0].sourcePath = 'other.bin'; }, /source|URL/u],
	]) {
		const value = fixture();
		change(value);
		assert.throws(() => verifyKokoroModelRelease(value), expected);
	}
});

test('Kokoro release rejects incomplete licensing and missing artifact notices', () => {
	for (const [change, expected] of [
		[(value) => { value.licensingEvidence[0].blockedBy = ['weights-and-code-license-review']; }, /licens|blocked|digest/u],
		[(value) => { value.licensingEvidence[0].requirements['training-data-provenance-record'].status = 'unresolved'; }, /licens|requirement|digest/u],
		[(value) => { value.notices = value.notices.split('\n').slice(1).join('\n'); }, /notice/u],
	]) {
		const value = fixture();
		change(value);
		assert.throws(() => verifyKokoroModelRelease(value), expected);
	}
});

test('Kokoro release rejects a receipt missing full public verification or an artifact', () => {
	for (const [change, expected] of [
		[(receipt) => { receipt.checks.pop(); }, /checks|readback/u],
		[(receipt) => { receipt.artifacts.pop(); }, /artifact|readback/u],
		[(receipt) => { receipt.artifacts[0].url += '?other'; }, /artifact|readback/u],
	]) {
		const value = fixture();
		const receipt = JSON.parse(value.receiptBytes);
		change(receipt);
		value.receiptBytes = Buffer.from(JSON.stringify(receipt));
		assert.throws(() => verifyKokoroModelRelease(value), expected);
	}
});

test('Kokoro release rejects a valid but unreviewed catalog memory change', () => {
	const value = fixture();
	value.catalog.entries[0].minimumMemoryBytes /= 2;
	assert.throws(() => verifyKokoroModelRelease(value), /catalog.*SHA-256|release.*pin/u);
});
