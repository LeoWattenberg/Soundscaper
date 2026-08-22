/* SPDX-License-Identifier: AGPL-3.0-only */

import { HelperContractViolationError } from './helper-wire-admission.ts';

export interface HelperMediaProxyRecipeGrant {
	readonly id: 'framescaper-native-prores-proxy-mov-v1';
	readonly width: number;
	readonly height: number;
}

const KEYS = Object.freeze(['id', 'width', 'height']);

export function validateHelperMediaProxyRecipeGrant(value: unknown): HelperMediaProxyRecipeGrant {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		return unsafe('A native media proxy recipe grant must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== KEYS.length || present.some((key) => !KEYS.includes(key))
		|| record.id !== 'framescaper-native-prores-proxy-mov-v1'
		|| !Number.isSafeInteger(record.width) || Number(record.width) < 2 || Number(record.width) > 1_280
		|| !Number.isSafeInteger(record.height) || Number(record.height) < 2 || Number(record.height) > 720
		|| Number(record.width) % 2 !== 0 || Number(record.height) % 2 !== 0) {
		return unsafe('A native media proxy grant requires the exact bounded even ProRes Proxy/MOV recipe.');
	}
	return Object.freeze({
		id: 'framescaper-native-prores-proxy-mov-v1',
		width: Number(record.width), height: Number(record.height),
	});
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}
