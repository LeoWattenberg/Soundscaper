/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerDesktopVideoCodecs } from '../desktop/desktop-video-codec-registration.mjs';

test('desktop video registration binds one main-owned service and owner-scoped IPC', async () => {
	const channels = Object.fromEntries([
		'Capabilities', 'Begin', 'Write', 'Close', 'Execute', 'Stat', 'Read', 'Delete', 'Cancel',
	].map((suffix) => [`desktopVideoCodec${suffix}`, `video:${suffix.toLowerCase()}`]));
	const serviceOptions = [];
	const ipcOptions = [];
	const revoked = [];
	let serviceDisposals = 0;
	let ipcDisposals = 0;
	let releaseDisposal;
	const disposalBarrier = new Promise((resolve) => { releaseDisposal = resolve; });
	const service = {
		capabilities: async () => ({ schemaVersion: 1 }), revokeOwner: async () => false,
		dispose: async () => { serviceDisposals += 1; await disposalBarrier; },
	};
	const registration = await registerDesktopVideoCodecs({
		channels, handle() {}, removeHandler() {}, ownerFor: () => ({}),
		productId: 'soundscaper',
		externalFfmpegPreferences: { admission: () => null, invalidateAdmission: async () => ({}) },
		userDataPath: '/user-data', environment: {},
		loadModules: async () => ({
			createExternalFfmpegVideoOperationService(options) { serviceOptions.push(options); return service; },
			registerDesktopVideoCodecMainIpc(options) {
				ipcOptions.push(options);
				return {
					revokeOwner: async (owner) => { revoked.push(owner); return true; },
					dispose: () => { ipcDisposals += 1; },
				};
			},
		}),
	});
	assert.equal(serviceOptions[0].scratchRoot, '/user-data/desktop-video-codecs');
	assert.equal(serviceOptions[0].productId, 'soundscaper');
	assert.equal(ipcOptions[0].service, service);
	assert.deepEqual(ipcOptions[0].channels, channels);
	assert.deepEqual(await registration.capabilities(), { schemaVersion: 1 });
	const owner = {};
	assert.equal(await registration.revokeOwner(owner), true);
	assert.deepEqual(revoked, [owner]);
	const firstDisposal = registration.dispose();
	assert.strictEqual(registration.dispose(), firstDisposal);
	assert.equal(ipcDisposals, 1);
	assert.equal(serviceDisposals, 1);
	assert.equal(await pending(firstDisposal), true);
	releaseDisposal();
	await firstDisposal;
});

async function pending(promise) {
	return Promise.race([promise.then(() => false, () => false), Promise.resolve(true)]);
}

test('desktop video registration rejects an untrusted product scope', async () => {
	await assert.rejects(() => registerDesktopVideoCodecs({
		channels: Object.fromEntries([
			'Capabilities', 'Begin', 'Write', 'Close', 'Execute', 'Stat', 'Read', 'Delete', 'Cancel',
		].map((suffix) => [`desktopVideoCodec${suffix}`, `video:${suffix.toLowerCase()}`])),
		handle() {}, removeHandler() {}, ownerFor: () => ({}), productId: 'legacy',
		externalFfmpegPreferences: { admission: () => null, invalidateAdmission: async () => ({}) },
		userDataPath: '/user-data', environment: {},
	}), /product|ports/iu);
});
