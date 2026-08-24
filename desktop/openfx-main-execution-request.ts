/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed main-only request for one exact legacy-V12 or selected-V14 OpenFX evaluation. */

import type { OfxRenderBackendV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import {
	OFX_RGBA_FRAME_MAXIMUM_BYTES,
	OFX_RGBA_FRAME_MAXIMUM_DIMENSION,
	OFX_RGBA_FRAME_MAXIMUM_ROW_BYTES,
	OFX_RGBA_FRAME_SET_MAXIMUM_BYTES,
} from './helper-contract.ts';
import {
	assertAuthenticatedOfxRetimerSourceTimeV1,
	type OfxRetimerSourceTimeV1,
} from '../src/common/editor/native-ofx-retimer-source-time.ts';
import {
	assertUnifiedExactRenderPlanWithDeferredTimingReferences,
	type UnifiedExactRenderPlanV12,
	type UnifiedExactRenderPlanV14,
} from '../src/common/editor/unified-exact-render-plan.ts';

export type FramescaperOpenFxExecutionPlan = UnifiedExactRenderPlanV12 | UnifiedExactRenderPlanV14;

export interface FramescaperOpenFxInputFrameV1 {
	readonly name: string;
	readonly sourceRef: string;
	readonly width: number;
	readonly height: number;
	readonly rowBytes: number;
	readonly rgba: Uint8Array;
}

export interface FramescaperOpenFxExecutionRequestV1 {
	readonly pluginHandle: string;
	readonly plan: FramescaperOpenFxExecutionPlan;
	readonly instanceId: string;
	readonly requestedBackend: OfxRenderBackendV1;
	readonly outputOrdinal: number;
	readonly inputs: readonly FramescaperOpenFxInputFrameV1[];
	readonly retimerSourceTime?: OfxRetimerSourceTimeV1 | null;
	readonly signal?: AbortSignal;
}

const HANDLE = /^[a-f\d]{40}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const REQUIRED_KEYS = Object.freeze([
	'pluginHandle', 'plan', 'instanceId', 'requestedBackend', 'outputOrdinal', 'inputs',
]);

export function framescaperOpenFxExecutionRequestV1(
	value: unknown,
) {
	const allowed = [...REQUIRED_KEYS, 'retimerSourceTime', 'signal'];
	const record = closedRecord(value, allowed, REQUIRED_KEYS, 'OpenFX execution request');
	const plan = record.plan;
	assertDeferredOpenFxPlan(plan);
	if (typeof record.pluginHandle !== 'string' || !HANDLE.test(record.pluginHandle)
		|| typeof record.instanceId !== 'string' || !ID.test(record.instanceId)
			|| typeof record.requestedBackend !== 'string'
			|| !['cpu', 'cuda', 'opengl', 'opencl', 'metal'].includes(record.requestedBackend)
			|| !Number.isSafeInteger(record.outputOrdinal) || Number(record.outputOrdinal) < 0
		|| Number(record.outputOrdinal) >= plan.output.frameCount
		|| !Array.isArray(record.inputs) || record.inputs.length > 16
		|| (record.signal !== undefined && !(record.signal instanceof AbortSignal))) {
		throw new TypeError('An OpenFX execution request has invalid bounded identity or inputs.');
	}
	if (record.retimerSourceTime !== undefined && record.retimerSourceTime !== null) {
		assertAuthenticatedOfxRetimerSourceTimeV1(record.retimerSourceTime);
		if (record.retimerSourceTime.outputOrdinal !== record.outputOrdinal) {
			throw new TypeError('An OpenFX Retimer SourceTime must bind the exact output ordinal.');
		}
	}
	let residentBytes = 0;
	const inputs = record.inputs.map((value_) => {
		const input = closedRecord(
			value_, ['name', 'sourceRef', 'width', 'height', 'rowBytes', 'rgba'],
			['name', 'sourceRef', 'width', 'height', 'rowBytes', 'rgba'],
			'OpenFX execution input',
		);
		if (!(input.rgba instanceof Uint8Array)
			|| Object.getPrototypeOf(input.rgba) !== Uint8Array.prototype
			|| !(input.rgba.buffer instanceof ArrayBuffer)
			|| typeof input.name !== 'string' || !ID.test(input.name)
			|| typeof input.sourceRef !== 'string' || !ID.test(input.sourceRef)
			|| !Number.isSafeInteger(input.width) || Number(input.width) < 1
			|| Number(input.width) > OFX_RGBA_FRAME_MAXIMUM_DIMENSION
			|| !Number.isSafeInteger(input.height) || Number(input.height) < 1
			|| Number(input.height) > OFX_RGBA_FRAME_MAXIMUM_DIMENSION
			|| !Number.isSafeInteger(input.rowBytes)
			|| Number(input.rowBytes) > OFX_RGBA_FRAME_MAXIMUM_ROW_BYTES
			|| input.rowBytes !== Number(input.width) * 4
			|| input.rgba.byteLength !== Number(input.rowBytes) * Number(input.height)
			|| input.rgba.byteLength > OFX_RGBA_FRAME_MAXIMUM_BYTES) {
			throw new TypeError('An OpenFX execution input is not an exact RGBA8 frame.');
		}
		residentBytes += input.rgba.byteLength;
		if (residentBytes > OFX_RGBA_FRAME_SET_MAXIMUM_BYTES) {
			throw new RangeError('The OpenFX execution input frame set exceeds its resident-byte bound.');
		}
		return Object.freeze({
			name: input.name,
			sourceRef: input.sourceRef,
			width: Number(input.width),
			height: Number(input.height),
			rowBytes: Number(input.rowBytes),
			rgba: new Uint8Array(input.rgba),
		});
		});
	if (inputs.some((input) => input.width !== plan.output.canvas.width
		|| input.height !== plan.output.canvas.height)) {
		throw new TypeError(`Each evaluated OpenFX input must match the exact V${String(plan.version)} output canvas.`);
	}
	return Object.freeze({
		pluginHandle: record.pluginHandle,
		plan,
		instanceId: record.instanceId,
		requestedBackend: record.requestedBackend as OfxRenderBackendV1,
		outputOrdinal: Number(record.outputOrdinal),
		inputs: Object.freeze(inputs),
		retimerSourceTime: (record.retimerSourceTime ?? null) as OfxRetimerSourceTimeV1 | null,
		...(record.signal ? { signal: record.signal as AbortSignal } : {}),
	});
}

function assertDeferredOpenFxPlan(value: unknown): asserts value is FramescaperOpenFxExecutionPlan {
	assertUnifiedExactRenderPlanWithDeferredTimingReferences(value);
	if (value.version !== 12 && value.version !== 14) {
		throw new RangeError('OpenFX execution admits only legacy plan V12 or selected plan V14.');
	}
}

function closedRecord(
	value: unknown,
	allowed: readonly string[],
	required: readonly string[],
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The ${label} must be one closed plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
		|| required.some((key) => !Object.hasOwn(value, key))) {
		throw new TypeError(`The ${label} has unsupported or missing fields.`);
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`The ${label}.${String(key)} must be an enumerable data property.`);
		}
	}
	return value as Record<string, unknown>;
}
