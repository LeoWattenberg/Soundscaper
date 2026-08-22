/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact V12 graph/input/invocation binding for one OpenFX helper render. */

import {
	assertOfxHostInvocationV1,
	type OfxHostInvocationV1,
} from '../src/common/editor/native-ofx-host-contract.ts';
import type { HelperDataPlaneBinding } from './helper-data-plane.ts';
import {
	type HelperDataPlaneOutputReservation,
	validateHelperDataPlaneOutputReservation,
} from './helper-data-plane-output-reservation.ts';
import type {
	HelperExecutableGrant,
	HelperScratchGrant,
} from './helper-native-job-contract.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';

export interface HelperOfxInputFrameGrant {
	/** Exact OpenFX input name carried by the V12 node. */
	readonly name: string;
	/** Project-owned source or evaluated-node identity, never a path. */
	readonly sourceRef: string;
	readonly pixelFormat: 'rgba8';
	readonly width: number;
	readonly height: number;
	readonly rowBytes: number;
	/** Exact authenticated frame stream for this named input. */
	readonly frame: HelperDataPlaneBinding;
}

export interface HelperOfxOutputFrameGrant {
	readonly pixelFormat: 'rgba8';
	readonly width: number;
	readonly height: number;
	readonly rowBytes: number;
	readonly frame: HelperDataPlaneOutputReservation & Readonly<{ exactByteLength: number }>;
}

export interface HelperOfxHostJobGrant {
	readonly executable: HelperExecutableGrant;
	readonly pluginBinary: HelperExecutableGrant;
	readonly invocation: OfxHostInvocationV1;
	readonly plan: HelperDataPlaneBinding;
	readonly inputs: readonly HelperOfxInputFrameGrant[];
	readonly output: HelperOfxOutputFrameGrant;
	readonly scratch: HelperScratchGrant;
}

export interface HelperOfxHostGrantValidators {
	readonly executable: (value: unknown, role: 'ofx-host' | 'ofx-plugin') => HelperExecutableGrant;
	readonly dataBinding: (
		value: unknown,
		direction: HelperDataPlaneBinding['direction'],
		label: string,
	) => HelperDataPlaneBinding;
	readonly scratch: (value: unknown) => HelperScratchGrant;
}

const HOST_KEYS = Object.freeze([
	'executable', 'pluginBinary', 'invocation', 'plan', 'inputs', 'output', 'scratch',
]);
const INPUT_KEYS = Object.freeze([
	'name', 'sourceRef', 'pixelFormat', 'width', 'height', 'rowBytes', 'frame',
]);
const OUTPUT_KEYS = Object.freeze(['pixelFormat', 'width', 'height', 'rowBytes', 'frame']);
const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const SOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const MAXIMUM_INPUTS = 16;
export const OFX_RGBA_FRAME_MAXIMUM_DIMENSION = 16_384;
export const OFX_RGBA_FRAME_MAXIMUM_ROW_BYTES = 64 * 1024;
export const OFX_RGBA_FRAME_MAXIMUM_BYTES = 256 * 1024 * 1024;
export const OFX_RGBA_FRAME_SET_MAXIMUM_BYTES = 512 * 1024 * 1024;

export function validateHelperOfxHostJobGrant(
	value: unknown,
	validators: HelperOfxHostGrantValidators,
): HelperOfxHostJobGrant {
	const record = exactRecord(value, HOST_KEYS);
	const invocation = snapshotInvocation(record.invocation);
	const inputs = inputFrames(record.inputs, validators);
	const output = outputFrame(record.output);
	const plan = validators.dataBinding(record.plan, 'host-to-helper', 'plan');
	const pluginBinary = validators.executable(record.pluginBinary, 'ofx-plugin');
	if (pluginBinary.sha256 !== invocation.pluginBinarySha256) {
		unsafe('An OpenFX host grant binary digest does not match its invocation fingerprint.');
	}
	if (plan.sha256 !== invocation.unifiedPlanSha256) {
		unsafe('An OpenFX host grant plan digest does not match its exact V12 invocation.');
	}
	const inputStreamIds = inputs.map(({ frame }) => frame.streamId);
	if (inputStreamIds.length !== invocation.inputFrameStreamIds.length
		|| inputStreamIds.some((streamId, index) => streamId !== invocation.inputFrameStreamIds[index])) {
		unsafe('An OpenFX host invocation does not bind its exact ordered named input streams.');
	}
	if (invocation.outputFrameStreamId !== output.frame.streamId) {
		unsafe('An OpenFX host invocation does not bind its exact output frame stream.');
	}
	const streamIds = [plan.streamId, ...inputStreamIds, output.frame.streamId];
	if (new Set(streamIds).size !== streamIds.length) {
		unsafe('An OpenFX host grant must use distinct plan, input, and output stream identities.');
	}
	const residentBytes = inputs.reduce((total, input) => total + input.frame.byteLength, 0)
		+ (output.frame.exactByteLength ?? output.frame.maximumByteLength);
	if (residentBytes > OFX_RGBA_FRAME_SET_MAXIMUM_BYTES) {
		unsafe('An OpenFX host grant exceeds its bounded resident RGBA frame set.');
	}
	return Object.freeze({
		executable: validators.executable(record.executable, 'ofx-host'),
		pluginBinary,
		invocation,
		plan,
		inputs,
		output,
		scratch: validators.scratch(record.scratch),
	});
}

function snapshotInvocation(value: unknown): OfxHostInvocationV1 {
	assertOfxHostInvocationV1(value);
	return deepFreeze(JSON.parse(JSON.stringify(value)) as OfxHostInvocationV1);
}

function inputFrames(
	value: unknown,
	validators: HelperOfxHostGrantValidators,
): readonly HelperOfxInputFrameGrant[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_INPUTS) {
		unsafe(`An OpenFX host grant admits at most ${String(MAXIMUM_INPUTS)} named inputs.`);
	}
	const names = new Set<string>();
	return Object.freeze(value.map((candidate): HelperOfxInputFrameGrant => {
		const record = exactRecord(candidate, INPUT_KEYS);
		if (typeof record.name !== 'string' || !INPUT_NAME.test(record.name)
			|| names.has(record.name)) {
			unsafe('An OpenFX host grant requires unique canonical input names.');
		}
		if (typeof record.sourceRef !== 'string' || !SOURCE_REF.test(record.sourceRef)) {
			unsafe('An OpenFX host grant requires a project-owned input source identity.');
		}
		names.add(record.name);
		return Object.freeze({
			name: record.name,
			sourceRef: record.sourceRef,
			...inputRgbaFrame(record, validators),
		});
	}));
}

function outputFrame(
	value: unknown,
): HelperOfxOutputFrameGrant {
	const record = exactRecord(value, OUTPUT_KEYS);
	const frame = validateHelperDataPlaneOutputReservation(record.frame);
	if (frame.exactByteLength === null || frame.maximumByteLength !== frame.exactByteLength) {
		unsafe('An OpenFX output frame requires an exact reserved RGBA byte length.');
	}
	const exactFrame = frame as HelperOfxOutputFrameGrant['frame'];
	return Object.freeze({
		...rgbaGeometry(record, exactFrame.exactByteLength, 'OpenFX output frame'),
		frame: exactFrame,
	});
}

function inputRgbaFrame(
	record: Record<string, unknown>,
	validators: HelperOfxHostGrantValidators,
): Omit<HelperOfxInputFrameGrant, 'name' | 'sourceRef'> {
	const frame = validators.dataBinding(record.frame, 'host-to-helper', 'OpenFX input frame');
	return { ...rgbaGeometry(record, frame.byteLength, 'OpenFX input frame'), frame };
}

function rgbaGeometry(
	record: Record<string, unknown>,
	byteLength: number,
	label: string,
): Omit<HelperOfxOutputFrameGrant, 'frame'> {
	const width = positiveInteger(record.width, `${label} width`, OFX_RGBA_FRAME_MAXIMUM_DIMENSION);
	const height = positiveInteger(record.height, `${label} height`, OFX_RGBA_FRAME_MAXIMUM_DIMENSION);
	const rowBytes = positiveInteger(record.rowBytes, `${label} rowBytes`, OFX_RGBA_FRAME_MAXIMUM_ROW_BYTES);
	if (record.pixelFormat !== 'rgba8' || rowBytes < width * 4 || rowBytes % 4 !== 0
		|| rowBytes * height !== byteLength || byteLength > OFX_RGBA_FRAME_MAXIMUM_BYTES) {
		unsafe(`An ${label} requires exact bounded RGBA8 dimensions, row bytes, and byte length.`);
	}
	return { pixelFormat: 'rgba8', width, height, rowBytes };
}

function positiveInteger(value: unknown, label: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		unsafe(`An ${label} is outside its positive integer bound.`);
	}
	return Number(value);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		unsafe('An OpenFX helper grant must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		unsafe('An OpenFX helper grant must carry exactly its closed schema keys.');
	}
	return record;
}

function deepFreeze<Value>(value: Value): Value {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
	return Object.freeze(value);
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}
