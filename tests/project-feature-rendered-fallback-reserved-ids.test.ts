/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertProjectFeatureRenderedFallbackReservedIdsAvailable } from
	'../src/common/editor/project-feature-rendered-fallback-reserved-ids.ts';

type RecordValue = Readonly<Record<string, unknown>>;

const accessors = {
	dataProperty: (value: RecordValue, key: string, name: string): unknown => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		return descriptor.value;
	},
	arrayValue: (value: unknown, name: string): readonly unknown[] => {
		if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
		return value;
	},
	recordValue: (value: unknown, name: string): RecordValue => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`${name} must be an object.`);
		}
		return value as RecordValue;
	},
	isRecord: (value: unknown): value is RecordValue => (
		Boolean(value) && typeof value === 'object' && !Array.isArray(value)
	),
};

test('reserved fallback IDs reject exact track, clip, and Project Bin collisions for either role', () => {
	for (const ids of [
		{ track: 'audio-track', clip: 'audio-clip' },
		{ track: 'video-track', clip: 'video-clip' },
	]) {
		const project = { tracks: [{ id: 'other' }], clips: [{ id: 'other' }], projectBin: { clips: [] } };
		assert.doesNotThrow(() => assertProjectFeatureRenderedFallbackReservedIdsAvailable(project, ids, accessors));
		assert.throws(() => assertProjectFeatureRenderedFallbackReservedIdsAvailable({
			...project, tracks: [{ id: ids.track }],
		}, ids, accessors), { message: 'The reserved rendered-fallback track ID collides with project state.' });
		assert.throws(() => assertProjectFeatureRenderedFallbackReservedIdsAvailable({
			...project, clips: [{ id: ids.clip }],
		}, ids, accessors), { message: 'The reserved rendered-fallback clip ID collides with project state.' });
		assert.throws(() => assertProjectFeatureRenderedFallbackReservedIdsAvailable({
			...project, projectBin: { clips: [{ id: ids.clip }] },
		}, ids, accessors), { message: 'The reserved rendered-fallback clip ID collides with Project Bin state.' });
	}
});

test('the owner accessor retains its own data-property refusal wording', () => {
	assert.throws(() => assertProjectFeatureRenderedFallbackReservedIdsAvailable({
		tracks: [], clips: [], projectBin: {},
	}, { track: 't', clip: 'c' }, accessors), {
		message: 'project.projectBin.clips must be an own enumerable data property.',
	});
});
