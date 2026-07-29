import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('preload sanitizes chooser read descriptors before they cross into the renderer', async () => {
	const id = 'a'.repeat(64);
	const invocationResults = [[{
		id,
		url: `soundscaper-app://bundle/_desktop/read/${id}/session.wav`,
		name: 'session\u0000.wav',
		size: 512 * 1024 ** 2,
		mimeType: 'audio/wav',
		lastModified: 123,
		untrusted: true,
	}], [{
		id,
		url: 'https://example.com/session.wav',
		name: 'session.wav',
		size: 7,
		mimeType: 'audio/wav',
		lastModified: 123,
	}], [{
		id,
		url: `soundscaper-app://bundle/_desktop/read/${id}/oversize.wav`,
		name: 'oversize.wav',
		size: 512 * 1024 ** 2 + 1,
		mimeType: 'audio/wav',
		lastModified: 123,
	}]];
	let bridge;
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer,
		Object,
		Promise,
		RangeError,
		String,
		TypeError,
		Uint8Array,
		URL,
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) {
					if (name === 'scapeDesktop') bridge = value.v1;
				},
			},
			ipcRenderer: {
				invoke: () => Promise.resolve(invocationResults.shift()),
				send: () => {},
				on: () => {},
				removeListener: () => {},
			},
		}),
	});

	const descriptors = await bridge.chooseFiles({ purpose: 'media', multiple: true });
	assert.equal(Object.isFrozen(descriptors), true);
	assert.equal(Object.isFrozen(descriptors[0]), true);
	assert.deepEqual({ ...descriptors[0] }, {
		id,
		url: `soundscaper-app://bundle/_desktop/read/${id}/session.wav`,
		name: 'session.wav',
		size: 512 * 1024 ** 2,
		mimeType: 'audio/wav',
		lastModified: 123,
	});
	await assert.rejects(() => bridge.chooseFiles({ purpose: 'media' }), /Invalid read capability URL/u);
	await assert.rejects(() => bridge.chooseFiles({ purpose: 'media' }), /read descriptor.*too large/iu);
});
