/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperOpenFxCurrentProjectAuthority,
	createFramescaperOpenFxFrameRegistration,
} from '../desktop/framescaper-openfx-frame-registration.mjs';

test('an unavailable project authority keeps OpenFX current-project checks fail closed', async () => {
	const currentProject = createFramescaperOpenFxCurrentProjectAuthority(null);
	assert.equal(await currentProject({
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1', revision: 1,
	}), false);
	assert.equal(await currentProject(null), false);
});

test('frame registration forwards exact effect identity into current-project authority', async () => {
	let executionPorts;
	const currentEffect = Object.freeze({ instanceId: 'effect-1', pluginId: 'net.example.Filter' });
	const plan = Object.freeze({ project: { id: 'project-1', revision: 7 } });
	const observed = [];
	const registration = await createFramescaperOpenFxFrameRegistration({
		openFxService: {
			inventory: () => [], qualifiedGpuBackends: () => [], execute: async () => ({ mode: 'bypass' }),
		},
		projectBodyAuthority: { openFxTimingAssets: async () => [] },
		createMessageChannel: () => ({}), mintOpaqueId: () => 'ab'.repeat(20),
		currentProject: async (candidate, effect) => {
			observed.push([candidate, effect]);
			return candidate === plan && effect === currentEffect;
		},
	}, { modules: [{
		createFramescaperOpenFxFrameExecutionService(ports) {
			executionPorts = ports;
			return Object.freeze({ execute: async () => ({ mode: 'bypass' }) });
		},
	}, {
		createFramescaperOpenFxFramePortBroker: () => Object.freeze({ kind: 'broker' }),
	}] });
	assert.deepEqual(registration, { kind: 'broker' });
	assert.equal(await executionPorts.currentProject(plan, currentEffect), true);
	assert.equal(await executionPorts.currentProject(plan, { ...currentEffect, pluginId: 'forged' }), false);
	assert.deepEqual(observed, [
		[plan, currentEffect],
		[plan, { ...currentEffect, pluginId: 'forged' }],
	]);
});
