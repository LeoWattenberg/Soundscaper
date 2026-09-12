/* SPDX-License-Identifier: AGPL-3.0-only */

import { localModelEvidenceSha256 } from '../../desktop/local-model-catalog-integrity.ts';

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

export function testLocalModelCatalog(
	payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return Object.freeze({ ...payload });
}
