/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { createDesktopMcpService } from '../desktop/mcp-service.ts';

test('desktop MCP is disabled until started and revokes its token on stop', async () => {
	const calls: string[] = [];
	const service = createDesktopMcpService({ dispatch: async (operation) => {
		calls.push(operation);
		return { ok: true };
	} });
	assert.deepEqual(service.status(), { enabled: false, url: null, token: null });
	const first = await service.start();
	try {
		assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
		assert.match(first.token, /^[0-9a-f]{64}$/);
		assert.deepEqual(service.status(), first);
		assert.deepEqual(await service.start(), first);
		const noToken = await fetch(first.url, { method: 'POST' });
		assert.equal(noToken.status, 401);
		const wrongToken = await fetch(first.url, { method: 'POST', headers: { authorization: 'Bearer wrong' } });
		assert.equal(wrongToken.status, 401);
		assert.deepEqual(calls, []);
	} finally {
		await service.stop();
	}
	assert.deepEqual(service.status(), { enabled: false, url: null, token: null });
	const second = await service.start();
	try {
		assert.notEqual(second.token, first.token);
		assert.equal((await fetch(second.url, { method: 'POST', headers: { authorization: `Bearer ${first.token}` } })).status, 401);
	} finally {
		await service.dispose();
	}
});

test('desktop MCP checks the exact host, rejects every browser origin, and limits request size', async () => {
	const service = createDesktopMcpService({ dispatch: async () => ({ ok: true }) });
	const { url, token } = await service.start();
	const headers = { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
	try {
		assert.equal(await postWithHost(url, token, 'localhost:1234'), 403);
		for (const origin of ['http://localhost:3000', 'null', 'http://evil.example']) {
			const response = await fetch(url, { method: 'POST', headers: { ...headers, origin }, body: '{}' });
			assert.equal(response.status, 403);
		}
		const tooLarge = await fetch(url, { method: 'POST', headers, body: 'x'.repeat(8 * 1024 * 1024 + 1) });
		assert.equal(tooLarge.status, 413);
	} finally {
		await service.dispose();
	}
});

test('desktop MCP exposes four tools and forwards validated reads and commands', async () => {
	const calls: Array<{ operation: string; args: unknown }> = [];
	const service = createDesktopMcpService({ dispatch: async (operation, args) => {
		calls.push({ operation, args });
		return { operation, revision: 8 };
	} });
	const connection = await service.start();
	try {
		const listed = await callMcp(connection, 1, 'tools/list', {});
		assert.deepEqual((listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name), [
			'get_active_project', 'read_project_document', 'list_editor_commands', 'execute_editor_command',
		]);
		const resources = await callMcp(connection, 5, 'resources/list', {});
		assert.deepEqual((resources.result as { resources: Array<{ uri: string }> }).resources.map((resource) => resource.uri), [
			'soundscaper://commands',
		]);
		const reference = await callMcp(connection, 6, 'resources/read', { uri: 'soundscaper://commands' });
		assert.deepEqual(JSON.parse((reference.result as { contents: Array<{ text: string }> }).contents[0]!.text), {
			operation: 'list_editor_commands', revision: 8,
		});
		const read = await callMcp(connection, 2, 'tools/call', {
			name: 'read_project_document', arguments: { projectId: 'project-1', expectedRevision: 7, cursor: 'next' },
		});
		assert.deepEqual(JSON.parse((read.result as { content: Array<{ text: string }> }).content[0]!.text), {
			operation: 'read_project_document', revision: 8,
		});
		const command = { type: 'batch', commands: [{ type: 'project/rename', name: 'New name' }] };
		await callMcp(connection, 3, 'tools/call', {
			name: 'execute_editor_command', arguments: { projectId: 'project-1', expectedRevision: 7, command },
		});
		assert.deepEqual(calls, [
			{ operation: 'list_editor_commands', args: {} },
			{ operation: 'read_project_document', args: { projectId: 'project-1', expectedRevision: 7, cursor: 'next' } },
			{ operation: 'execute_editor_command', args: { projectId: 'project-1', expectedRevision: 7, command } },
		]);
		const invalid = await callMcp(connection, 4, 'tools/call', {
			name: 'execute_editor_command', arguments: { projectId: 'project-1', expectedRevision: -1, command },
		});
		assert.equal((invalid.result as { isError?: boolean }).isError, true);
		assert.equal(calls.length, 3);
	} finally {
		await service.dispose();
	}
});

test('desktop MCP bounds dispatch errors and oversized results', async () => {
	const service = createDesktopMcpService({ dispatch: async (operation) => {
		if (operation === 'get_active_project') throw new Error('E'.repeat(1_000));
		return { value: 'x'.repeat(1024 * 1024) };
	} });
	const connection = await service.start();
	try {
		const error = await callMcp(connection, 1, 'tools/call', { name: 'get_active_project', arguments: {} });
		assert.equal((error.result as { isError: boolean }).isError, true);
		assert.equal((error.result as { content: Array<{ text: string }> }).content[0]!.text.length, 300);
		const oversized = await callMcp(connection, 2, 'tools/call', { name: 'list_editor_commands', arguments: {} });
		assert.equal((oversized.result as { isError: boolean }).isError, true);
		assert.match((oversized.result as { content: Array<{ text: string }> }).content[0]!.text, /response limit/);
	} finally {
		await service.dispose();
	}
});

async function callMcp(
	connection: { url: string; token: string },
	id: number,
	method: string,
	params: unknown,
): Promise<{ result?: unknown; error?: unknown }> {
	const response = await fetch(connection.url, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${connection.token}`,
			accept: 'application/json, text/event-stream',
			'content-type': 'application/json',
		},
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
	});
	assert.equal(response.status, 200);
	const text = await response.text();
	const event = text.split('\n').find((line) => line.startsWith('data: '));
	assert.ok(event, text);
	return JSON.parse(event.slice(6)) as { result?: unknown; error?: unknown };
}

function postWithHost(url: string, token: string, host: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(url, {
			method: 'POST',
			headers: { host, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		}, (response) => {
			response.resume();
			resolve(response.statusCode ?? 0);
		});
		request.on('error', reject);
		request.end('{}');
	});
}
