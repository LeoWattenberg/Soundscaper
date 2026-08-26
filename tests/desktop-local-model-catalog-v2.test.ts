/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
	canonicalJson,
	LOCAL_MODEL_CATALOG_CURRENT_KEY_ID,
	LOCAL_MODEL_CATALOG_NEXT_KEY_ID,
	LOCAL_MODEL_CATALOG_TRUSTED_KEYS,
	localModelEvidenceSha256,
	verifyLocalModelCatalogSignature,
} from '../desktop/local-model-catalog-signature.ts';
import {
	LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
	validateLocalModelCatalog,
} from '../desktop/local-model-catalog.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const TEST_KEY_ID = 'test-catalog-key';
const TEST_TRUST = Object.freeze({
	trustedKeys: Object.freeze({
		[TEST_KEY_ID]: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
	}),
});

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

function signedCatalog(entries: readonly unknown[], signatureOverrides: Record<string, unknown> = {}): unknown {
	const payload = {
		schemaVersion: LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
		publication: {
			bucket: 'soundscaper-assets',
			prefix: 'models',
			publicBaseUrl: 'https://assets.soundscaper.org/models/',
			jurisdiction: 'eu',
		},
		entries,
	};
	return {
		...payload,
		signature: {
			algorithm: 'Ed25519',
			keyId: TEST_KEY_ID,
			value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
			...signatureOverrides,
		},
	};
}

function validate(value: unknown, licensingEvidence: readonly unknown[], refusedIds: readonly string[] = []) {
	return validateLocalModelCatalog(value, { licensingEvidence, refusedIds }, TEST_TRUST);
}

test('V2 admits a signed identity mirror bound to its exact permitted evidence', () => {
	const record = evidence();
	const catalog = validate(signedCatalog([entryFor(record)]), [record]);

	assert.equal(catalog.schemaVersion, 2);
	assert.equal(catalog.entries[0]?.distribution.kind, 'identity-mirrored');
	assert.equal(catalog.entries[0]?.artifacts[0]?.sha256, ARTIFACT.sha256);
	assert.equal(
		localModelEvidenceSha256({ requirements: record.requirements, id: record.id,
			evidence: record.evidence, blockedBy: record.blockedBy, distributionStatus: record.distributionStatus }),
		localModelEvidenceSha256(record),
		'object insertion order cannot change an evidence pin',
	);
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

	const catalog = validate(signedCatalog([entryFor(record, {
		distribution: derivation,
		artifacts: [derivedArtifact],
	})]), [record]);
	assert.deepEqual(catalog.entries[0]?.distribution, derivation);

	assert.throws(
		() => validate(signedCatalog([entryFor(record, {
			distribution: { kind: 'reproducibly-derived' },
			artifacts: [derivedArtifact],
		})]), [record]),
		/derived distribution needs a pinned recipe/iu,
	);
	assert.throws(
		() => validate(signedCatalog([entryFor(record, { artifacts: [derivedArtifact] })]), [record]),
		/identity-mirrored .* does not match its upstream bytes/iu,
	);
});

test('an unsigned, corruptly signed, or unknown-key catalog is refused', () => {
	const record = evidence();
	const signed = signedCatalog([entryFor(record)]) as Record<string, unknown>;
	const { signature: _signature, ...unsigned } = signed;

	assert.throws(() => validate(unsigned, [record]), /needs an Ed25519 signature/iu);
	assert.throws(
		() => validate({ ...signed, entries: [] }, [record]),
		/signature is invalid/iu,
	);
	assert.throws(
		() => validate(signedCatalog([entryFor(record)], { keyId: 'unknown-key' }), [record]),
		/signing key is not trusted/iu,
	);
});

test('production pins distinct current and successor Ed25519 catalog keys', async () => {
	assert.deepEqual(Object.keys(LOCAL_MODEL_CATALOG_TRUSTED_KEYS), [
		LOCAL_MODEL_CATALOG_CURRENT_KEY_ID,
		LOCAL_MODEL_CATALOG_NEXT_KEY_ID,
	]);
	assert.notEqual(
		LOCAL_MODEL_CATALOG_TRUSTED_KEYS[LOCAL_MODEL_CATALOG_CURRENT_KEY_ID],
		LOCAL_MODEL_CATALOG_TRUSTED_KEYS[LOCAL_MODEL_CATALOG_NEXT_KEY_ID],
	);
	for (const pem of Object.values(LOCAL_MODEL_CATALOG_TRUSTED_KEYS)) {
		assert.equal(createPublicKey(pem).asymmetricKeyType, 'ed25519');
	}

	const checkedIn = (await import('../config/local-model-catalog.json', {
		with: { type: 'json' },
	})).default;
	assert.equal(checkedIn.signature.keyId, LOCAL_MODEL_CATALOG_CURRENT_KEY_ID);
	assert.doesNotThrow(() => verifyLocalModelCatalogSignature(checkedIn, {
		trustedKeys: { [LOCAL_MODEL_CATALOG_CURRENT_KEY_ID]: TEST_TRUST.trustedKeys[TEST_KEY_ID]! },
	}));
});

test('blocked, refused, unresolved, missing, or changed evidence cannot admit a model', () => {
	const permitted = evidence();
	const entry = entryFor(permitted);

	assert.throws(
		() => validate(signedCatalog([entry]), [evidence('example-model', 'blocked')]),
		/distribution status must be permitted/iu,
	);
	assert.throws(
		() => validate(signedCatalog([entry]), [permitted], ['example-model']),
		/refused models cannot be cataloged/iu,
	);
	assert.throws(
		() => validate(signedCatalog([entry]), [evidence('example-model', 'permitted', 'unresolved')]),
		/licensing requirement .* must be recorded/iu,
	);
	assert.throws(
		() => validate(signedCatalog([entry]), []),
		/needs exactly one licensing evidence record/iu,
	);
	assert.throws(
		() => validate(signedCatalog([entry]), [permitted, permitted]),
		/needs exactly one licensing evidence record/iu,
	);
	assert.throws(
		() => validate(signedCatalog([entry]), [{ ...permitted, blockedBy: ['unresolved-review'] }]),
		/cannot retain blockers/iu,
	);
	assert.throws(
		() => validate(signedCatalog([entry]), [{ ...permitted, purpose: 'Evidence changed after signing.' }]),
		/licensing evidence digest does not match/iu,
	);
});

test('an offered V2 entry cannot leave its distribution artifacts unresolved', () => {
	const record = evidence();
	assert.throws(
		() => validate(signedCatalog([entryFor(record, { artifacts: null })]), [record]),
		/distribution artifacts must be a non-empty array/iu,
	);
});
