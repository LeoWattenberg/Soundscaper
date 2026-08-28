/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	classifyProjectSchemaIdentity,
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_FAMILIES,
	PROJECT_SCHEMA_VERSION,
	ProjectReimportRequiredError,
	readProjectSchemaIdentity,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../src/common/editor/project-schema-identity.ts';

test('the 1.0 project identity is family-qualified and exact', () => {
	assert.equal(PROJECT_SCHEMA_VERSION, 1);
	assert.equal(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY, 'soundscaper');
	assert.equal(FRAMESCAPER_PROJECT_SCHEMA_FAMILY, 'framescaper');
	assert.deepEqual(PROJECT_SCHEMA_FAMILIES, ['soundscaper', 'framescaper']);
	assert.equal(Object.isFrozen(PROJECT_SCHEMA_FAMILIES), true);

	for (const schemaFamily of PROJECT_SCHEMA_FAMILIES) {
		const identity = readProjectSchemaIdentity({
			schemaFamily,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			id: 'project-1',
		});
		assert.deepEqual(identity, { schemaFamily, schemaVersion: 1 });
		assert.deepEqual(Object.keys(identity), ['schemaFamily', 'schemaVersion']);
		assert.equal(Object.isFrozen(identity), true);
	}
});

test('identity fields must be own enumerable data properties', () => {
	for (const field of ['schemaFamily', 'schemaVersion'] as const) {
		const accessor = {
			schemaFamily: 'soundscaper',
			schemaVersion: 1,
		};
		Object.defineProperty(accessor, field, {
			get: () => field === 'schemaFamily' ? 'soundscaper' : 1,
			enumerable: true,
		});
		assert.throws(() => readProjectSchemaIdentity(accessor), /own enumerable data property/iu);

		const hidden = {
			schemaFamily: 'soundscaper',
			schemaVersion: 1,
		};
		Object.defineProperty(hidden, field, { value: hidden[field], enumerable: false });
		assert.throws(() => readProjectSchemaIdentity(hidden), /own enumerable data property/iu);
	}

	const inherited = Object.create({ schemaFamily: 'soundscaper', schemaVersion: 1 });
	assert.throws(() => readProjectSchemaIdentity(inherited), /identity is incomplete/iu);
});

test('numeric-only pre-baseline documents require re-import', () => {
	for (const schemaVersion of [1, 17, 30, 31, 32]) {
		assert.throws(
			() => readProjectSchemaIdentity({ schemaVersion }),
			(error: unknown) => error instanceof ProjectReimportRequiredError
				&& error.code === 'REIMPORT_REQUIRED'
				&& error.schemaVersion === schemaVersion,
		);
	}
});

test('known foreign and future identities are classified without domain traversal', () => {
	const foreign = classifyProjectSchemaIdentity({
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		get tracks(): never { throw new Error('foreign domain was traversed'); },
	}, 'soundscaper');
	assert.deepEqual(foreign, {
		identity: { schemaFamily: 'framescaper', schemaVersion: 1 },
		disposition: 'foreign',
	});

	const future = classifyProjectSchemaIdentity({
		schemaFamily: 'soundscaper',
		schemaVersion: 2,
		get tracks(): never { throw new Error('future domain was traversed'); },
	}, 'soundscaper');
	assert.deepEqual(future, {
		identity: { schemaFamily: 'soundscaper', schemaVersion: 2 },
		disposition: 'future',
	});

	assert.deepEqual(classifyProjectSchemaIdentity({
		schemaFamily: 'soundscaper', schemaVersion: 1,
	}, 'soundscaper').disposition, 'current');
	assert.throws(() => readProjectSchemaIdentity({
		schemaFamily: 'unknown', schemaVersion: 1,
	}), /schema family/iu);
	for (const schemaVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
		assert.throws(() => readProjectSchemaIdentity({
			schemaFamily: 'soundscaper', schemaVersion,
		}), /positive safe integer/iu);
	}
});
