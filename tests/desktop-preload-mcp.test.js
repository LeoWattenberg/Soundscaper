/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const DISABLED = { enabled: false, url: null, token: null };

test('desktop MCP bridge invokes control channels and sanitizes status', async () => {
	const fixture = await loadPreload([DISABLED, { enabled: true, url: 'http://127.0.0.1:4242/mcp', token: 'a'.repeat(64) }, DISABLED]);
	assert.deepEqual({ ...await fixture.bridge.readMcpStatus() }, DISABLED);
	assert.equal((await fixture.bridge.startMcp()).enabled, true);
	assert.deepEqual({ ...await fixture.bridge.stopMcp() }, DISABLED);
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'soundscaper:v1:mcp:status', 'soundscaper:v1:mcp:start', 'soundscaper:v1:mcp:stop',
	]);
	const malformed = await loadPreload([{ ...DISABLED, secret: 'leak' }]);
	await assert.rejects(malformed.bridge.readMcpStatus(), /Invalid desktop MCP status/u);
});

test('desktop MCP bridge relays bounded request and response envelopes', async () => {
	const fixture = await loadPreload([]);
	let received;
	const unsubscribe = fixture.bridge.onMcpRequest((request) => { received = request; });
	fixture.listeners.get('soundscaper:v1:event:mcp-request')?.({}, {
		requestId: 'request-1', operation: 'get_active_project', args: {},
	});
	assert.deepEqual({ ...received }, { requestId: 'request-1', operation: 'get_active_project', args: {} });
	fixture.bridge.respondMcpRequest({ requestId: 'request-1', success: true, result: { projectId: 'p' } });
	assert.equal(fixture.sent.at(-1)?.[0], 'soundscaper:v1:mcp:response');
	assert.equal(fixture.sent.at(-1)?.[1].success, true);
	assert.throws(() => fixture.bridge.respondMcpRequest({ requestId: 'request-1', success: false, error: 'x'.repeat(513) }), /Invalid desktop MCP response/u);
	unsubscribe();
	assert.equal(fixture.listeners.has('soundscaper:v1:event:mcp-request'), false);
});

test('Framescaper bridge does not expose desktop MCP', async () => {
	const fixture = await loadPreload([], ['--soundscaper-product=framescaper']);
	assert.equal(fixture.bridge.readMcpStatus, undefined);
	assert.equal(fixture.bridge.onMcpRequest, undefined);
});

async function loadPreload(invocationResults, argv = []) {
	let bridge;
	const invocations = [];
	const sent = [];
	const listeners = new Map();
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, ArrayBuffer, Array, JSON, Number, Object, Promise, RangeError, String, TypeError,
		Uint8Array, URL, process: { argv },
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; } },
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					return Promise.resolve(invocationResults.shift());
				},
				send: (channel, value) => { sent.push([channel, value]); },
				on: (channel, handler) => listeners.set(channel, handler),
				removeListener: (channel) => listeners.delete(channel),
			},
		}),
	});
	return { bridge, invocations, listeners, sent };
}
