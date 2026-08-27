/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { LocalModelCatalog } from '../desktop/local-model-catalog.ts';
import { localModelEvidenceSha256 } from '../desktop/local-model-catalog-signature.ts';
import { createInstalledLocalModelNotices } from '../desktop/local-model-notices.ts';
import type { InstalledLocalModel } from '../desktop/local-model-store.ts';

const ARTIFACT = Object.freeze({
	fileName: 'model.onnx', byteLength: 42, sha256: 'a'.repeat(64),
	url: 'https://assets.soundscaper.org/models/model-v1/1/model.onnx',
});
const EVIDENCE: Readonly<Record<string, unknown>> = Object.freeze({
	id: 'model-v1',
	purpose: 'A test model for authenticated notices.',
	runtimeFormat: 'onnx',
	codeLicense: 'Apache-2.0',
	weightsLicense: 'CC-BY-4.0',
	attributionRequired: true,
	distributionStatus: 'permitted',
	blockedBy: Object.freeze([]),
	requirements: Object.freeze({
		'notice-and-hashes': Object.freeze({ status: 'recorded', summary: 'Recorded.' }),
	}),
	provenanceSources: Object.freeze(['https://models.invalid/model-v1']),
});
const CATALOG: LocalModelCatalog = Object.freeze({
	schemaVersion: 2,
	publication: Object.freeze({
		bucket: 'soundscaper-assets', prefix: 'models',
		publicBaseUrl: 'https://assets.soundscaper.org/models/', jurisdiction: 'eu',
	}),
	entries: Object.freeze([Object.freeze({
		modelId: 'model-v1', version: '1', task: 'speech-recognition' as const,
		platforms: Object.freeze(['linux-x64' as const]), minimumMemoryBytes: 1,
		licensingEvidence: Object.freeze({ id: 'model-v1', sha256: localModelEvidenceSha256(EVIDENCE) }),
		upstream: Object.freeze({
			source: 'https://models.invalid/model-v1', revision: 'revision-1',
			artifacts: Object.freeze([ARTIFACT]),
		}),
		distribution: Object.freeze({ kind: 'identity-mirrored' as const }),
		artifacts: Object.freeze([ARTIFACT]),
	})]),
});
const INSTALLED: InstalledLocalModel = Object.freeze({
	modelId: 'model-v1', version: '1', totalBytes: 42,
	artifacts: Object.freeze([Object.freeze({
		fileName: ARTIFACT.fileName, byteLength: ARTIFACT.byteLength, sha256: ARTIFACT.sha256,
	})]),
});

test('installed-model notices derive only bounded authenticated catalog and evidence fields', () => {
	const notices = createInstalledLocalModelNotices({
		catalog: CATALOG, licensingEvidence: [EVIDENCE], installed: [INSTALLED],
	});
	assert.deepEqual(notices, [Object.freeze({
		schemaVersion: 1,
		modelId: 'model-v1', version: '1', purpose: 'A test model for authenticated notices.',
		codeLicense: 'Apache-2.0', weightsLicense: 'CC-BY-4.0', attributionRequired: true,
		provenanceSources: Object.freeze(['https://models.invalid/model-v1']),
		upstreamRevision: 'revision-1', distributionKind: 'identity-mirrored',
		noticeDocument: 'THIRD_PARTY_LICENSES.md#mirrored-assistance-models',
	})]);
	assert.equal(Object.isFrozen(notices[0]?.provenanceSources), true);
});

test('pending Milestone 9 distribution review does not suppress authenticated notices', () => {
	const pendingEvidence = Object.freeze({
		...EVIDENCE,
		distributionStatus: 'blocked',
		blockedBy: Object.freeze(['weights-and-code-license-review']),
	});
	const pendingCatalog = Object.freeze({
		...CATALOG,
		entries: Object.freeze([Object.freeze({
			...CATALOG.entries[0]!,
			licensingEvidence: Object.freeze({
				id: 'model-v1', sha256: localModelEvidenceSha256(pendingEvidence),
			}),
		})]),
	});
	assert.equal(createInstalledLocalModelNotices({
		catalog: pendingCatalog, licensingEvidence: [pendingEvidence], installed: [INSTALLED],
	})[0]?.modelId, 'model-v1');
});

test('notice derivation refuses evidence changed after catalog authentication', () => {
	const changed = { ...EVIDENCE, purpose: 'Changed after signing.' };
	assert.throws(
		() => createInstalledLocalModelNotices({
			catalog: CATALOG, licensingEvidence: [changed], installed: [INSTALLED],
		}),
		/licensing evidence digest/iu,
	);
});

test('stale or altered installations cannot inherit a current catalog notice', () => {
	for (const installed of [
		{ ...INSTALLED, version: '0' },
		{ ...INSTALLED, artifacts: [{ ...INSTALLED.artifacts[0]!, sha256: 'b'.repeat(64) }] },
	]) {
		assert.throws(
			() => createInstalledLocalModelNotices({
				catalog: CATALOG, licensingEvidence: [EVIDENCE], installed: [installed],
			}),
			/does not match.*authenticated catalog/iu,
		);
	}
});

test('an installed model outside the current authenticated catalog is refused', () => {
	assert.throws(
		() => createInstalledLocalModelNotices({
			catalog: CATALOG,
			licensingEvidence: [EVIDENCE],
			installed: [{ ...INSTALLED, modelId: 'removed-model' }],
		}),
		/no authenticated catalog notice/iu,
	);
});
