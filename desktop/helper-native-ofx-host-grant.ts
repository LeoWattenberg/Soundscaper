/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact V12 graph/input/invocation binding for one OpenFX helper render. */

import {
	assertOfxHostInvocationV1,
	type OfxHostInvocationV1,
} from '../src/common/editor/native-ofx-host-contract.ts';
import type { HelperDataPlaneBinding } from './helper-data-plane.ts';
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
	/** Exact authenticated frame stream for this named input. */
	readonly frame: HelperDataPlaneBinding;
}

export interface HelperOfxHostJobGrant {
	readonly executable: HelperExecutableGrant;
	readonly pluginBinary: HelperExecutableGrant;
	readonly invocation: OfxHostInvocationV1;
	readonly plan: HelperDataPlaneBinding;
	readonly inputs: readonly HelperOfxInputFrameGrant[];
	readonly output: HelperDataPlaneBinding;
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
const INPUT_KEYS = Object.freeze(['name', 'sourceRef', 'frame']);
const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const SOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const MAXIMUM_INPUTS = 16;

export function validateHelperOfxHostJobGrant(
	value: unknown,
	validators: HelperOfxHostGrantValidators,
): HelperOfxHostJobGrant {
	const record = exactRecord(value, HOST_KEYS);
	const invocation = snapshotInvocation(record.invocation);
	const inputs = inputFrames(record.inputs, validators);
	const output = validators.dataBinding(record.output, 'helper-to-host', 'output');
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
	if (invocation.outputFrameStreamId !== output.streamId) {
		unsafe('An OpenFX host invocation does not bind its exact output frame stream.');
	}
	const streamIds = [plan.streamId, ...inputStreamIds, output.streamId];
	if (new Set(streamIds).size !== streamIds.length) {
		unsafe('An OpenFX host grant must use distinct plan, input, and output stream identities.');
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
			frame: validators.dataBinding(record.frame, 'host-to-helper', 'OpenFX input frame'),
		});
	}));
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
