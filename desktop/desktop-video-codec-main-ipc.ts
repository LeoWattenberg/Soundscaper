/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed IPC surface for owner-scoped main-process video sessions. */

import {
	DESKTOP_VIDEO_CODEC_MAXIMUM_INPUT_CHUNK_BYTES,
	DESKTOP_VIDEO_CODEC_MAXIMUM_OUTPUT_CHUNK_BYTES,
	normalizeDesktopVideoCodecOperationPlan,
} from './desktop-video-codec-operation-contract.js';
import type { ExternalFfmpegVideoOperationService } from './external-ffmpeg-video-operation-service.js';

export interface DesktopVideoCodecMainIpcChannels {
	readonly desktopVideoCodecCapabilities: string;
	readonly desktopVideoCodecBegin: string;
	readonly desktopVideoCodecWrite: string;
	readonly desktopVideoCodecClose: string;
	readonly desktopVideoCodecExecute: string;
	readonly desktopVideoCodecStat: string;
	readonly desktopVideoCodecRead: string;
	readonly desktopVideoCodecDelete: string;
	readonly desktopVideoCodecCancel: string;
}

export interface DesktopVideoCodecMainIpcOptions<Owner extends object> {
	readonly channels: DesktopVideoCodecMainIpcChannels;
	readonly handle: (
		channel: string,
		listener: (event: unknown, ...arguments_: unknown[]) => unknown,
	) => void;
	readonly removeHandler: (channel: string) => void;
	readonly ownerFor: (event: unknown) => Owner;
	readonly service: ExternalFfmpegVideoOperationService<Owner>;
}

export interface DesktopVideoCodecMainIpcRegistration<Owner extends object> {
	revokeOwner(owner: Owner): Promise<boolean>;
	dispose(): void;
}

const CHANNEL_FIELDS = Object.freeze([
	'desktopVideoCodecCapabilities', 'desktopVideoCodecBegin', 'desktopVideoCodecWrite',
	'desktopVideoCodecClose', 'desktopVideoCodecExecute', 'desktopVideoCodecStat',
	'desktopVideoCodecRead', 'desktopVideoCodecDelete', 'desktopVideoCodecCancel',
] as const);
const OPERATION_ID = /^desktop-video-[a-f0-9]{32}$/u;

export function registerDesktopVideoCodecMainIpc<Owner extends object>(
	options: DesktopVideoCodecMainIpcOptions<Owner>,
): DesktopVideoCodecMainIpcRegistration<Owner> {
	validateOptions(options);
	const registered: string[] = [];
	let disposed = false;
	const bind = (channel: string, listener: (event: unknown, ...arguments_: unknown[]) => unknown): void => {
		options.handle(channel, listener);
		registered.push(channel);
	};
	try {
		bind(options.channels.desktopVideoCodecCapabilities, (event, ...arguments_) => {
			assertCall(arguments_, 0, 'capabilities'); owned(options.ownerFor(event));
			return options.service.capabilities();
		});
		bind(options.channels.desktopVideoCodecBegin, (event, ...arguments_) => {
			assertCall(arguments_, 1, 'begin');
			return options.service.begin(
				owned(options.ownerFor(event)), normalizeDesktopVideoCodecOperationPlan(arguments_[0]),
			);
		});
		bind(options.channels.desktopVideoCodecWrite, (event, ...arguments_) => {
			assertCall(arguments_, 1, 'write');
			return options.service.writeInput(owned(options.ownerFor(event)), inputWrite(arguments_[0]));
		});
		bind(options.channels.desktopVideoCodecClose, (event, ...arguments_) => {
			assertCall(arguments_, 1, 'close');
			return options.service.closeInput(owned(options.ownerFor(event)), inputClose(arguments_[0]));
		});
		bind(options.channels.desktopVideoCodecExecute, (event, ...arguments_) => {
			assertCall(arguments_, 1, 'execute');
			return options.service.execute(owned(options.ownerFor(event)), idRequest(arguments_[0], 'execute'));
		});
		bind(options.channels.desktopVideoCodecStat, (event, ...arguments_) => {
			assertCall(arguments_, 1, 'stat');
			return options.service.statOutput(owned(options.ownerFor(event)), idRequest(arguments_[0], 'stat'));
		});
		bind(options.channels.desktopVideoCodecRead, (event, ...arguments_) => {
			assertCall(arguments_, 1, 'read');
			return options.service.readOutput(owned(options.ownerFor(event)), outputRead(arguments_[0]));
		});
		bind(options.channels.desktopVideoCodecDelete, (event, ...arguments_) => {
			assertCall(arguments_, 1, 'delete');
			return options.service.delete(owned(options.ownerFor(event)), idRequest(arguments_[0], 'delete'));
		});
		bind(options.channels.desktopVideoCodecCancel, (event, ...arguments_) => {
			assertCall(arguments_, 1, 'cancel');
			return options.service.cancel(owned(options.ownerFor(event)), operationId(arguments_[0]));
		});
	} catch (error) {
		for (const channel of registered) options.removeHandler(channel);
		throw error;
	}
	return Object.freeze({
		revokeOwner(owner: Owner) { return options.service.revokeOwner(owned(owner)); },
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const channel of registered) options.removeHandler(channel);
		},
	});
}

function inputWrite(value: unknown) {
	const request = closedRecord(value, ['operationId', 'role', 'offset', 'bytes'], 'write');
	const bytes = request.bytes;
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1
		|| bytes.byteLength > DESKTOP_VIDEO_CODEC_MAXIMUM_INPUT_CHUNK_BYTES) {
		throw new RangeError('Desktop video IPC input chunk is invalid.');
	}
	return Object.freeze({
		operationId: operationId(request.operationId), role: inputRole(request.role),
		offset: integer(request.offset, 0, Number.MAX_SAFE_INTEGER, 'input offset'), bytes,
	});
}

function inputClose(value: unknown) {
	const request = closedRecord(value, ['operationId', 'role', 'offset'], 'close');
	return Object.freeze({
		operationId: operationId(request.operationId), role: inputRole(request.role),
		offset: integer(request.offset, 0, Number.MAX_SAFE_INTEGER, 'input close offset'),
	});
}

function outputRead(value: unknown) {
	const request = closedRecord(value, ['operationId', 'offset', 'maximumBytes'], 'read');
	return Object.freeze({
		operationId: operationId(request.operationId),
		offset: integer(request.offset, 0, Number.MAX_SAFE_INTEGER, 'output offset'),
		maximumBytes: integer(
			request.maximumBytes, 1, DESKTOP_VIDEO_CODEC_MAXIMUM_OUTPUT_CHUNK_BYTES,
			'output maximum bytes',
		),
	});
}

function idRequest(value: unknown, action: string): string {
	return operationId(closedRecord(value, ['operationId'], action).operationId);
}

function closedRecord(value: unknown, fields: readonly string[], action: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))
		|| fields.some((key) => !Object.hasOwn(value, key))) {
		throw new TypeError(`Desktop video IPC ${action} request has an unsupported field or shape.`);
	}
	for (const key of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Desktop video IPC ${action} request must contain only data properties.`);
		}
	}
	return value as Record<string, unknown>;
}

function operationId(value: unknown): string {
	if (typeof value !== 'string' || !OPERATION_ID.test(value)) throw new TypeError('Desktop video operation ID is invalid.');
	return value;
}

function inputRole(value: unknown): 'video' | 'audio' {
	if (value !== 'video' && value !== 'audio') throw new TypeError('Desktop video input role is invalid.');
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop video IPC ${label} is invalid.`);
	}
	return value;
}

function assertCall(arguments_: readonly unknown[], count: number, action: string): void {
	if (arguments_.length !== count) throw new TypeError(`Desktop video IPC ${action} requires ${String(count)} arguments.`);
}

function owned<Owner extends object>(value: Owner): Owner {
	if (!value || typeof value !== 'object') throw new TypeError('A desktop renderer owner is required.');
	return value;
}

function validateOptions<Owner extends object>(options: DesktopVideoCodecMainIpcOptions<Owner>): void {
	if (!options || typeof options !== 'object' || !options.channels
		|| typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.ownerFor !== 'function' || !options.service
		|| CHANNEL_FIELDS.some((field) => typeof options.channels[field] !== 'string'
			|| !/^[a-z0-9:-]{1,128}$/u.test(options.channels[field]))) {
		throw new TypeError('Desktop video codec IPC options are invalid.');
	}
	const channels = CHANNEL_FIELDS.map((field) => options.channels[field]);
	if (new Set(channels).size !== channels.length) throw new TypeError('Desktop video codec IPC channels must be unique.');
}
