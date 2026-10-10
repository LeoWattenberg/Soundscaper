/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	classifyProjectSchemaIdentity, currentProjectSchemaVersion,
	isCurrentProjectSchemaIdentity, readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';

test('Motionscaper has its own current family without editorial authority', () => {
	const project = { schemaFamily: 'motionscaper', schemaVersion: 1 };
	assert.deepEqual(readProjectSchemaIdentity(project), project);
	assert.equal(isCurrentProjectSchemaIdentity(project, 'motionscaper'), true);
	assert.equal(classifyProjectSchemaIdentity(project, 'soundscaper').disposition, 'foreign');
	assert.equal(classifyProjectSchemaIdentity({ ...project, schemaVersion: 2 }, 'motionscaper').disposition, 'future');
	assert.equal(currentProjectSchemaVersion('motionscaper'), 1);
});

test('Framescaper successor is explicit and never upgrades the 1.0 baseline', () => {
	const baseline = { schemaFamily: 'framescaper', schemaVersion: 1 };
	const successor = { ...baseline, schemaVersion: 2 };
	assert.equal(currentProjectSchemaVersion('framescaper'), 1);
	assert.equal(currentProjectSchemaVersion('framescaper', 'successor'), 2);
	assert.equal(currentProjectSchemaVersion('soundscaper', 'successor'), 1);
	assert.equal(currentProjectSchemaVersion('motionscaper', 'successor'), 1);
	assert.equal(classifyProjectSchemaIdentity(successor, 'framescaper').disposition, 'future');
	assert.equal(classifyProjectSchemaIdentity(successor, 'framescaper', 'successor').disposition, 'current');
	assert.equal(classifyProjectSchemaIdentity(baseline, 'framescaper', 'successor').disposition, 'legacy');
	assert.equal(classifyProjectSchemaIdentity(baseline, 'motionscaper').disposition, 'foreign');
});

test('per-family classification rejects identity accessors without evaluating them', () => {
	let invoked = false;
	const candidate = Object.defineProperty({ schemaVersion: 1 }, 'schemaFamily', {
		enumerable: true, get: () => { invoked = true; return 'motionscaper'; },
	});
	assert.throws(() => readProjectSchemaIdentity(candidate), /data property/u);
	assert.equal(invoked, false);
	assert.throws(() => currentProjectSchemaVersion('unknown' as 'motionscaper'), /Unsupported/u);
});
