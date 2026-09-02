/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HelperSupervisionError,
	type HelperFailureCause,
} from '../desktop/helper-supervisor.ts';
import { framescaperOpenFxFailureKind } from '../desktop/openfx-main-service-authority.ts';

test('OpenFX failure classification admits only per-plug-in runtime faults', () => {
	const runtimeFailures = [
		['heartbeat', 'hang'],
		['cancellation-timeout', 'hang'],
		['helper-exit', 'crash'],
		['resource-violation', 'resource-violation'],
		['malformed-message', 'resource-violation'],
		['job-mismatch', 'resource-violation'],
	] as const;
	for (const [cause, expected] of runtimeFailures) {
		assert.equal(framescaperOpenFxFailureKind(
			new HelperSupervisionError(cause, `${cause} failure`),
		), expected, cause);
	}
	assert.equal(framescaperOpenFxFailureKind(new Error('plug-in render failed')), 'render-error');
});

test('OpenFX host-control failures carry no plug-in failure classification', () => {
	const hostFailures = [
		'binary-mismatch', 'handshake', 'invalid-request', 'capacity', 'unsupported-kind',
		'helper-error', 'cancelled', 'quarantined', 'disposed',
	] satisfies readonly HelperFailureCause[];
	for (const cause of hostFailures) {
		assert.equal(framescaperOpenFxFailureKind(
			new HelperSupervisionError(cause, `${cause} failure`),
		), null, cause);
	}
	assert.equal(framescaperOpenFxFailureKind({ cause_: 'future-host-failure' }), null);
});
