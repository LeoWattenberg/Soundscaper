/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalJson,
	localModelEvidenceSha256,
} from '../desktop/local-model-catalog-integrity.ts';
import {
	LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
	LOCAL_MODEL_TASKS,
	validateLocalModelCatalog,
} from '../desktop/local-model-catalog.ts';

const ARTIFACT = Object.freeze({
	fileName: 'model.onnx',
	byteLength: 1_000,
	sha256: 'a'.repeat(64),
	url: 'https://upstream.invalid/model.onnx',
});

function evidence(
	id = 'example-model',
	distributionStatus = 'permitted',
	requirementStatus = 'recorded',
): Record<string, unknown> {
	return {
		id,
		distributionStatus,
		blockedBy: distributionStatus === 'permitted' ? [] : ['weights-and-code-license-review'],
		requirements: {
		'weights-and-code-license-review': {
			status: requirementStatus,
			summary: 'Test evidence is deliberately complete.',
		},
		},
		evidence: ['tests/desktop-local-model-catalog-v2.test.ts'],
	};
}

function entryFor(
	licensingRecord: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const id = licensingRecord.id as string;
	return {
		modelId: id,
		version: '1.0.0',
		task: 'voice-activity-detection',
		platforms: ['linux-x64'],
		minimumMemoryBytes: 2 * 1024 ** 3,
		licensingEvidence: {
			id,
			sha256: localModelEvidenceSha256(licensingRecord),
		},
		upstream: {
			source: 'https://upstream.invalid/repo',
			revision: 'abc123',
			artifacts: [ARTIFACT],
		},
		distribution: { kind: 'identity-mirrored' },
		artifacts: [{
			...ARTIFACT,
			url: `https://assets.soundscaper.org/models/${id}/1.0.0/model.onnx`,
		}],
		...overrides,
	};
}

function catalog(entries: readonly unknown[]): unknown {
	return {
		schemaVersion: LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
		publication: {
			bucket: 'soundscaper-assets',
			prefix: 'models',
			publicBaseUrl: 'https://assets.soundscaper.org/models/',
			jurisdiction: 'eu',
		},
		entries,
	};
}

function validate(value: unknown, licensingEvidence: readonly unknown[], refusedIds: readonly string[] = []) {
	return validateLocalModelCatalog(value, { licensingEvidence, refusedIds });
}

test('V2 admits an identity mirror bound to its exact permitted evidence SHA-256', () => {
	const record = evidence();
	const validated = validate(catalog([entryFor(record)]), [record]);

	assert.equal(validated.schemaVersion, 2);
	assert.equal(validated.entries[0]?.distribution.kind, 'identity-mirrored');
	assert.equal(validated.entries[0]?.artifacts[0]?.sha256, ARTIFACT.sha256);
	assert.equal(
		localModelEvidenceSha256({ requirements: record.requirements, id: record.id,
			evidence: record.evidence, blockedBy: record.blockedBy, distributionStatus: record.distributionStatus }),
		localModelEvidenceSha256(record),
		'object insertion order cannot change an evidence pin',
	);
});

test('the catalog task vocabulary covers every activated Milestone 7 model family', () => {
	for (const task of [
		'word-alignment', 'source-separation', 'audio-tagging', 'beat-tracking',
		'shot-detection', 'editorial-generation',
	] as const) assert.ok(LOCAL_MODEL_TASKS.includes(task));
});

test('V2 distinguishes a reproducibly derived artifact from an identity mirror', () => {
	const record = evidence();
	const derivedArtifact = {
		...ARTIFACT,
		byteLength: 800,
		sha256: 'b'.repeat(64),
		url: 'https://assets.soundscaper.org/models/example-model/1.0.0/model.onnx',
	};
	const derivation = {
		kind: 'reproducibly-derived',
		recipe: 'scripts/models/convert-example.mjs',
		revision: 'abc123',
		environmentSha256: 'c'.repeat(64),
	};

	const validated = validate(catalog([entryFor(record, {
		distribution: derivation,
		artifacts: [derivedArtifact],
	})]), [record]);
	assert.deepEqual(validated.entries[0]?.distribution, derivation);

	assert.throws(
		() => validate(catalog([entryFor(record, {
			distribution: { kind: 'reproducibly-derived' },
			artifacts: [derivedArtifact],
		})]), [record]),
		/derived distribution needs a pinned recipe/iu,
	);
	assert.throws(
		() => validate(catalog([entryFor(record, { artifacts: [derivedArtifact] })]), [record]),
		/identity-mirrored .* does not match its upstream bytes/iu,
	);
});

test('the catalog is plain data and retains deterministic SHA-256 review pins', async () => {
	const checkedIn = (await import('../config/local-model-catalog.json', {
		with: { type: 'json' },
	})).default as Record<string, unknown>;
	assert.equal(checkedIn.signature, undefined);
	assert.match(localModelEvidenceSha256(checkedIn), /^[a-f\d]{64}$/u);
	assert.equal(localModelEvidenceSha256(checkedIn), localModelEvidenceSha256(JSON.parse(canonicalJson(checkedIn))));
	assert.throws(
		() => validate({ ...checkedIn, signature: { algorithm: 'Ed25519' } }, []),
		/contain only schemaVersion, publication, and entries/iu,
	);
});

test('distribution metadata does not override fail-closed evidence identity', () => {
	const permitted = evidence();
	const entry = entryFor(permitted);

	for (const [record, refusedIds] of [
		[evidence('example-model', 'blocked'), []],
		[permitted, ['example-model']],
		[evidence('example-model', 'permitted', 'unresolved'), []],
	] as const) {
		assert.doesNotThrow(() => validate(
			catalog([entryFor(record)]), [record], [...refusedIds],
		));
	}
	assert.throws(
		() => validate(catalog([entry]), []),
		/needs exactly one licensing evidence record/iu,
	);
	assert.throws(
		() => validate(catalog([entry]), [permitted, permitted]),
		/needs exactly one licensing evidence record/iu,
	);
	assert.throws(
		() => validate(catalog([entry]), [{ ...permitted, blockedBy: ['unresolved-review'] }]),
		/licensing evidence digest does not match/iu,
	);
	assert.throws(
		() => validate(catalog([entry]), [{ ...permitted, purpose: 'Evidence changed after publication.' }]),
		/licensing evidence digest does not match/iu,
	);
});

test('an offered V2 entry cannot leave its distribution artifacts unresolved', () => {
	const record = evidence();
	assert.throws(
		() => validate(catalog([entryFor(record, { artifacts: null })]), [record]),
		/distribution artifacts must be a non-empty array/iu,
	);
});
