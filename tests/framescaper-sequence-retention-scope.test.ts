/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_SEQUENCE_RETENTION_LIMITS as LIMITS,
	collectFramescaperProjectStorageRootsSequence as collectRoots,
} from '../src/framescaper/editor-project-sequence-retention.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectSequence(PROFILE, {} as never) as unknown as Data;
}

function scope(overrides: Data = {}): Data {
	return {
		currentProject: project(),
		retainedRevisions: [],
		histories: [],
		pendingSaveSnapshots: [],
		claims: [],
		...overrides,
	};
}

function collect(scopeValue: unknown, limits?: unknown): readonly string[] {
	return collectRoots(PROFILE, scopeValue as never, limits as never);
}

test('the retention limits are published as a frozen pair of bounds', () => {
	assert.deepEqual(Object.keys(LIMITS), ['maximumInputs', 'maximumRoots']);
	assert.ok(Number.isSafeInteger(LIMITS.maximumInputs) && LIMITS.maximumInputs > 0);
	assert.ok(Number.isSafeInteger(LIMITS.maximumRoots) && LIMITS.maximumRoots > 0);
	assert.ok(Object.isFrozen(LIMITS));
});

test('root collection requires the exact sequence runtime profile', () => {
	assert.throws(
		() => collectRoots({}, scope() as never),
		/exact Framescaper sequence runtime profile is required/u,
	);
});

test('a retention scope is a closed record of exactly its five fields', () => {
	assert.throws(() => collect({ ...scope(), extra: 1 }), /unsupported, missing, or extra/u);
	assert.throws(() => collect({ currentProject: project() }), /unsupported, missing, or extra/u);
	assert.throws(() => collect(null), TypeError);
});

test('every retention collection must be a dense array', () => {
	const sparse: unknown[] = [];
	sparse.length = 2;

	assert.throws(
		() => collect(scope({ retainedRevisions: sparse })),
		/must be an own enumerable data property/u,
	);
});

test('a retained revision is a closed record of its revision and project', () => {
	assert.throws(
		() => collect(scope({ retainedRevisions: [{ revision: 0 }] })),
		/retained revision has unsupported, missing, or extra/u,
	);
});

test('a video proxy claim must carry enumerable data fields', () => {
	assert.throws(
		() => collect(scope({ claims: [{ bodyKey: `video-proxy-sha256:${'ab'.repeat(32)}` }] })),
		/claim requires enumerable data fields/u,
	);
});

test('the aggregate input and root bounds must both be positive', () => {
	assert.throws(
		() => collect(scope(), { maximumInputs: 0 }),
		/aggregate inputs limit must be a positive bounded/u,
	);
	assert.throws(
		() => collect(scope(), { maximumRoots: 0 }),
		/storage roots limit must be a positive bounded/u,
	);
	assert.throws(
		() => collect(scope(), { maximumRoots: -1 }),
		/storage roots limit must be a positive bounded/u,
	);
});

test('no caller-owned target is accepted, so a refusal exposes no partial result', () => {
	assert.throws(
		() => collectRoots(PROFILE, scope() as never, { maximumRoots: 0 } as never),
		(error: unknown) => {
			assert.ok(error instanceof RangeError);
			return true;
		},
	);
});
