/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readDesktopPreloadSource } from './helpers/desktop-preload-source.mjs';

test('the desktop progress bridge invokes a read-only channel and strips filesystem authority', async () => {
	const exposed: { bridge?: { nativePluginScanProgress(): Promise<unknown> } } = {};
	const invocations: string[] = [];
	const source = await readDesktopPreloadSource();
	vm.runInNewContext(source, {
		AggregateError, ArrayBuffer, Array, JSON, Number, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name: string, value: { v1: NonNullable<typeof exposed.bridge> }) {
				if (name === 'scapeDesktop') exposed.bridge = value.v1;
			} },
			ipcRenderer: {
				invoke(channel: string) {
					invocations.push(channel);
					return Promise.resolve({ enabled: true, scanProgress: { format: 'vst3', progress: 0.5,
						rootPath: '/private/plugins', binaryPath: '/private/plugin.vst3' } });
				},
				send() {}, on() {}, removeListener() {},
			},
		}),
	});
	assert.ok(exposed.bridge);
	const result = await exposed.bridge.nativePluginScanProgress();
	assert.deepEqual(JSON.parse(JSON.stringify(result)), { enabled: true, scanProgress: { format: 'vst3', progress: 0.5 } });
	assert.deepEqual(invocations, ['soundscaper:v1:helper:native-plugin-scan-progress']);
});
