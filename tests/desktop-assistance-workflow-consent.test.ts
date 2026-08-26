/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_WORKFLOW_CONSENT_TTL_MS,
	createAssistanceWorkflowConsentAuthority,
} from '../desktop/assistance-workflow-consent.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

test('a workflow consent grant is owner-bound, expiring, exact, and one-shot', () => {
	const now = 1_000;
	let identity = 0;
	const authority = createAssistanceWorkflowConsentAuthority({
		now: () => now,
		mintGrantId: () => (++identity).toString(16).padStart(40, '0'),
	});
	const owner = {};
	const request = assistanceWorkflowFixture();
	const grant = authority.issue(owner, request);

	assert.deepEqual(grant, {
		grantVersion: 1,
		grantId: '1'.padStart(40, '0'),
		jobId: request.jobId,
		workflowId: request.workflowId,
		expiresAtMs: now + ASSISTANCE_WORKFLOW_CONSENT_TTL_MS,
	});
	assert.doesNotMatch(JSON.stringify(grant), /source|model|occurrence/iu,
		'the public token does not disclose or become the consent binding');
	assert.equal(authority.consume({}, grant, request), false, 'another renderer cannot consume the grant');
	assert.equal(authority.consume(owner, grant, request), false, 'a failed consume attempt exhausts the token');

	const exact = authority.issue(owner, request);
	assert.equal(authority.consume(owner, exact, request), true);
	assert.equal(authority.consume(owner, exact, request), false, 'consent cannot authorize a second run');
});

test('changed fences, stages, models, settings, or expiry invalidate consent before execution', () => {
	let now = 5_000;
	let identity = 10;
	const authority = createAssistanceWorkflowConsentAuthority({
		now: () => now,
		mintGrantId: () => (++identity).toString(16).padStart(40, '0'),
	});
	const owner = {};
	const original = assistanceWorkflowFixture();
	const changes = [
		assistanceWorkflowFixture({ fence: { ...original.fence, revision: original.fence.revision + 1 } }),
		assistanceWorkflowFixture({ stageIds: [...original.stageIds, 'align-words'] }),
		assistanceWorkflowFixture({ models: original.models.map((model, index) => index === 0
			? { ...model, version: '6.2.1' }
			: model) }),
		assistanceWorkflowFixture({ settingsVersion: 2 }),
	];
	for (const changed of changes) {
		const grant = authority.issue(owner, original);
		assert.equal(authority.consume(owner, grant, changed), false);
	}
	const expired = authority.issue(owner, original);
	now = expired.expiresAtMs;
	assert.equal(authority.consume(owner, expired, original), false);
	authority.dispose();
	assert.throws(() => authority.issue(owner, original), /disposed/iu);
});
