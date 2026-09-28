/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sameProjectSnapshot } from '../src/common/editor/storage/project-snapshot-equality.ts';

test('project snapshot equality ignores whether equal nested values share an object', () => {
	const shared = { gain: 1, mute: false };
	const withSharedState = {
		tracks: [{ id: 'left', state: shared }, { id: 'right', state: shared }],
	};
	const withSeparateState = {
		tracks: [
			{ id: 'left', state: { gain: 1, mute: false } },
			{ id: 'right', state: { gain: 1, mute: false } },
		],
	};

	assert.equal(sameProjectSnapshot(withSharedState, withSeparateState), true);
	assert.equal(sameProjectSnapshot(withSeparateState, withSharedState), true);
	assert.equal(sameProjectSnapshot(withSharedState, {
		tracks: [
			{ id: 'left', state: { gain: 1, mute: false } },
			{ id: 'right', state: { gain: 0.5, mute: false } },
		],
	}), false);
});
