/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { READ_PROFILE_MATERIALIZED_V1 } from '../desktop/constants.js';
import { registerSelectedReadCapability } from '../desktop/read-selection-service.js';
import { acceptsFile, validateFileChoice } from '../desktop/validation.js';

test('normal desktop project selection admits legacy Audacity files', () => {
	const choice = validateFileChoice({ purpose: 'project', multiple: false });
	assert.equal(choice.extensions.includes('aup'), true);
	assert.equal(choice.filters.some((filter: Readonly<{ extensions: readonly string[] }>) => filter.extensions.includes('aup')), true);
	assert.equal(acceptsFile('project', '/projects/session.aup'), true);
	assert.equal(acceptsFile('project', '/projects/session.AUP'), true);
	assert.equal(acceptsFile('project', '/projects/session.aup.zip'), false);
	assert.equal(acceptsFile('audio', '/projects/session.aup'), false);
	assert.equal(acceptsFile('media', '/projects/session.aup'), false);
});

test('legacy Audacity selection registers a materialized project capability', async () => {
	const owner = Object.freeze({ name: 'renderer-owner' });
	const calls: Array<Readonly<{ filePath: string; owner: typeof owner }>> = [];
	const descriptor = Object.freeze({ id: 'legacy-project', readProfile: READ_PROFILE_MATERIALIZED_V1 });
	const store = {
		registerMaterializedPath(filePath: string, options: { owner: typeof owner }) {
			calls.push({ filePath, owner: options.owner });
			return Promise.resolve(descriptor);
		},
		registerScapeRangePath() {
			assert.fail('Legacy Audacity projects must not use the Scape range profile');
		},
	};
	const selection = await registerSelectedReadCapability(store, '/projects/session.aup', {
		owner,
		purpose: 'project',
	});
	assert.equal(selection, descriptor);
	assert.deepEqual(calls, [{ filePath: '/projects/session.aup', owner }]);
});
