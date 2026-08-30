/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const METHODS = Object.freeze([
	'cancel', 'currentProjectIdentity', 'enqueueBatch', 'events', 'list', 'pause',
	'reauthorizeDestination', 'reorder', 'resume', 'retry', 'selectDestination',
]);

test('preload exposes only the closed pathless persistent-delivery UI bridge', async () => {
	const calls = [];
	const bridge = await preloadBridge(async (channel, value) => {
		calls.push({ channel, value });
		if (channel.endsWith(':root:select')) return { grantId: '1'.repeat(48) };
		return true;
	});
	const delivery = bridge.v1.persistentDelivery;
	assert.deepEqual(Object.keys(delivery).sort(), [...METHODS].sort());
	assert.deepEqual(await delivery.selectDestination(), { grantId: '1'.repeat(48) });
	await delivery.currentProjectIdentity({ projectId: 'album-project' });
	await delivery.currentProjectIdentity({ projectId: null });
	await delivery.list({ limit: 100, cursor: '0', currentProjectIdentity: null });
	assert.throws(
		() => delivery.enqueueBatch({ items: [], admission: { rootPath: '/private/output' } }),
		/path/iu,
	);
	assert.throws(() => delivery.enqueueBatch({
		items: [{ description: {
			planPayload: JSON.stringify({ operatorMemo: '../../secret' }),
		} }],
		admission: {},
	}), /path/iu, 'relative traversal cannot hide inside a generic canonical plan field');
	for (const hiddenPath of [
		{ sourcePath: 'relative/source.wav' },
		{ outputPath: 'relative/master.wav' },
		{ clipPaths: ['relative/clip.wav'] },
	]) assert.throws(() => delivery.enqueueBatch({
		items: [{ description: { planPayload: JSON.stringify(hiddenPath) } }], admission: {},
	}), /path/iu, `${Object.keys(hiddenPath)[0]} must be refused even when it is relative`);
	assert.doesNotThrow(() => delivery.enqueueBatch({
		items: [{ description: {
			planPayload: JSON.stringify({ mediaType: 'audio/wav', displayRatio: '1/2' }),
		} }],
		admission: {},
	}), 'non-path slash-delimited values remain valid');
	assert.equal(calls.some(({ value }) => String(JSON.stringify(value)).includes('/private/output')), false);
	for (const method of ['claimNext', 'progress', 'beginWrite', 'writeChunk', 'complete', 'fail', 'releaseClaim']) {
		assert.equal(Object.hasOwn(delivery, method), false, `${method} must not cross the ordinary public bridge`);
	}
});

test('preload transfers one private worker port without carrying media through invoke', async () => {
	const invoked = [];
	const posted = [];
	const fixture = await preloadFixture(async (channel, value) => { invoked.push({ channel, value }); },
		(channel, value, ports) => { posted.push({ channel, value, ports }); });
	const channel = new MessageChannel();
	fixture.dispatch({
		source: fixture.window,
		data: {
			type: 'soundscaper-persistent-delivery-worker-connect-v1',
			request: {
				jobId: '2'.repeat(48),
				currentAuthority: {
					projectIdentity: { projectId: 'album-project', projectRevision: 7, projectSha256: 'a'.repeat(64) },
					planFingerprint: 'b'.repeat(64),
				},
			},
		},
		ports: [channel.port1],
	});
	assert.equal(invoked.length, 0);
	assert.equal(posted.length, 1);
	assert.equal(posted[0].channel, 'soundscaper:v1:delivery:worker:port');
	assert.equal(posted[0].ports.length, 1);
	assert.equal(posted[0].ports[0], channel.port1);
	assert.deepEqual(Reflect.ownKeys(posted[0].value).sort(), ['currentAuthority', 'jobId']);
	channel.port2.close();
});

test('preload refuses a path leaked by persistent-delivery main', async () => {
	const bridge = await preloadBridge(async () => ({ stagingPath: '/private/output/job.partial' }));
	await assert.rejects(() => bridge.v1.persistentDelivery.selectDestination(), /path/iu);
});

test('Framescaper receives neither the nested queue bridge nor the private worker transfer listener', async () => {
	const posted = [];
	const fixture = await preloadFixture(async () => true,
		(...args) => { posted.push(args); }, 'framescaper');
	assert.equal(Object.hasOwn(fixture.bridge.v1, 'persistentDelivery'), false);
	assert.equal(Object.hasOwn(fixture.framescaperBridge.v1, 'persistentDelivery'), false);
	assert.equal(fixture.hasMessageListener(), false);
	assert.deepEqual(posted, []);
});

async function preloadBridge(invoke) {
	return (await preloadFixture(invoke)).bridge;
}

async function preloadFixture(invoke, postMessage = () => undefined, productId = 'soundscaper') {
	const exposed = new Map();
	let messageListener = null;
	const mainWindow = {
		location: { origin: 'file://' },
		addEventListener: (type, listener) => {
			if (type === 'message') messageListener = listener;
		},
	};
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AbortSignal, ArrayBuffer, Object, Promise, RangeError, Set, String, TypeError, Uint8Array, URL,
		structuredClone, window: mainWindow, process: { argv: [`--soundscaper-product=${productId}`] },
		require: (specifier) => {
			assert.equal(specifier, 'electron');
			return {
				contextBridge: { exposeInMainWorld: (name, value) => exposed.set(name, value) },
				ipcRenderer: { invoke, postMessage, send() {}, on() {}, removeListener() {} },
			};
		},
	});
	return {
		bridge: exposed.get('soundscaperDesktop'),
		framescaperBridge: exposed.get('framescaperDesktop'),
		dispatch: (event) => messageListener?.(event),
		hasMessageListener: () => messageListener !== null,
		window: mainWindow,
	};
}
