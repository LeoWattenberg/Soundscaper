/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertFramescaperNativeWatchProjection,
	assertFramescaperNativeWatchTarget,
	framescaperNativeWatchProjection,
} from '../desktop/native-services-watch-controller-contract.ts';
import { createWatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';

test('selected V28 controller contract admits only its exact target bin and optional proxy choice', () => {
	assert.doesNotThrow(() => assertFramescaperNativeWatchTarget({
		open: true, writable: true, schemaVersion: 28, binId: 'project-bin',
	}, { binId: 'project-bin', generateProxies: true }));
	for (const target of [
		{ binId: null, generateProxies: true },
		{ binId: 'other-bin', generateProxies: false },
	] as const) {
		assert.throws(() => assertFramescaperNativeWatchTarget({
			open: true, writable: true, schemaVersion: 28, binId: 'project-bin',
		}, target), /exact writable project bin/iu);
	}
});

test('historical watch contracts remain null-bin, proxy-off and projections expose no path', () => {
	assert.throws(() => assertFramescaperNativeWatchTarget({ open: true, writable: true }, {
		binId: null, generateProxies: true,
	}), /V20.*proxy/iu);
	const projection = framescaperNativeWatchProjection(createWatchRuleV1({
		ruleId: '12'.repeat(16), grantId: '34'.repeat(16), projectId: 'project-20',
		extensions: ['mov'], createdAtMs: 0,
	}));
	assert.equal(projection.binId, null);
	assert.equal(JSON.stringify(projection).includes('/private'), false);
	assert.doesNotThrow(() => assertFramescaperNativeWatchProjection(projection));
	assert.throws(() => assertFramescaperNativeWatchProjection({
		...projection, path: '/private/watch',
	}), /unsupported fields/iu);
});
