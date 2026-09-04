/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CROSS_PRODUCT_HANDOFF_QUERY_PARAMETER,
	admitCrossProductHandoffLaunchIntent,
	createCrossProductHandoffLaunchIntent,
	parseCrossProductHandoffLaunchIntent,
	serializeCrossProductHandoffLaunchIntent,
} from '../src/common/cross-product-handoff-intent.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

// The handoff intent is the one record that crosses an origin boundary, so every
// refusal in it is load-bearing: a malformed or oversized intent must fail closed
// rather than reach the conversion. The happy path is covered by the editable-copy
// suites; this file is only the refusals.

const NOW = new Date('2026-01-01T00:00:00.000Z').getTime();

function validIntent() {
	return createCrossProductHandoffLaunchIntent({
		sourceProject: createSoundscaperProject({ id: 'source-project', now: NOW }),
		destinationFamily: 'framescaper',
		invocationId: 'invocation-1',
		destinationProjectId: 'framescaper-copy-1',
	});
}

test('minting an intent refuses options that are not a record', () => {
	for (const options of [null, undefined, 'handoff', 42]) {
		assert.throws(
			() => createCrossProductHandoffLaunchIntent(options as never),
			{ name: 'TypeError', message: /options must be a record/u },
		);
	}
});

test('minting an intent refuses a source that is not an exact family-v1 project', () => {
	const source = createSoundscaperProject({ id: 'source-project', now: NOW });
	assert.throws(
		() => createCrossProductHandoffLaunchIntent({
			sourceProject: { ...source, schemaVersion: 2 },
			destinationFamily: 'framescaper',
		}),
		{ name: 'RangeError', message: /exact family-v1 source/u },
	);
});

test('minting an intent refuses an unsupported or identical destination family', () => {
	const sourceProject = createSoundscaperProject({ id: 'source-project', now: NOW });
	assert.throws(
		() => createCrossProductHandoffLaunchIntent({ sourceProject, destinationFamily: 'lightscaper' as never }),
		{ name: 'RangeError', message: /destination schemaFamily is unsupported/u },
	);
	assert.throws(
		() => createCrossProductHandoffLaunchIntent({ sourceProject, destinationFamily: 'soundscaper' }),
		{ name: 'RangeError', message: /different product family/u },
	);
});

test('an admitted intent refuses an unknown kind or version', () => {
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent({ ...validIntent(), kind: 'other-handoff' }),
		{ name: 'RangeError', message: /Unsupported cross-product handoff kind/u },
	);
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent({ ...validIntent(), version: 2 }),
		{ name: 'RangeError', message: /Unsupported cross-product handoff version/u },
	);
});

test('an admitted intent refuses a project ref that is not family v1', () => {
	const intent = validIntent();
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent({
			...intent,
			source: { ...intent.source, schemaFamily: 'lightscaper' },
		}),
		{ name: 'RangeError', message: /source schemaFamily is unsupported/u },
	);
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent({
			...intent,
			destination: { ...intent.destination, schemaVersion: 2 },
		}),
		{ name: 'RangeError', message: /destination schemaVersion must be family v1/u },
	);
});

test('an admitted intent refuses records that are not closed plain data', () => {
	const intent = validIntent();
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent({ ...intent, extra: true }),
		{ name: 'TypeError', message: /unsupported field extra/u },
	);
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent(Object.defineProperty({ ...intent }, 'invocationId', {
			enumerable: true,
			get: () => 'invocation-1',
		})),
		{ name: 'TypeError', message: /invocationId must be an own enumerable data property/u },
	);
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent(Object.assign(Object.create({ inherited: true }), intent)),
		{ name: 'TypeError', message: /must be a plain record/u },
	);
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent([intent]),
		{ name: 'TypeError', message: /must be a plain record/u },
	);
});

test('parsing refuses a query that does not carry exactly one handoff parameter', () => {
	const serialized = serializeCrossProductHandoffLaunchIntent(validIntent());
	assert.equal(parseCrossProductHandoffLaunchIntent('other=1'), null);
	assert.throws(
		() => parseCrossProductHandoffLaunchIntent(`${serialized}&other=1`),
		{ name: 'TypeError', message: /exactly one handoff parameter/u },
	);
	assert.throws(
		() => parseCrossProductHandoffLaunchIntent(`${serialized}&${serialized}`),
		{ name: 'TypeError', message: /exactly one handoff parameter/u },
	);
});

test('parsing refuses a value that is not valid JSON', () => {
	const parameters = new URLSearchParams();
	parameters.set(CROSS_PRODUCT_HANDOFF_QUERY_PARAMETER, '{not json');
	assert.throws(
		() => parseCrossProductHandoffLaunchIntent(parameters),
		{ name: 'SyntaxError', message: /not valid JSON/u },
	);
});

test('parsing refuses a query over its URL budget, and one over its JSON budget', () => {
	const oversizeQuery = new URLSearchParams();
	oversizeQuery.set(CROSS_PRODUCT_HANDOFF_QUERY_PARAMETER, 'x'.repeat(20 * 1024));
	assert.throws(
		() => parseCrossProductHandoffLaunchIntent(oversizeQuery),
		{ name: 'RangeError', message: /query exceeds its URL budget/u },
	);

	// Under the query budget once escaped, but over the value budget inside it.
	const oversizeValue = new URLSearchParams();
	oversizeValue.set(CROSS_PRODUCT_HANDOFF_QUERY_PARAMETER, 'x'.repeat(5 * 1024));
	assert.throws(
		() => parseCrossProductHandoffLaunchIntent(oversizeValue),
		{ name: 'RangeError', message: /value exceeds its JSON budget/u },
	);
});

test('a leading question mark and a round trip through the query are both accepted', () => {
	const intent = validIntent();
	const serialized = serializeCrossProductHandoffLaunchIntent(intent);
	assert.deepEqual(parseCrossProductHandoffLaunchIntent(`?${serialized}`), intent);
	assert.deepEqual(parseCrossProductHandoffLaunchIntent(new URLSearchParams(serialized)), intent);
});

test('an intent mints its own ids when the caller supplies none', () => {
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: createSoundscaperProject({ id: 'source-project', now: NOW }),
		destinationFamily: 'framescaper',
	});
	assert.match(intent.invocationId, /^handoff-/u);
	assert.match(intent.destination.projectId, /^framescaper-copy-/u);
	assert.notEqual(intent.source.projectId, intent.destination.projectId);
	// Minted ids are admissible, so a retry can reuse the serialized value.
	assert.deepEqual(admitCrossProductHandoffLaunchIntent({ ...intent }), intent);
});

test('an admitted intent refuses a destination that reuses the source project id', () => {
	const intent = validIntent();
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent({
			...intent,
			destination: { ...intent.destination, projectId: intent.source.projectId },
		}),
		{ name: 'RangeError', message: /separately identified destination project id/u },
	);
});

test('an admitted intent names a missing field rather than an unsupported one', () => {
	const { sourceRevision: _omitted, ...withoutRevision } = validIntent();
	assert.throws(
		() => admitCrossProductHandoffLaunchIntent(withoutRevision),
		{ name: 'TypeError', message: /unsupported field \(missing\)/u },
	);
});

