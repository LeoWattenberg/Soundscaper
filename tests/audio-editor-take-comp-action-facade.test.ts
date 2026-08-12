/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTakeCompActionFacade } from '../src/common/editor/controller/take-comp-action-facade.ts';

test('take comp facade exposes every persistent and audition operation behind one capability', () => {
	const calls: Array<readonly [string, ...unknown[]]> = [];
	const service = new Proxy<Record<string, (...args: unknown[]) => unknown>>({}, {
		get(_target, name) {
			return (...args: unknown[]) => {
				calls.push([String(name), ...args]);
				return name;
			};
		},
	});
	const actions = createTakeCompActionFacade({
		enabled: true,
		productName: 'Soundscaper',
		service,
	});
	const requests: Readonly<Record<string, readonly unknown[]>> = {
		createGroup: [{ id: 'group' }],
		updateGroup: ['group', { id: 'group' }],
		removeGroup: ['group'],
		auditionTake: ['group', 'take'],
		auditionLane: ['group', 'lane'],
		stopAudition: [],
		promoteTake: ['group', { takeId: 'take' }],
		editCompBoundary: ['group', { regionId: 'region' }],
		editSharedCompBoundary: ['group', { leftRegionId: 'left' }],
		flatten: ['group'],
	};
	for (const [name, args] of Object.entries(requests)) {
		const action = actions[name as keyof typeof actions];
		action(...args);
	}
	assert.deepEqual(calls, Object.entries(requests).map(([name, args]) => [name, ...args]));

	const blocked = createTakeCompActionFacade({
		enabled: false,
		productName: 'Framescaper',
		service,
	});
	assert.throws(() => blocked.flatten('group'), /does not support takeComp/u);
});
