/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAssistanceSelectionFence } from '../src/common/editor/assistance/proposal-session.ts';
import { primitiveFence } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-admission.ts';
import { transferProjectProduct, listTransferProjects } from '../src/common/transfer/transfer-project-selection.ts';
import {
	crossProductHandoffSourceAuthorityRefusals, crossProductHandoffDestinationAuthorityRefusals,
} from '../src/common/transfer/cross-product-handoff-authority-preflight.ts';

test('motion identity never inherits editorial assistance or copy conversion authority', () => {
	const fence = {
		schemaFamily: 'motionscaper', schemaVersion: 1, projectId: 'project-1', revision: 0,
		sequenceId: 'comp-1', occurrenceIds: ['layer-1'], sourceId: 'asset-1',
		sourceSha256: '0'.repeat(64), sourceStartFrame: 0, sourceEndFrame: 10,
		linkMembershipSha256: '0'.repeat(64), timingAuthoritySha256: '0'.repeat(64),
	};
	assert.throws(() => validateAssistanceSelectionFence(fence), /family/u);
	assert.throws(() => primitiveFence(fence), /family/u);
	for (const preflight of [crossProductHandoffSourceAuthorityRefusals, crossProductHandoffDestinationAuthorityRefusals]) {
		assert.equal(preflight('motionscaper', {}).length, 1);
		assert.match(preflight('motionscaper', {})[0].reason, /composition link/u);
	}
});

test('legacy transfer pages retain motion identity as opaque and never preselect it', async () => {
	const project = { id: 'motion-1', title: 'Scene', schemaFamily: 'motionscaper', schemaVersion: 1 };
	assert.equal(transferProjectProduct(project), null);
	const offers = await listTransferProjects({ store: { listProjects: () => [project] }, product: 'framescaper' });
	assert.equal(offers[0].schemaFamily, 'motionscaper');
	assert.equal(offers[0].preselected, false);
	assert.equal(offers[0].product, null);
});
