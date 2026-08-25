/* SPDX-License-Identifier: AGPL-3.0-only */

import { generateKeyPairSync, sign } from 'node:crypto';

import {
	canonicalJson,
	localModelEvidenceSha256,
} from '../../desktop/local-model-catalog-signature.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const TEST_KEY_ID = 'soundscaper-local-model-catalog-test';

export const TEST_LOCAL_MODEL_CATALOG_SIGNATURE_OPTIONS = Object.freeze({
	trustedKeys: Object.freeze({
		[TEST_KEY_ID]: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
	}),
});

export function testLocalModelEvidence(
	id: string,
	overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		id,
		distributionStatus: 'permitted',
		blockedBy: Object.freeze([]),
		attributionRequired: false,
		requirements: Object.freeze({
			'weights-and-code-license-review': Object.freeze({
				status: 'recorded',
				summary: 'The test fixture records the model licensing requirement.',
			}),
		}),
		evidence: Object.freeze(['tests/helpers/local-model-catalog-v2-fixture.ts']),
		...overrides,
	});
}

export function testLocalModelEvidencePin(
	record: Readonly<Record<string, unknown>>,
): Readonly<{ readonly id: string; readonly sha256: string }> {
	if (typeof record.id !== 'string') throw new TypeError('Test model evidence needs an id.');
	return Object.freeze({ id: record.id, sha256: localModelEvidenceSha256(record) });
}

export function signedTestLocalModelCatalog(
	payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		...payload,
		signature: Object.freeze({
			algorithm: 'Ed25519',
			keyId: TEST_KEY_ID,
			value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
		}),
	});
}
