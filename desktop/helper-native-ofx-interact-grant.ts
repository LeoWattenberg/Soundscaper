/* SPDX-License-Identifier: AGPL-3.0-only */

/** Control-only isolated-host variant for one pathless offscreen OFX Interact update. */

import {
	framescaperOpenFxInteractRequestV1,
	type FramescaperOpenFxInteractRequestV1,
} from '../src/common/editor/native-ofx-interact-contract.ts';
import type {
	HelperExecutableGrant,
	HelperScratchGrant,
} from './helper-native-job-contract.ts';
import type { HelperOfxHostGrantValidators } from './helper-native-ofx-host-grant.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';

export interface HelperOfxInteractJobGrantV1 {
	readonly executable: HelperExecutableGrant;
	readonly pluginBinary: HelperExecutableGrant;
	readonly pluginFingerprint: string;
	readonly pluginId: string;
	readonly interact: FramescaperOpenFxInteractRequestV1;
	readonly scratch: HelperScratchGrant;
}

const KEYS = Object.freeze([
	'executable', 'pluginBinary', 'pluginFingerprint', 'pluginId', 'interact', 'scratch',
]);
const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;

export function validateHelperOfxInteractJobGrantV1(
	value: unknown,
	validators: Pick<HelperOfxHostGrantValidators, 'executable' | 'scratch'>,
): HelperOfxInteractJobGrantV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		return unsafe('An OpenFX Interact helper grant must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const actual = Object.keys(record);
	if (actual.length !== KEYS.length || actual.some((key) => !KEYS.includes(key))) {
		return unsafe('An OpenFX Interact helper grant must carry exactly its schema keys.');
	}
	const executable = validators.executable(record.executable, 'ofx-host');
	const pluginBinary = validators.executable(record.pluginBinary, 'ofx-plugin');
	if (typeof record.pluginId !== 'string' || !PLUGIN_ID.test(record.pluginId)) {
		return unsafe('An OpenFX Interact helper grant requires one canonical plug-in ID.');
	}
	if (record.pluginFingerprint !== `${record.pluginId}@${pluginBinary.sha256}`) {
		return unsafe('An OpenFX Interact helper grant does not bind its exact binary fingerprint.');
	}
	const interact = framescaperOpenFxInteractRequestV1(record.interact);
	if (interact.effect.pluginId !== record.pluginId
		|| interact.effect.binarySha256 !== pluginBinary.sha256) {
		return unsafe('An OpenFX Interact helper grant does not bind its authored effect fingerprint.');
	}
	return deepFreeze({
		executable,
		pluginBinary,
		pluginFingerprint: record.pluginFingerprint,
		pluginId: record.pluginId,
		interact,
		scratch: validators.scratch(record.scratch),
	});
}

export function isHelperOfxInteractJobGrantV1(
	value: unknown,
): value is HelperOfxInteractJobGrantV1 {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& Object.hasOwn(value, 'interact'));
}

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}
