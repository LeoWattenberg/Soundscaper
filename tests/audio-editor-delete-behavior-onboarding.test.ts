/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	completeDeleteBehaviorOnboarding,
	type DeleteBehaviorConfirmationRequest,
} from '../src/common/editor/controller/edit/delete-behavior-onboarding-service.ts';

test('first-use delete behavior persists the exact panel choice before applying the edit', async () => {
	const events: string[] = [];
	let prompt: Readonly<DeleteBehaviorConfirmationRequest> | null = null;
	const result = await completeDeleteBehaviorOnboarding({
		action: 'cut',
		title: 'Choose behavior when deleting a portion of a clip',
		initialCloseGapBehavior: 'track',
		confirm: (request) => {
			events.push('confirm');
			prompt = request;
			return { accepted: true, deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' };
		},
		updatePreferences: (editing) => {
			events.push(`persist:${editing.deleteBehavior}:${editing.closeGapBehavior}`);
		},
		assertCurrent: () => { events.push('assert'); },
		apply: (action) => {
			events.push(`apply:${action}`);
			return 17;
		},
	});

	assert.deepEqual(prompt, {
		title: 'Choose behavior when deleting a portion of a clip',
		initialDeleteBehavior: 'leave-gap',
		initialCloseGapBehavior: 'track',
	});
	assert.deepEqual(events, [
		'assert',
		'confirm',
		'assert',
		'persist:close-gap:all-tracks',
		'assert',
		'apply:cut-all-tracks-ripple',
	]);
	assert.equal(result, 17);
});

test('dismissal aborts the original edit without persisting a preference', async () => {
	let persisted = false;
	let applied = false;
	const result = await completeDeleteBehaviorOnboarding({
		action: 'delete',
		title: 'Choose behavior',
		initialCloseGapBehavior: 'clip',
		confirm: () => ({ accepted: false }),
		updatePreferences: () => { persisted = true; },
		assertCurrent: () => undefined,
		apply: () => { applied = true; },
	});

	assert.equal(result, null);
	assert.equal(persisted, false);
	assert.equal(applied, false);
});

test('a stale project after the decision cannot persist or apply the edit', async () => {
	let assertions = 0;
	let persisted = false;
	let applied = false;
	await assert.rejects(completeDeleteBehaviorOnboarding({
		action: 'delete',
		title: 'Choose behavior',
		initialCloseGapBehavior: 'clip',
		confirm: () => ({ accepted: true, deleteBehavior: 'leave-gap', closeGapBehavior: 'clip' }),
		updatePreferences: () => { persisted = true; },
		assertCurrent: () => {
			assertions += 1;
			if (assertions === 2) throw new DOMException('Project changed.', 'AbortError');
		},
		apply: () => { applied = true; },
	}), { name: 'AbortError' });

	assert.equal(persisted, false);
	assert.equal(applied, false);
});

test('persistence failure and a post-persistence stale revision both prevent the edit', async (t) => {
	await t.test('persistence failure', async () => {
		let applied = false;
		const failure = new Error('settings unavailable');
		await assert.rejects(completeDeleteBehaviorOnboarding({
			action: 'cut',
			title: 'Choose behavior',
			initialCloseGapBehavior: 'clip',
			confirm: () => ({ accepted: true, deleteBehavior: 'leave-gap', closeGapBehavior: 'clip' }),
			updatePreferences: () => { throw failure; },
			assertCurrent: () => undefined,
			apply: () => { applied = true; },
		}), (error: unknown) => error === failure);
		assert.equal(applied, false);
	});

	await t.test('project changes while preferences persist', async () => {
		let assertions = 0;
		let applied = false;
		await assert.rejects(completeDeleteBehaviorOnboarding({
			action: 'delete',
			title: 'Choose behavior',
			initialCloseGapBehavior: 'clip',
			confirm: () => ({ accepted: true, deleteBehavior: 'close-gap', closeGapBehavior: 'clip' }),
			updatePreferences: async () => undefined,
			assertCurrent: () => {
				assertions += 1;
				if (assertions === 3) throw new DOMException('Project changed.', 'AbortError');
			},
			apply: () => { applied = true; },
		}), { name: 'AbortError' });
		assert.equal(applied, false);
	});
});

test('the accepted panel result is closed and cannot select NotSet', async () => {
	await assert.rejects(completeDeleteBehaviorOnboarding({
		action: 'delete',
		title: 'Choose behavior',
		initialCloseGapBehavior: 'clip',
		confirm: () => ({
			accepted: true,
			deleteBehavior: 'not-set',
			closeGapBehavior: 'clip',
		} as never),
		updatePreferences: () => undefined,
		assertCurrent: () => undefined,
		apply: () => undefined,
	}), /concrete delete behavior/u);
});
