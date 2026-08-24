/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-ownership and cancellation boundary for main-owned audio codec jobs. */

import {
	normalizeDesktopAudioCodecCapabilityQuery,
	normalizeDesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityQuery,
} from './desktop-audio-codec-capability-contract.ts';
import {
	normalizeDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.ts';

export interface DesktopAudioCodecMainIpcChannels {
	readonly desktopAudioCodecExecute: string;
	readonly desktopAudioCodecCancel: string;
	readonly desktopAudioCodecCapabilities: string;
}

export interface DesktopAudioCodecMainIpcService {
	capabilities(query: DesktopAudioCodecCapabilityQuery): Promise<unknown>;
	execute(
		request: DesktopAudioCodecRequest,
		options: Readonly<{ readonly signal: AbortSignal }>,
	): Promise<unknown>;
}

export interface DesktopAudioCodecMainIpcOptions<Owner extends object> {
	readonly channels: DesktopAudioCodecMainIpcChannels;
	readonly handle: (
		channel: string,
		listener: (event: unknown, ...arguments_: unknown[]) => unknown,
	) => void;
	readonly removeHandler: (channel: string) => void;
	readonly ownerFor: (event: unknown) => Owner;
	readonly service: DesktopAudioCodecMainIpcService;
}

export interface DesktopAudioCodecMainIpcRegistration<Owner extends object> {
	revokeOwner(owner: Owner): Promise<boolean>;
	dispose(): void;
}

interface ActiveOperation<Owner extends object> {
	readonly owner: Owner;
	readonly controller: AbortController;
	readonly settled: Promise<unknown>;
}

const CHANNEL_FIELDS = Object.freeze([
	'desktopAudioCodecExecute', 'desktopAudioCodecCancel', 'desktopAudioCodecCapabilities',
] as const);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export function registerDesktopAudioCodecMainIpc<Owner extends object>(
	options: DesktopAudioCodecMainIpcOptions<Owner>,
): DesktopAudioCodecMainIpcRegistration<Owner> {
	validateOptions(options);
	const active = new Map<string, ActiveOperation<Owner>>();
	let disposed = false;
	const registered: string[] = [];
	const bind = (channel: string, listener: (event: unknown, ...arguments_: unknown[]) => unknown): void => {
		options.handle(channel, listener);
		registered.push(channel);
	};
	try {
		bind(options.channels.desktopAudioCodecExecute, async (event, ...arguments_) => {
			if (disposed) throw new Error('The desktop audio codec IPC service is disposed.');
			if (arguments_.length !== 1) throw new TypeError('Desktop audio codec execute IPC requires one request.');
			const request = normalizeDesktopAudioCodecRequest(arguments_[0]);
			const requestId = requiredRequestId(request.requestId);
			if (active.has(requestId)) throw new Error('The desktop audio codec request ID is already active.');
			const owner = owned(options.ownerFor(event));
			const controller = new AbortController();
			const settled = Promise.resolve().then(() => options.service.execute(
				request, Object.freeze({ signal: controller.signal }),
			));
			active.set(requestId, Object.freeze({ owner, controller, settled }));
			try { return await settled; }
			finally {
				const current = active.get(requestId);
				if (current?.controller === controller) active.delete(requestId);
			}
		});
		bind(options.channels.desktopAudioCodecCancel, (event, ...arguments_) => {
			if (arguments_.length !== 1) throw new TypeError('Desktop audio codec cancel IPC requires one request ID.');
			const requestId = requiredRequestId(arguments_[0]);
			const operation = active.get(requestId);
			if (!operation || operation.owner !== owned(options.ownerFor(event))) return false;
			operation.controller.abort(abortReason('The renderer cancelled the desktop audio codec operation.'));
			return true;
		});
		bind(options.channels.desktopAudioCodecCapabilities, async (event, ...arguments_) => {
			if (disposed) throw new Error('The desktop audio codec IPC service is disposed.');
			if (arguments_.length !== 1) throw new TypeError('Desktop audio codec capability IPC requires one query.');
			owned(options.ownerFor(event));
			const query = normalizeDesktopAudioCodecCapabilityQuery(arguments_[0]);
			return normalizeDesktopAudioCodecCapabilityResult(
				await options.service.capabilities(query), query,
			);
		});
	} catch (error) {
		for (const channel of registered) options.removeHandler(channel);
		throw error;
	}

	return Object.freeze({
		async revokeOwner(ownerValue: Owner): Promise<boolean> {
			const owner = owned(ownerValue);
			const revoked = [...active.values()].filter((operation) => operation.owner === owner);
			for (const operation of revoked) operation.controller.abort(abortReason(
				'The owning renderer was revoked during a desktop audio codec operation.',
			));
			await Promise.allSettled(revoked.map(({ settled }) => settled));
			return revoked.length > 0;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const channel of registered) options.removeHandler(channel);
			for (const operation of active.values()) operation.controller.abort(abortReason(
				'The desktop audio codec IPC service stopped.',
			));
		},
	});
}

function validateOptions<Owner extends object>(options: DesktopAudioCodecMainIpcOptions<Owner>): void {
	if (!options || typeof options !== 'object' || !options.channels
		|| typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.ownerFor !== 'function' || !options.service
		|| typeof options.service.execute !== 'function'
		|| typeof options.service.capabilities !== 'function') {
		throw new TypeError('Desktop audio codec IPC ports are invalid.');
	}
	const channels = CHANNEL_FIELDS.map((field) => options.channels[field]);
	if (channels.some((channel) => typeof channel !== 'string' || channel.length < 1
		|| channel.length > 128 || !/^[a-z0-9:-]+$/u.test(channel))) {
		throw new TypeError('Desktop audio codec IPC channels are invalid.');
	}
	if (new Set(channels).size !== channels.length) {
		throw new TypeError('Desktop audio codec IPC channels must be unique.');
	}
}

function requiredRequestId(value: unknown): string {
	if (typeof value !== 'string' || !REQUEST_ID.test(value)) {
		throw new TypeError('A desktop audio codec request ID is required.');
	}
	return value;
}

function owned<Owner extends object>(value: Owner): Owner {
	if (!value || typeof value !== 'object') throw new TypeError('A desktop renderer owner is required.');
	return value;
}

function abortReason(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}
