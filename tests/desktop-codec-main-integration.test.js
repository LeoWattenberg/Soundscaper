/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerDesktopCodecProviders } from '../desktop/desktop-codec-main-integration.mjs';

test('desktop codec integration owns both providers behind one revoke and shutdown barrier', async () => {
	const events = [];
	let releaseDisposal;
	const disposalBarrier = new Promise((resolve) => { releaseDisposal = resolve; });
	const registrations = [provider('audio'), provider('video')];
	const options = Object.freeze({ productId: 'soundscaper' });
	const codecs = await registerDesktopCodecProviders(options, {
		registerAudioCodecs: async (value) => {
			assert.strictEqual(value, options);
			events.push('register:audio');
			return registrations[0];
		},
		registerVideoCodecs: async (value) => {
			assert.strictEqual(value, options);
			events.push('register:video');
			return registrations[1];
		},
	});
	const owner = {};
	assert.equal(await codecs.revokeOwner(owner), true);
	assert.deepEqual(events.slice(0, 4), [
		'register:audio', 'register:video', 'revoke:audio', 'revoke:video',
	]);
	const first = codecs.dispose();
	assert.strictEqual(codecs.dispose(), first);
	assert.deepEqual(new Set(events.slice(4)), new Set(['dispose:audio', 'dispose:video']));
	assert.equal(await pending(first), true);
	releaseDisposal();
	await first;

	function provider(name) {
		return Object.freeze({
			async revokeOwner(value) {
				assert.strictEqual(value, owner);
				events.push(`revoke:${name}`);
				return name === 'video';
			},
			dispose() {
				events.push(`dispose:${name}`);
				return disposalBarrier;
			},
		});
	}
});

test('desktop codec integration rolls back audio when video registration fails', async () => {
	let disposed = 0;
	const failure = new Error('video registration failed');
	await assert.rejects(() => registerDesktopCodecProviders({}, {
		registerAudioCodecs: async () => ({
			revokeOwner: async () => false,
			dispose: async () => { disposed += 1; },
		}),
		registerVideoCodecs: async () => { throw failure; },
	}), (error) => error === failure);
	assert.equal(disposed, 1);
});

test('desktop codec integration drains both providers before reporting failures', async () => {
	const events = [];
	const codecs = await registerDesktopCodecProviders({}, {
		registerAudioCodecs: async () => failingProvider('audio'),
		registerVideoCodecs: async () => failingProvider('video'),
	});
	await assert.rejects(codecs.dispose(), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors.length, 2);
		return true;
	});
	assert.deepEqual(new Set(events), new Set([
		'dispose:audio:start', 'dispose:audio:end', 'dispose:video:start', 'dispose:video:end',
	]));

	function failingProvider(name) {
		return {
			revokeOwner: async () => false,
			async dispose() {
				events.push(`dispose:${name}:start`);
				await new Promise((resolve) => setImmediate(resolve));
				events.push(`dispose:${name}:end`);
				throw new Error(`${name} cleanup`);
			},
		};
	}
});

async function pending(promise) {
	return Promise.race([promise.then(() => false, () => false), Promise.resolve(true)]);
}
