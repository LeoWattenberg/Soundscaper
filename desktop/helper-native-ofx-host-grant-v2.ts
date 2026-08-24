/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertOfxHostInvocationV2, type OfxHostInvocationV2 } from '../src/common/editor/native-ofx-host-contract-v2.ts';
import {
	validateHelperOfxHostJobGrant,
	type HelperOfxHostGrantValidators,
	type HelperOfxHostJobGrant,
} from './helper-native-ofx-host-grant.ts';
import {
	isHelperOfxInteractJobGrantV1,
	validateHelperOfxInteractJobGrantV1,
	type HelperOfxInteractJobGrantV1,
} from './helper-native-ofx-interact-grant.ts';

export interface HelperOfxHostJobGrantV2 extends Omit<HelperOfxHostJobGrant, 'invocation'> {
	readonly invocation: OfxHostInvocationV2;
}

export type HelperOfxRenderHostJobGrantV1OrV2 =
	| HelperOfxHostJobGrant
	| HelperOfxHostJobGrantV2;

export type HelperOfxHostJobGrantV1OrV2 =
	| HelperOfxRenderHostJobGrantV1OrV2
	| HelperOfxInteractJobGrantV1;

/** Dispatch only on the invocation's own, enumerable schemaVersion data field. */
export function validateHelperOfxHostJobGrantV1OrV2(
	value: unknown,
	validators: HelperOfxHostGrantValidators,
): HelperOfxHostJobGrantV1OrV2 {
	if (isHelperOfxInteractJobGrantV1(value)) {
		return validateHelperOfxInteractJobGrantV1(value, validators);
	}
	const version = invocationSchemaVersion(value);
	if (version === 1) return validateHelperOfxHostJobGrant(value, validators);
	if (version === 2) return validateHelperOfxHostJobGrantV2(value, validators);
	throw new RangeError('An OFX helper invocation schema version is unsupported.');
}

/** Validate the complete bounded frame grant while retaining only V14 invocation authority. */
export function validateHelperOfxHostJobGrantV2(
	value: unknown,
	validators: HelperOfxHostGrantValidators,
): HelperOfxHostJobGrantV2 {
	const record = cloneRecord(value);
	assertOfxHostInvocationV2(record.invocation);
	const invocation = structuredClone(record.invocation) as unknown as OfxHostInvocationV2;
	const legacyValidationShape = {
		...record,
		invocation: {
			...structuredClone(invocation),
			schemaVersion: 1,
			unifiedPlanVersion: 12,
		},
	};
	const admitted = validateHelperOfxHostJobGrant(legacyValidationShape, validators);
	if (admitted.plan.sha256 !== invocation.unifiedPlanSha256
		|| admitted.pluginBinary.sha256 !== invocation.pluginBinarySha256) {
		throw new Error('An OFX V14 helper grant changed its plan or plug-in digest.');
	}
	return deepFreeze({ ...admitted, invocation }) as HelperOfxHostJobGrantV2;
}

function cloneRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('An OFX V14 helper grant must be an object.');
	return structuredClone(value) as Record<string, unknown>;
}

function invocationSchemaVersion(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An OFX helper grant must be an object.');
	}
	const invocationDescriptor = Object.getOwnPropertyDescriptor(value, 'invocation');
	if (!invocationDescriptor?.enumerable || !Object.hasOwn(invocationDescriptor, 'value')) {
		throw new TypeError('An OFX helper grant requires an invocation data field.');
	}
	const invocation = invocationDescriptor.value;
	if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) {
		throw new TypeError('An OFX helper invocation must be an object.');
	}
	const versionDescriptor = Object.getOwnPropertyDescriptor(invocation, 'schemaVersion');
	if (!versionDescriptor?.enumerable || !Object.hasOwn(versionDescriptor, 'value')) {
		throw new TypeError('An OFX helper invocation requires a schemaVersion data field.');
	}
	return versionDescriptor.value;
}
function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
