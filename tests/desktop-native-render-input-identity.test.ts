/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sameNativeRenderInputStageIdentity } from '../desktop/native-services-render-input-contract.ts';

test('render-input identity binds schema, plan, project and ordered original fingerprints', () => {
	const identity = {
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		planFingerprint: 'a'.repeat(64), projectId: 'project-1', projectRevision: 2,
		inputFingerprints: [{ sourceId: 'source-1', sha256: 'b'.repeat(64) }],
	};
	assert.equal(sameNativeRenderInputStageIdentity(identity, { ...identity, inputFingerprints: [...identity.inputFingerprints] }), true);
	for (const changed of [
		{ ...identity, schemaVersion: 2 as 1 },
		{ ...identity, planFingerprint: 'c'.repeat(64) },
		{ ...identity, projectId: 'other' },
		{ ...identity, projectRevision: 3 },
		{ ...identity, inputFingerprints: [] },
	]) assert.equal(sameNativeRenderInputStageIdentity(identity, changed), false);
});
