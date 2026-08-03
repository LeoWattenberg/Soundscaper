/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	linkedOriginalTransientBindingReferenceFromBindResult,
	normalizeLinkedOriginalTransientBindingReference,
} from '../src/common/editor/storage/linked-original-transient-binding-reference.ts';

const PROJECT_ID = 'transient-binding-project';
const SOURCE_ID = 'transient-binding-source';
const BINDING_TOKEN = 'binding_token_00000001';

test('transient linked-original references are closed exact binding generations', () => {
	const reference = normalizeLinkedOriginalTransientBindingReference({
		kind: 'audio',
		sourceId: SOURCE_ID,
		bindingToken: BINDING_TOKEN,
	});

	assert.deepEqual(reference, {
		kind: 'audio',
		sourceId: SOURCE_ID,
		bindingToken: BINDING_TOKEN,
	});
	assert.equal(Object.isFrozen(reference), true);
	assert.throws(
		() => normalizeLinkedOriginalTransientBindingReference({ ...reference, projectId: PROJECT_ID }),
		/unsupported field/iu,
	);
	assert.throws(
		() => normalizeLinkedOriginalTransientBindingReference({ ...reference, kind: 'image' }),
		/kind/iu,
	);
	assert.throws(
		() => normalizeLinkedOriginalTransientBindingReference({ ...reference, bindingToken: 'stale' }),
		/token/iu,
	);
	const accessor = { ...reference } as Record<string, unknown>;
	Object.defineProperty(accessor, 'sourceId', { enumerable: true, get: () => SOURCE_ID });
	assert.throws(
		() => normalizeLinkedOriginalTransientBindingReference(accessor),
		/data field/iu,
	);
});

test('bind-result admission extracts exact own data fields and matches the lifecycle call', () => {
	const admitted = linkedOriginalTransientBindingReferenceFromBindResult(
		PROJECT_ID,
		{ kind: 'video', sourceId: SOURCE_ID },
		{
			projectId: PROJECT_ID,
			sourceId: SOURCE_ID,
			bindingToken: BINDING_TOKEN,
			schemaVersion: 1,
		},
	);
	assert.deepEqual(admitted, {
		kind: 'video',
		sourceId: SOURCE_ID,
		bindingToken: BINDING_TOKEN,
	});

	for (const result of [
		{ projectId: 'other-project', sourceId: SOURCE_ID, bindingToken: BINDING_TOKEN },
		{ projectId: PROJECT_ID, sourceId: 'other-source', bindingToken: BINDING_TOKEN },
		{ projectId: PROJECT_ID, sourceId: SOURCE_ID, bindingToken: 'stale' },
		{ projectId: PROJECT_ID, sourceId: SOURCE_ID },
	]) {
		assert.throws(
			() => linkedOriginalTransientBindingReferenceFromBindResult(
				PROJECT_ID,
				{ kind: 'video', sourceId: SOURCE_ID },
				result,
			),
			/project|source|token|data field/iu,
		);
	}

	const accessor = { projectId: PROJECT_ID, sourceId: SOURCE_ID } as Record<string, unknown>;
	Object.defineProperty(accessor, 'bindingToken', { enumerable: true, get: () => BINDING_TOKEN });
	assert.throws(
		() => linkedOriginalTransientBindingReferenceFromBindResult(
			PROJECT_ID,
			{ kind: 'video', sourceId: SOURCE_ID },
			accessor,
		),
		/data field/iu,
	);
});
