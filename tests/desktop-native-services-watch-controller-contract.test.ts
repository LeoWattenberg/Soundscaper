/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertFramescaperNativeWatchProjection,
	assertFramescaperNativeWatchTarget,
	framescaperNativeWatchProjection,
} from '../desktop/native-services-watch-controller-contract.ts';
import { createWatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';

const PROJECT_STATE = Object.freeze({
	schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
	open: true, writable: true, binId: 'project-bin',
});

test('Framescaper v1 watch contract admits only its exact current project bin', () => {
	assert.doesNotThrow(() => assertFramescaperNativeWatchTarget(
		PROJECT_STATE, { binId: 'project-bin', generateProxies: true },
	));
	for (const target of [
		{ binId: null, generateProxies: true },
		{ binId: 'other-bin', generateProxies: false },
	] as const) {
		assert.throws(() => assertFramescaperNativeWatchTarget(
			PROJECT_STATE, target,
		), /exact v1 writable project bin/iu);
	}
	assert.throws(() => assertFramescaperNativeWatchTarget({
		...PROJECT_STATE, schemaFamily: 'soundscaper' as never,
	}, { binId: 'project-bin', generateProxies: false }), /exact v1/iu);
});

test('Framescaper v1 watch projections carry identity and expose no path', () => {
	const projection = framescaperNativeWatchProjection(createWatchRuleV1({
		schemaFamily: 'framescaper', schemaVersion: 1,
		ruleId: '12'.repeat(16), grantId: '34'.repeat(16), projectId: 'project-1',
		binId: 'project-bin', extensions: ['mov'], createdAtMs: 0,
	}));
	assert.deepEqual({
		schemaFamily: projection.schemaFamily,
		schemaVersion: projection.schemaVersion,
		binId: projection.binId,
	}, { schemaFamily: 'framescaper', schemaVersion: 1, binId: 'project-bin' });
	assert.equal(JSON.stringify(projection).includes('/private'), false);
	assert.doesNotThrow(() => assertFramescaperNativeWatchProjection(projection));
	assert.throws(() => assertFramescaperNativeWatchProjection({
		...projection, path: '/private/watch',
	}), /unsupported fields/iu);
});
