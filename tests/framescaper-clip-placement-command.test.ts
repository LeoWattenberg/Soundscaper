/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readClosedDomainField } from '../src/common/editor/closed-domain-value.ts';
import { snapshotOptionalClipPlacement } from '../src/framescaper/editor-clip-placement-command.ts';

const labels = {
	placement: 'example placement',
	projectBin: 'example Project Bin placement',
	timeline: 'example timeline placement',
	unsupported: 'example placement scope is unsupported.',
	trackIdName: 'placement.trackId',
	field: (value: Readonly<Record<string, unknown>>, name: string) => (
		readClosedDomainField(value, name, 'example command')
	),
	stableId: (value: unknown, name: string) => {
		if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
			throw new TypeError(`example ${name} must be a stable ID.`);
		}
		return value;
	},
} as const;

test('clip placement snapshots nullable Project Bin and timeline values exactly', () => {
	assert.equal(snapshotOptionalClipPlacement(null, labels), null);
	const bin = snapshotOptionalClipPlacement({ scope: 'project-bin' }, labels);
	assert.deepEqual(bin, { scope: 'project-bin' });
	assert.ok(Object.isFrozen(bin));
	const timeline = snapshotOptionalClipPlacement({ scope: 'timeline', trackId: 'video:1' }, labels);
	assert.deepEqual(timeline, { scope: 'timeline', trackId: 'video:1' });
	assert.ok(Object.isFrozen(timeline));
});

test('clip placement admits only closed own-data scope and a stable timeline track', () => {
	assert.throws(() => snapshotOptionalClipPlacement(undefined, labels), /example placement.*plain object/u);
	assert.throws(() => snapshotOptionalClipPlacement({ scope: 'project-bin', trackId: 'v1' }, labels),
		/example Project Bin placement/u);
	assert.throws(() => snapshotOptionalClipPlacement({ scope: 'timeline' }, labels),
		/example timeline placement/u);
	assert.throws(() => snapshotOptionalClipPlacement({ scope: 'timeline', trackId: 'bad id' }, labels),
		/example placement\.trackId must be a stable ID/u);
	assert.throws(() => snapshotOptionalClipPlacement({ scope: 'other' }, labels),
		/example placement scope is unsupported/u);
	const accessor = Object.defineProperty({}, 'scope', { enumerable: true, get() {
		throw new Error('must not call accessor');
	} });
	assert.throws(() => snapshotOptionalClipPlacement(accessor, labels), /example placement/u);
});
