/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_ERROR_LENGTH = 300;

export interface DesktopMcpService {
	start(): Promise<{ enabled: true; url: string; token: string }>;
	stop(): Promise<void>;
	status(): { enabled: boolean; url: string | null; token: string | null };
	dispose(): Promise<void>;
}

export interface DesktopMcpServiceOptions {
	readonly dispatch: (operation: string, args: unknown) => Promise<unknown>;
}

interface RunningServer {
	readonly server: Server;
	readonly handler: ReturnType<typeof createMcpHandler>;
	readonly url: string;
	readonly token: string;
	readonly revoke: () => void;
}

export function createDesktopMcpService({ dispatch }: DesktopMcpServiceOptions): DesktopMcpService {
	let running: RunningServer | null = null;
	let starting: Promise<RunningServer> | null = null;
	let stopping: Promise<void> | null = null;
	let disposed = false;

	async function start(): Promise<{ enabled: true; url: string; token: string }> {
		if (disposed) throw new Error('Desktop MCP service has been disposed.');
		if (stopping) await stopping;
		if (disposed) throw new Error('Desktop MCP service has been disposed.');
		if (running) return { enabled: true, url: running.url, token: running.token };
		if (!starting) starting = openServer(dispatch);
		try {
			const opened = await starting;
			running = opened;
			return { enabled: true, url: opened.url, token: opened.token };
		} finally {
			starting = null;
		}
	}

	async function stop(): Promise<void> {
		if (stopping) return stopping;
		stopping = (async () => {
			if (starting) {
				try { running = await starting; } catch { /* A failed start has nothing to close. */ }
			}
			const active = running;
			running = null;
			if (!active) return;
			active.revoke();
			const closed = new Promise<void>((resolve) => {
				active.server.close(() => resolve());
				active.server.closeAllConnections();
			});
			await Promise.all([active.handler.close(), closed]);
		})();
		try { await stopping; } finally { stopping = null; }
	}

	return {
		start,
		stop,
		status: () => running
			? { enabled: true, url: running.url, token: running.token }
			: { enabled: false, url: null, token: null },
		dispose: async () => { disposed = true; await stop(); },
	};
}

async function openServer(dispatch: DesktopMcpServiceOptions['dispatch']): Promise<RunningServer> {
	const token = randomBytes(32).toString('hex');
	const handler = createMcpHandler(() => buildMcpServer(dispatch));
	const nodeHandler = toNodeHandler(handler);
	let port = 0;
	let revoked = false;
	const server = createServer((request, response) => {
		void handleHttpRequest(request, response, port, token, () => revoked, nodeHandler).catch(() => {
			if (!response.headersSent) reply(response, 500, 'Internal server error');
			else response.destroy();
		});
	});
	server.requestTimeout = 30_000;
	server.headersTimeout = 10_000;
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				server.removeListener('error', reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Desktop MCP listener has no TCP port.');
		port = address.port;
		return { server, handler, url: `http://127.0.0.1:${port}/mcp`, token, revoke: () => { revoked = true; } };
	} catch (error) {
		await handler.close();
		server.close();
		throw error;
	}
}

function buildMcpServer(dispatch: DesktopMcpServiceOptions['dispatch']): McpServer {
	const server = new McpServer({ name: 'soundscaper-desktop', version: '1.0.0' });
	const invoke = async (operation: string, args: unknown) => {
		try {
			const value = await dispatch(operation, args);
			const serialized = JSON.stringify(value ?? null);
			if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) throw new Error('Result exceeds the MCP response limit.');
			return { content: [{ type: 'text' as const, text: serialized }] };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'The editor request failed.';
			return { isError: true, content: [{ type: 'text' as const, text: message.slice(0, MAX_ERROR_LENGTH) }] };
		}
	};
	server.registerTool('get_active_project', {
		description: 'Read the active project identity, revision, read-only state and selection.',
		inputSchema: z.object({}).strict(),
	}, async () => invoke('get_active_project', {}));
	server.registerTool('read_project_document', {
		description: 'Read a page of active project metadata at the requested revision. Media bodies are omitted.',
		inputSchema: z.object({
			projectId: z.string().min(1).max(256),
			expectedRevision: z.number().int().nonnegative(),
			cursor: z.string().max(512).optional(),
		}).strict(),
	}, async (args) => invoke('read_project_document', args));
	server.registerTool('list_editor_commands', {
		description: 'List supported editor command type names.',
		inputSchema: z.object({}).strict(),
	}, async () => invoke('list_editor_commands', {}));
	server.registerTool('execute_editor_command', {
		description: 'Commit a serializable editor command to the active project at the expected revision. This can edit or delete project content.',
		inputSchema: z.object({
			projectId: z.string().min(1).max(256),
			expectedRevision: z.number().int().nonnegative(),
			command: z.object({ type: z.string().min(1).max(128) }).passthrough(),
		}).strict(),
	}, async (args) => invoke('execute_editor_command', args));
	server.registerResource('editor-command-types', 'soundscaper://commands', {
		title: 'Soundscaper editor command type names',
		mimeType: 'application/json',
	}, async (uri) => {
		const value = await dispatch('list_editor_commands', {});
		const text = JSON.stringify(value ?? null);
		if (Buffer.byteLength(text, 'utf8') > MAX_RESULT_BYTES) throw new Error('Command reference exceeds the MCP response limit.');
		return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
	});
	return server;
}

async function handleHttpRequest(
	request: IncomingMessage,
	response: ServerResponse,
	port: number,
	token: string,
	isRevoked: () => boolean,
	nodeHandler: ReturnType<typeof toNodeHandler>,
): Promise<void> {
	response.setHeader('Cache-Control', 'no-store');
	if (isRevoked()) { reply(response, 401, 'Unauthorized'); return; }
	if (request.url !== '/mcp') { reply(response, 404, 'Not found'); return; }
	if (request.headers.host !== `127.0.0.1:${port}` || hasDuplicateHeader(request, 'host') || request.headers.origin !== undefined) {
		reply(response, 403, 'Forbidden');
		return;
	}
	if (!validBearer(request.headers.authorization, token) || hasDuplicateHeader(request, 'authorization')) {
		reply(response, 401, 'Unauthorized');
		return;
	}
	if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE') {
		reply(response, 405, 'Method not allowed');
		return;
	}
	if (request.method !== 'POST') { await nodeHandler(request, response); return; }
	const declaredLength = Number(request.headers['content-length']);
	if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
		request.resume();
		reply(response, 413, 'Request too large');
		return;
	}
	const body = await readJsonBody(request);
	if (body.kind === 'too-large') { reply(response, 413, 'Request too large'); return; }
	if (body.kind !== 'valid') { reply(response, 400, 'Invalid JSON'); return; }
	await nodeHandler(request, response, body.value);
}

function readJsonBody(request: IncomingMessage): Promise<
	{ kind: 'valid'; value: unknown } | { kind: 'invalid' | 'too-large' }
> {
	return new Promise((resolve) => {
		let size = 0;
		let settled = false;
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => {
			if (settled) return;
			size += chunk.byteLength;
			if (size > MAX_REQUEST_BYTES) {
				settled = true;
				resolve({ kind: 'too-large' });
				return;
			}
			chunks.push(chunk);
		});
		request.on('end', () => {
			if (settled) return;
			settled = true;
			try { resolve({ kind: 'valid', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }); }
			catch { resolve({ kind: 'invalid' }); }
		});
		request.on('error', () => {
			if (!settled) { settled = true; resolve({ kind: 'invalid' }); }
		});
	});
}

function hasDuplicateHeader(request: IncomingMessage, name: string): boolean {
	let count = 0;
	for (let index = 0; index < request.rawHeaders.length; index += 2) {
		if (request.rawHeaders[index]?.toLowerCase() === name) count += 1;
	}
	return count !== 1;
}

function validBearer(header: string | undefined, token: string): boolean {
	if (!header?.startsWith('Bearer ')) return false;
	const candidate = header.slice(7);
	if (!/^[0-9a-f]{64}$/.test(candidate)) return false;
	return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(token, 'hex'));
}

function reply(response: ServerResponse, status: number, body: string): void {
	response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
	response.end(body);
}
