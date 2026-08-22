/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact scanner authority with a digest-on-completion descriptor reservation. */

import {
	type HelperDataPlaneOutputReservation,
	validateHelperDataPlaneOutputReservation,
} from './helper-data-plane-output-reservation.ts';
import type {
	HelperExecutableGrant,
	HelperScratchGrant,
} from './helper-native-job-contract.ts';

export interface HelperOfxScanJobGrant {
	readonly executable: HelperExecutableGrant;
	readonly pluginBinary: HelperExecutableGrant;
	readonly descriptor: HelperDataPlaneOutputReservation;
	readonly scratch: HelperScratchGrant;
}

export interface HelperOfxScanGrantValidators {
	readonly executable: (
		value: unknown,
		role: 'ofx-scanner' | 'ofx-plugin',
	) => HelperExecutableGrant;
	readonly scratch: (value: unknown) => HelperScratchGrant;
}

const KEYS = Object.freeze(['executable', 'pluginBinary', 'descriptor', 'scratch']);

export function validateHelperOfxScanJobGrant(
	value: unknown,
	validators: HelperOfxScanGrantValidators,
): HelperOfxScanJobGrant {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError('An OpenFX scan grant must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== KEYS.length || keys.some((key) => !KEYS.includes(key))) {
		throw new TypeError('An OpenFX scan grant must carry exactly its closed schema keys.');
	}
	return Object.freeze({
		executable: validators.executable(record.executable, 'ofx-scanner'),
		pluginBinary: validators.executable(record.pluginBinary, 'ofx-plugin'),
		descriptor: validateHelperDataPlaneOutputReservation(record.descriptor),
		scratch: validators.scratch(record.scratch),
	});
}
