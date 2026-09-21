/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { visitFramescaperRetimeClipCollections } from
	'../src/framescaper/editor-project-retime-clip-collections.ts';

type DataRecord = Record<string, unknown>;

const accessors = {
	record: (value: unknown, name: string): DataRecord => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`${name} must be an object.`);
		}
		return value as DataRecord;
	},
	dataProperty: (value: DataRecord, key: string, name: string): unknown => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		return descriptor.value;
	},
};

test('retime walker visits timeline then Project Bin clips with exact names and scopes', () => {
	const visited: Array<[string, string, string]> = [];
	visitFramescaperRetimeClipCollections({
		clips: [{ id: 'timeline-a' }, { id: 'timeline-b' }],
		projectBin: { clips: [{ id: 'bin-a' }] },
	}, (clip, name, scope) => {
		visited.push([String(clip.id), name, scope]);
	}, accessors);
	assert.deepEqual(visited, [
		['timeline-a', 'Framescaper retime project.clips[0]', 'timeline'],
		['timeline-b', 'Framescaper retime project.clips[1]', 'timeline'],
		['bin-a', 'Framescaper retime project.projectBin.clips[0]', 'project-bin'],
	]);
});

test('retime walker rejects sparse and accessor clip slots before visiting them', () => {
	const sparse: unknown[] = [];
	sparse.length = 1;
	assert.throws(() => visitFramescaperRetimeClipCollections({
		clips: sparse, projectBin: { clips: [] },
	}, () => {}, accessors), {
		message: 'Framescaper retime project.clips[0] must be an own enumerable data property.',
	});
	const accessor = [{ id: 'clip-a' }];
	Object.defineProperty(accessor, '0', { enumerable: true, get: () => ({ id: 'read' }) });
	assert.throws(() => visitFramescaperRetimeClipCollections({
		clips: accessor, projectBin: { clips: [] },
	}, () => {}, accessors), {
		message: 'Framescaper retime project.clips[0] must be an own enumerable data property.',
	});
});

test('retime walker delegates record admission and preserves its exact errors', () => {
	assert.throws(() => visitFramescaperRetimeClipCollections({
		clips: [null], projectBin: { clips: [] },
	}, () => {}, accessors), {
		message: 'Framescaper retime project.clips[0] must be an object.',
	});
	assert.throws(() => visitFramescaperRetimeClipCollections({
		clips: [], projectBin: { clips: 'invalid' },
	}, () => {}, accessors), {
		message: 'Framescaper retime project.projectBin.clips must be an array.',
	});
});
