/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerDesktopMcpMain } from '../desktop/mcp-main-registration.ts';

const STATUS = 'soundscaper:v1:mcp:status';
const START = 'soundscaper:v1:mcp:start';
const STOP = 'soundscaper:v1:mcp:stop';
const RESPONSE = 'soundscaper:v1:mcp:response';
const REQUEST = 'soundscaper:v1:event:mcp-request';

function requireDispatch(value: ((operation: string, args: unknown) => Promise<unknown>) | null) {
	if (!value) throw new Error('MCP service did not bind dispatch.');
	return value;
}

test('desktop MCP dispatch accepts only the current renderer response', async () => {
	const owner = Object.freeze({ id: 'current' });
	const staleOwner = Object.freeze({ id: 'stale' });
	const handlers = new Map<string, (event: unknown) => unknown>();
	const listeners = new Map<string, (event: unknown, value: unknown) => void>();
	const sent: { channel: string; value: unknown }[] = [];
	let dispatch: ((operation: string, args: unknown) => Promise<unknown>) | null = null;
	let enabled = false;
	const registration = registerDesktopMcpMain({
		handle: (channel, handler) => { handlers.set(channel, handler); },
		on: (channel, listener) => { listeners.set(channel, listener); },
		off: (channel) => { listeners.delete(channel); },
		removeHandler: (channel) => { handlers.delete(channel); },
		currentOwner: () => owner,
		ownerFor: (event) => event === 'current' ? owner : staleOwner,
		isOwnerCurrent: (candidate) => candidate === owner,
		sendToRenderer: (channel, value) => { sent.push({ channel, value }); return true; },
		createService: ({ dispatch: request }) => {
			dispatch = request;
			return {
				start: async () => { enabled = true; return { enabled, url: 'http://127.0.0.1:4323/mcp', token: 'a'.repeat(64) }; },
				stop: async () => { enabled = false; },
				status: () => ({ enabled, url: enabled ? 'http://127.0.0.1:4323/mcp' : null, token: enabled ? 'a'.repeat(64) : null }),
				dispose: async () => { enabled = false; },
			};
		},
	});
	assert.ok(handlers.has(STATUS));
	assert.ok(handlers.has(START));
	assert.ok(handlers.has(STOP));
	await assert.rejects(Promise.resolve().then(() => handlers.get(START)?.('stale')), /renderer is unavailable/iu);
	assert.throws(() => handlers.get(STATUS)?.('stale'), /renderer is unavailable/iu);
	assert.deepEqual(await handlers.get(START)?.('current'), { enabled: true, url: 'http://127.0.0.1:4323/mcp', token: 'a'.repeat(64) });
	const pending = requireDispatch(dispatch)('get_active_project', {});
	assert.equal(sent[0]?.channel, REQUEST);
	const request = sent[0]?.value as { requestId: string };
	listeners.get(RESPONSE)?.('stale', { requestId: request.requestId, success: true, result: { id: 'wrong' } });
	listeners.get(RESPONSE)?.('current', { requestId: request.requestId, success: true, result: { id: 'right' } });
	assert.deepEqual(await pending, { id: 'right' });
	await registration.dispose();
	assert.equal(handlers.size, 0);
	assert.equal(listeners.size, 0);
});

test('desktop MCP revocation rejects pending work and stops the server', async () => {
	const owner = Object.freeze({ id: 'current' });
	let dispatch: ((operation: string, args: unknown) => Promise<unknown>) | null = null;
	let stopped = 0;
	const registration = registerDesktopMcpMain({
		handle: () => undefined,
		on: () => undefined,
		off: () => undefined,
		removeHandler: () => undefined,
		currentOwner: () => owner,
		ownerFor: () => owner,
		isOwnerCurrent: (candidate) => candidate === owner,
		sendToRenderer: () => true,
		createService: ({ dispatch: request }) => {
			dispatch = request;
			return {
				start: async () => ({ enabled: true, url: 'http://127.0.0.1:4323/mcp', token: 'a'.repeat(64) }),
				stop: async () => { stopped += 1; },
				status: () => ({ enabled: true, url: 'http://127.0.0.1:4323/mcp', token: 'a'.repeat(64) }),
				dispose: async () => undefined,
			};
		},
	});
	const pending = requireDispatch(dispatch)('get_active_project', {});
	const refusal = assert.rejects(pending, /renderer|unavailable|revoked/iu);
	await registration.revoke();
	await refusal;
	assert.equal(stopped, 1);
	await registration.dispose();
});
