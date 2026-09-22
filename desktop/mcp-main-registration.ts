/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';

import { createDesktopMcpService, type DesktopMcpService } from './mcp-service.ts';

const CHANNEL = Object.freeze({
	status: 'soundscaper:v1:mcp:status',
	start: 'soundscaper:v1:mcp:start',
	stop: 'soundscaper:v1:mcp:stop',
	response: 'soundscaper:v1:mcp:response',
	request: 'soundscaper:v1:event:mcp-request',
});
const OPERATIONS = new Set(['get_active_project', 'read_project_document', 'list_editor_commands', 'execute_editor_command']);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PENDING = 16;

interface PendingRequest {
	readonly owner: unknown;
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

export interface DesktopMcpMainOptions {
	readonly handle: (channel: string, handler: (event: unknown) => unknown) => void;
	readonly on: (channel: string, listener: (event: unknown, value: unknown) => void) => void;
	readonly off: (channel: string, listener: (event: unknown, value: unknown) => void) => void;
	readonly removeHandler: (channel: string) => void;
	readonly currentOwner: () => unknown;
	readonly ownerFor: (event: unknown) => unknown;
	readonly isOwnerCurrent: (owner: unknown) => boolean;
	readonly sendToRenderer: (channel: string, value: unknown) => boolean;
	readonly createService?: (options: { dispatch: (operation: string, args: unknown) => Promise<unknown> }) => DesktopMcpService;
}

export interface DesktopMcpMainRegistration {
	readonly revoke: () => Promise<void>;
	readonly dispose: () => Promise<void>;
}

export function registerDesktopMcpMain(options: DesktopMcpMainOptions): DesktopMcpMainRegistration {
	const pending = new Map<string, PendingRequest>();
	let generation = 0;
	let disposed = false;
	const service = (options.createService ?? createDesktopMcpService)({ dispatch });

	function requireOwner(event: unknown): unknown {
		const owner = options.ownerFor(event);
		if (!owner || !options.isOwnerCurrent(owner) || owner !== options.currentOwner()) {
			throw new Error('Desktop MCP renderer is unavailable.');
		}
		return owner;
	}

	function dispatch(operation: string, args: unknown): Promise<unknown> {
		if (disposed || !OPERATIONS.has(operation)) return Promise.reject(new Error('Desktop MCP request is unavailable.'));
		const owner = options.currentOwner();
		if (!owner || !options.isOwnerCurrent(owner)) return Promise.reject(new Error('Desktop MCP renderer is unavailable.'));
		if (pending.size >= MAX_PENDING) return Promise.reject(new Error('Desktop MCP has too many pending requests.'));
		const requestId = randomUUID();
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(requestId);
				reject(new Error('Desktop MCP editor request timed out.'));
			}, REQUEST_TIMEOUT_MS);
			timeout.unref?.();
			pending.set(requestId, { owner, resolve, reject, timeout });
			try {
				if (!options.sendToRenderer(CHANNEL.request, { requestId, operation, args })) {
					pending.delete(requestId);
					clearTimeout(timeout);
					reject(new Error('Desktop MCP renderer is unavailable.'));
				}
			} catch {
				pending.delete(requestId);
				clearTimeout(timeout);
				reject(new Error('Desktop MCP renderer is unavailable.'));
			}
		});
	}

	function onResponse(event: unknown, value: unknown): void {
		if (!value || typeof value !== 'object') return;
		const response = value as { requestId?: unknown; success?: unknown; result?: unknown; error?: unknown };
		if (typeof response.requestId !== 'string') return;
		const request = pending.get(response.requestId);
		if (!request) return;
		let owner: unknown;
		try { owner = options.ownerFor(event); } catch { return; }
		if (owner !== request.owner || !options.isOwnerCurrent(owner)) return;
		pending.delete(response.requestId);
		clearTimeout(request.timeout);
		if (response.success === true) request.resolve(response.result);
		else request.reject(new Error(typeof response.error === 'string' ? response.error.slice(0, 300) : 'Desktop MCP editor request failed.'));
	}

	async function revoke(): Promise<void> {
		generation += 1;
		for (const request of pending.values()) {
			clearTimeout(request.timeout);
			request.reject(new Error('Desktop MCP renderer was revoked.'));
		}
		pending.clear();
		await service.stop();
	}

	options.handle(CHANNEL.status, (event) => { requireOwner(event); return service.status(); });
	options.handle(CHANNEL.start, async (event) => {
		requireOwner(event);
		if (disposed) throw new Error('Desktop MCP service has been disposed.');
		const startedAt = generation;
		const started = await service.start();
		if (startedAt !== generation || !options.isOwnerCurrent(options.ownerFor(event))) {
			await service.stop();
			throw new Error('Desktop MCP renderer was revoked.');
		}
		return started;
	});
	options.handle(CHANNEL.stop, async (event) => {
		requireOwner(event);
		await revoke();
		return service.status();
	});
	options.on(CHANNEL.response, onResponse);

	return {
		revoke,
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			await revoke();
			options.off(CHANNEL.response, onResponse);
			for (const channel of [CHANNEL.status, CHANNEL.start, CHANNEL.stop]) options.removeHandler(channel);
			await service.dispose();
		},
	};
}
