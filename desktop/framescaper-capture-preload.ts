/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS,
} from './framescaper-capture-main-channels.js';
import type {
	FramescaperCaptureDesktopGrantRequestV1,
	FramescaperCaptureDesktopGrantV1,
	FramescaperCaptureDesktopRole,
	FramescaperCaptureDesktopSourceListV1,
	FramescaperCaptureDesktopStatusV1,
} from './framescaper-capture-desktop-port.ts';

const CAPTURE_ROLES = ['camera', 'microphone', 'display', 'system-audio'] as const;
const SELECTION_MODES = ['source-list', 'system-picker', 'unavailable'] as const;
const SYSTEM_AUDIO = ['windows-loopback', 'unavailable'] as const;
const UNAVAILABLE_REASONS = ['unsupported-platform', 'unsupported-product'] as const;
const OPAQUE_ID = /^[a-f0-9]{32}$/u;

export interface FramescaperCaptureDesktopPreloadBridgeV1 {
	status(): Promise<Readonly<FramescaperCaptureDesktopStatusV1>>;
	listSources(generation: number): Promise<Readonly<FramescaperCaptureDesktopSourceListV1>>;
	grant(value: unknown): Promise<Readonly<FramescaperCaptureDesktopGrantV1>>;
	teardown(generation: number): Promise<boolean>;
}

interface FramescaperCaptureDesktopPreloadOptions {
	readonly invoke: (channel: string, value?: unknown) => Promise<unknown>;
}

/** Double-validating sandbox boundary for the Framescaper-only control plane. */
export function createFramescaperCaptureDesktopPreloadBridgeV1(
	value: FramescaperCaptureDesktopPreloadOptions,
): Readonly<FramescaperCaptureDesktopPreloadBridgeV1> {
	if (!value || typeof value !== 'object' || typeof value.invoke !== 'function') {
		throw new TypeError('Framescaper capture desktop preload requires an IPC invoke seam.');
	}
	const invoke = value.invoke;
	return Object.freeze({
		status: async () => validateStatus(await invoke(FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.status)),
		listSources: async (generationValue: number) => {
			const generation = positiveGeneration(generationValue);
			return validateSourceList(
				await invoke(FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.listSources, generation),
				generation,
			);
		},
		grant: async (requestValue: unknown) => {
			const request = validateGrantRequest(requestValue);
			return validateGrant(
				await invoke(FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.grant, request),
				request,
			);
		},
		teardown: async (generationValue: number) => {
			const result = await invoke(
				FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.teardown,
				positiveGeneration(generationValue),
			);
			if (typeof result !== 'boolean') throw new TypeError('Malformed capture desktop teardown result.');
			return result;
		},
	});
}

function validateStatus(value: unknown): Readonly<FramescaperCaptureDesktopStatusV1> {
	const record = closedRecord(value, [
		'version', 'available', 'unavailableReason', 'selectionMode', 'systemAudio',
		'sourceLimit', 'sourceListTtlMs', 'grantTtlMs',
	], 'Capture desktop status');
	if (record.version !== 1 || typeof record.available !== 'boolean'
		|| !SELECTION_MODES.includes(record.selectionMode as typeof SELECTION_MODES[number])
		|| !SYSTEM_AUDIO.includes(record.systemAudio as typeof SYSTEM_AUDIO[number])
		|| record.sourceLimit !== 64 || record.sourceListTtlMs !== 300_000
		|| record.grantTtlMs !== 15_000) {
		throw new TypeError('Malformed capture desktop status.');
	}
	const unavailableReason = record.unavailableReason;
	if (unavailableReason !== null
		&& !UNAVAILABLE_REASONS.includes(unavailableReason as typeof UNAVAILABLE_REASONS[number])) {
		throw new TypeError('Malformed capture desktop unavailable reason.');
	}
	if (record.available !== (unavailableReason === null)
		|| (record.available && record.selectionMode === 'unavailable')
		|| (!record.available && record.selectionMode !== 'unavailable')) {
		throw new TypeError('Contradictory capture desktop status.');
	}
	return Object.freeze({
		version: 1,
		available: record.available,
		unavailableReason: unavailableReason as FramescaperCaptureDesktopStatusV1['unavailableReason'],
		selectionMode: record.selectionMode as FramescaperCaptureDesktopStatusV1['selectionMode'],
		systemAudio: record.systemAudio as FramescaperCaptureDesktopStatusV1['systemAudio'],
		sourceLimit: 64,
		sourceListTtlMs: 300_000,
		grantTtlMs: 15_000,
	});
}

function validateSourceList(
	value: unknown,
	generation: number,
): Readonly<FramescaperCaptureDesktopSourceListV1> {
	const record = closedRecord(
		value,
		['generation', 'selectionMode', 'expiresAtMs', 'sources'],
		'Capture desktop source list',
	);
	if (record.generation !== generation || record.selectionMode !== 'source-list'
		|| !Number.isSafeInteger(record.expiresAtMs) || Number(record.expiresAtMs) < 0
		|| !Array.isArray(record.sources) || record.sources.length > 64) {
		throw new TypeError('Malformed capture desktop source list.');
	}
	const tokens = new Set<string>();
	const sources = record.sources.map((valueAtIndex, index) => {
		const source = closedRecord(valueAtIndex, ['token', 'name', 'kind'],
			`Capture desktop source list[${String(index)}]`);
		const token = opaqueId(source.token);
		if (tokens.has(token)) throw new TypeError('Capture desktop source tokens must be unique.');
		tokens.add(token);
		if (typeof source.name !== 'string' || !source.name || source.name.length > 160
			|| (source.kind !== 'screen' && source.kind !== 'window')) {
			throw new TypeError('Malformed capture desktop source descriptor.');
		}
		return Object.freeze({ token, name: source.name, kind: source.kind });
	});
	return Object.freeze({
		generation,
		selectionMode: 'source-list',
		expiresAtMs: Number(record.expiresAtMs),
		sources: Object.freeze(sources),
	});
}

function validateGrantRequest(value: unknown): Readonly<FramescaperCaptureDesktopGrantRequestV1> {
	const record = closedRecord(value, ['generation', 'roles', 'sourceToken'], 'Capture desktop grant request');
	const generation = positiveGeneration(record.generation);
	if (!Array.isArray(record.roles) || record.roles.length === 0 || record.roles.length > 4) {
		throw new TypeError('Capture desktop grant roles are invalid.');
	}
	const roles = record.roles.map((role) => {
		if (!CAPTURE_ROLES.includes(role as FramescaperCaptureDesktopRole)) {
			throw new TypeError('Capture desktop grant role is invalid.');
		}
		return role as FramescaperCaptureDesktopRole;
	});
	if (new Set(roles).size !== roles.length) throw new TypeError('Capture desktop grant roles must be unique.');
	if (roles.includes('system-audio') && !roles.includes('display')) {
		throw new TypeError('Capture desktop system audio requires display.');
	}
	const sourceToken = record.sourceToken === null ? null : opaqueId(record.sourceToken);
	return Object.freeze({ generation, roles: Object.freeze(roles), sourceToken });
}

function validateGrant(
	value: unknown,
	request: Readonly<FramescaperCaptureDesktopGrantRequestV1>,
): Readonly<FramescaperCaptureDesktopGrantV1> {
	const record = closedRecord(
		value,
		['grantId', 'generation', 'expiresAtMs', 'roles'],
		'Capture desktop grant',
	);
	if (record.generation !== request.generation || !Number.isSafeInteger(record.expiresAtMs)
		|| Number(record.expiresAtMs) < 0 || !Array.isArray(record.roles)
		|| record.roles.length !== request.roles.length
		|| record.roles.some((role, index) => role !== request.roles[index])) {
		throw new TypeError('Malformed capture desktop grant.');
	}
	return Object.freeze({
		grantId: opaqueId(record.grantId),
		generation: request.generation,
		expiresAtMs: Number(record.expiresAtMs),
		roles: Object.freeze([...request.roles]),
	});
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function positiveGeneration(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError('Capture desktop generation must be a positive safe integer.');
	}
	return Number(value);
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError('Capture desktop opaque token is invalid.');
	}
	return value;
}
