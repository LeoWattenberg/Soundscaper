/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHelperResourcePolicy } from '../desktop/helper-contract.ts';
import { admitLowerOnly } from '../src/common/editor/lower-only-seam.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	PROJECT_FEATURE_AFFECTED_OBJECT_LIMITS,
	projectFeatureAffectedObjects,
} from '../src/common/editor/project-feature-affected-objects.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const REFUSALS: string[] = [];

function seam(overrides: Partial<Parameters<typeof admitLowerOnly>[1]> = {}) {
	return {
		ceiling: 10,
		floor: 1,
		absent: 'ceiling' as const,
		refuse: (refusal: 'shape' | 'ceiling') => {
			REFUSALS.push(refusal);
			return new RangeError(refusal);
		},
		...overrides,
	};
}

test('a lower-only seam admits its floor, its ceiling and everything between', () => {
	assert.equal(admitLowerOnly(1, seam()), 1);
	assert.equal(admitLowerOnly(7, seam()), 7);
	assert.equal(admitLowerOnly(10, seam()), 10);
	assert.equal(admitLowerOnly(0, seam({ floor: 0 })), 0);
});

test('a lower-only seam refuses values below its floor as a shape refusal', () => {
	REFUSALS.length = 0;
	assert.throws(() => admitLowerOnly(0, seam()), RangeError);
	assert.throws(() => admitLowerOnly(-1, seam()), RangeError);
	assert.throws(() => admitLowerOnly(-1, seam({ floor: 0 })), RangeError);
	assert.deepEqual(REFUSALS, ['shape', 'shape', 'shape']);
});

test('a lower-only seam refuses values above its ceiling as a ceiling refusal', () => {
	REFUSALS.length = 0;
	assert.throws(() => admitLowerOnly(11, seam()), RangeError);
	assert.throws(() => admitLowerOnly(Number.MAX_SAFE_INTEGER, seam()), RangeError);
	assert.deepEqual(REFUSALS, ['ceiling', 'ceiling']);
});

test('a lower-only seam refuses non-integer and non-finite values as shape refusals', () => {
	REFUSALS.length = 0;
	for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 2, '5', null, true, 5n, {}, [], () => 5]) {
		assert.throws(() => admitLowerOnly(value, seam()), RangeError);
	}
	assert.deepEqual(REFUSALS, Array.from({ length: 12 }, () => 'shape'));
});

test('an absent value takes the ceiling only when the seam defaults to it', () => {
	REFUSALS.length = 0;
	assert.equal(admitLowerOnly(undefined, seam()), 10);
	assert.throws(() => admitLowerOnly(undefined, seam({ absent: 'refuse' })), RangeError);
	assert.deepEqual(REFUSALS, ['shape']);
});

test('a lower-only seam throws exactly the error its refusal builds', () => {
	const marker = new TypeError('bespoke refusal');
	assert.throws(() => admitLowerOnly(99, { ceiling: 1, floor: 1, absent: 'refuse', refuse: () => marker }),
		(error: unknown) => error === marker);
});

test('the helper resource seam keeps a floor of one and defaults to the hard maximum', () => {
	assert.equal(normalizeHelperResourcePolicy({ maximumRssBytes: 1 }).maximumRssBytes, 1);
	assert.throws(() => normalizeHelperResourcePolicy({ maximumRssBytes: 0 }),
		/Helper peak RSS must be a lower-only safe integer no greater than \d+\.$/u);
	assert.throws(() => normalizeHelperResourcePolicy({ maximumRssBytes: -1 }),
		/Helper peak RSS must be a lower-only safe integer/u);
	assert.equal(normalizeHelperResourcePolicy({ maximumRssBytes: undefined }).maximumRssBytes,
		normalizeHelperResourcePolicy().maximumRssBytes);
});

test('the affected-object seam keeps a floor of zero and its two distinct refusals', () => {
	const admitted = projectFeatureAffectedObjects(affectedProject(), affectedReport(), {
		maximumAffectedObjects: 0,
	});
	assert.ok(admitted);
	assert.equal(admitted.requirements[0]?.objects.length, 0);
	assert.throws(() => projectFeatureAffectedObjects(affectedProject(), affectedReport(), {
		maximumAffectedObjects: -1,
	}), /^RangeError: maximumAffectedObjects must be a non-negative safe integer\.$/u);
	assert.throws(() => projectFeatureAffectedObjects(affectedProject(), affectedReport(), {
		maximumAffectedObjects: PROJECT_FEATURE_AFFECTED_OBJECT_LIMITS.maximumAffectedObjects + 1,
	}), /^RangeError: maximumAffectedObjects cannot raise the production limit\.$/u);
});

function affectedReport(): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 1, unknown: 0 },
		items: [{
			requirementId: 'requirement-a',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			displayName: 'Audio effects',
			availability: 'unavailable',
			declaredDisposition: 'bypass',
			disposition: 'bypassed',
			fallback: null,
			message: 'Audio effects are unavailable.',
		}],
	};
}

function affectedProject(): Record<string, unknown> {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: 'project',
		tracks: [{
			id: 'track-a',
			type: 'audio',
			effectsActive: true,
			effects: [{ id: 'effect-foreign', type: 'com.example.saturator', enabled: true, params: {} }],
		}],
		clips: [],
		projectBin: { clips: [] },
	};
}
