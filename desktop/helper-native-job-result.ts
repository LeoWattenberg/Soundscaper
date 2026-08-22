/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed terminal results for contract-v1 media and OpenFX helper jobs. */

import {
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
	type HelperDataPlaneBinding,
	type HelperDataPlaneCompletion,
} from './helper-data-plane.ts';
import {
	assertHelperDataPlaneOutputCompletion,
	type HelperDataPlaneOutputReservation,
} from './helper-data-plane-output-reservation.ts';
import type {
	HelperMediaDecodeJobGrant,
	HelperMediaEncodeJobGrant,
	HelperMediaProxyJobGrant,
	HelperNativeFileIdentity,
	HelperNativeJobGrantByKind,
	HelperNativeJobKind,
	HelperOfxHostJobGrant,
	HelperOfxScanJobGrant,
	HelperOutputFileGrant,
} from './helper-native-job-contract.ts';
import {
	HelperContractViolationError,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';

export interface HelperTemporaryOutputResult {
	readonly temporaryPath: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: Readonly<HelperNativeFileIdentity>;
}

export interface HelperStreamOutputJobResult {
	readonly output: HelperDataPlaneCompletion;
}

export interface HelperFileOutputJobResult {
	readonly output: HelperTemporaryOutputResult;
}

export interface HelperOfxScanJobResult {
	readonly descriptor: HelperDataPlaneCompletion;
}

export interface HelperNativeJobResultByKind {
	readonly 'media-decode': HelperStreamOutputJobResult;
	readonly 'media-encode': HelperFileOutputJobResult;
	readonly 'media-render': HelperFileOutputJobResult;
	readonly 'media-proxy': HelperFileOutputJobResult;
	readonly 'ofx-scan': HelperOfxScanJobResult;
	readonly 'ofx-host': HelperStreamOutputJobResult;
}

const STREAM_RESULT_KEYS = Object.freeze(['output']);
const SCAN_RESULT_KEYS = Object.freeze(['descriptor']);
const TEMPORARY_OUTPUT_KEYS = Object.freeze(['temporaryPath', 'byteLength', 'sha256', 'identity']);
const COMPLETION_KEYS = Object.freeze(['streamId', 'byteLength', 'sha256']);
const IDENTITY_KEYS = Object.freeze(['dev', 'ino']);
const SHA256 = /^[a-f\d]{64}$/u;

export function validateHelperNativeJobResult<Kind extends HelperNativeJobKind>(
	kind: Kind,
	value: unknown,
	grant: HelperNativeJobGrantByKind[Kind],
): HelperNativeJobResultByKind[Kind] {
	assertHelperWireEnvelope(value);
	const record = plainRecord(value);
	if (kind === 'ofx-scan') {
		exactKeys(record, SCAN_RESULT_KEYS);
		return Object.freeze({
			descriptor: reservedStreamCompletion(
				record.descriptor, (grant as HelperOfxScanJobGrant).descriptor,
			),
		}) as HelperNativeJobResultByKind[Kind];
	}
	if (kind === 'media-decode' || kind === 'ofx-host') {
		exactKeys(record, STREAM_RESULT_KEYS);
		return Object.freeze({
			output: kind === 'media-decode'
				? streamCompletion(record.output, (grant as HelperMediaDecodeJobGrant).output)
				: reservedStreamCompletion(
					record.output, (grant as HelperOfxHostJobGrant).output.frame,
				),
		}) as HelperNativeJobResultByKind[Kind];
	}
	if (kind === 'media-encode' || kind === 'media-render' || kind === 'media-proxy') {
		exactKeys(record, STREAM_RESULT_KEYS);
		const output = (grant as HelperMediaEncodeJobGrant | HelperMediaProxyJobGrant).output;
		return Object.freeze({
			output: temporaryOutput(record.output, output),
		}) as HelperNativeJobResultByKind[Kind];
	}
	return malformed('The native helper result kind is not part of contract v1.');
}

function reservedStreamCompletion(
	value: unknown,
	reservation: HelperDataPlaneOutputReservation,
): HelperDataPlaneCompletion {
	return assertHelperDataPlaneOutputCompletion(value, reservation);
}

function streamCompletion(value: unknown, binding: HelperDataPlaneBinding): HelperDataPlaneCompletion {
	const record = plainRecord(value);
	exactKeys(record, COMPLETION_KEYS);
	if (record.streamId !== binding.streamId || record.byteLength !== binding.byteLength
		|| record.sha256 !== binding.sha256) {
		malformed('A helper stream result does not match its exact data-plane binding.');
	}
	return Object.freeze({
		streamId: binding.streamId,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
	});
}

function temporaryOutput(value: unknown, grant: HelperOutputFileGrant): HelperTemporaryOutputResult {
	const record = plainRecord(value);
	exactKeys(record, TEMPORARY_OUTPUT_KEYS);
	const byteLength = boundedBytes(record.byteLength);
	if (record.temporaryPath !== grant.temporaryPath || byteLength > grant.maximumBytes) {
		malformed('A helper file result exceeds or does not match its exact temporary-output grant.');
	}
	return Object.freeze({
		temporaryPath: grant.temporaryPath,
		byteLength,
		sha256: sha256(record.sha256),
		identity: identity(record.identity),
	});
}

function identity(value: unknown): Readonly<HelperNativeFileIdentity> {
	const record = plainRecord(value);
	exactKeys(record, IDENTITY_KEYS);
	if (!Number.isSafeInteger(record.dev) || Number(record.dev) < 0
		|| !Number.isSafeInteger(record.ino) || Number(record.ino) < 0) {
		malformed('A helper file result must carry a non-negative file identity.');
	}
	return Object.freeze({ dev: Number(record.dev), ino: Number(record.ino) });
}

function boundedBytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0
		|| Number(value) > HELPER_DATA_PLANE_MAXIMUM_BYTES) {
		malformed('A helper temporary output result must declare its bounded byte length.');
	}
	return Number(value);
}

function sha256(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		malformed('A helper file result must carry lowercase SHA-256.');
	}
	return value;
}

function plainRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		malformed('A helper native result must be a plain record.');
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		malformed('A helper native result must carry exactly its kind-specific schema keys.');
	}
}

function malformed(message: string): never {
	throw new HelperContractViolationError('malformed', message);
}
