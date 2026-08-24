/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, pathless renderer/main/native contract for one authored OFX Interact update. */

import { fingerprintNativeMediaPlan } from './native-media-plan-canonical-form.ts';
import {
	assertOfxEffectBindingV1,
	OFX_BINDING_MAXIMUM_PARAMETERS,
	type OfxParameterStateV1,
} from './native-ofx-binding.ts';
import { OFX_CONTEXTS, type OfxContext } from './native-ofx-descriptor.ts';
import {
	OfxHostContractError,
	normalizeOfxInteractEventV1,
	type OfxInteractEventV1,
} from './native-ofx-host-contract.ts';
import {
	assertOfxEffectStateV26,
	type OfxEffectStateV26,
} from './native-ofx-state-v26.ts';

export const OFX_INTERACT_SURFACE_DIMENSION_V1 = 64;
export const OFX_INTERACT_SURFACE_BYTES_V1 = 64 * 64 * 4;
export const OFX_INTERACT_MAXIMUM_EVENTS_V1 = 256;

export interface FramescaperOpenFxInteractProjectV1 {
	readonly id: string;
	readonly revision: number;
}

export interface FramescaperOpenFxInteractParameterMutationV1 {
	/** A complete replacement for one existing, descriptor-matched parameter. */
	readonly parameter: OfxParameterStateV1;
}

export interface FramescaperOpenFxInteractRequestV1 {
	readonly protocolVersion: 1;
	readonly project: FramescaperOpenFxInteractProjectV1;
	readonly pluginHandle: string;
	/** The exact authored instance at `project.revision`, including current typed state. */
	readonly effect: OfxEffectStateV26;
	readonly effectStateSha256: string;
	readonly context: OfxContext;
	readonly target: 'overlay' | 'custom-parameter';
	readonly parameterName: string | null;
	readonly events: readonly OfxInteractEventV1[];
}

export interface FramescaperOpenFxInteractResultV1 {
	readonly protocolVersion: 1;
	readonly project: FramescaperOpenFxInteractProjectV1;
	readonly instanceId: string;
	readonly effectStateSha256: string;
	readonly width: 64;
	readonly height: 64;
	readonly rowBytes: 256;
	readonly target: FramescaperOpenFxInteractRequestV1['target'];
	readonly parameterName: string | null;
	readonly acceptedSequences: readonly number[];
	readonly redrawRequested: boolean;
	/** `retained` is a valid ReplyDefault/no-draw outcome; consumers ignore its zero buffer. */
	readonly surfaceDisposition: 'drawn' | 'retained';
	readonly parameterMutations: readonly FramescaperOpenFxInteractParameterMutationV1[];
	readonly rgba: Uint8Array;
}

const HANDLE = /^[a-f\d]{40}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const PARAMETER = /^[A-Za-z_][A-Za-z\d_]{0,63}$/u;
const SHA256 = /^[a-f\d]{64}$/u;

export function framescaperOpenFxInteractRequestV1(
	value: unknown,
): FramescaperOpenFxInteractRequestV1 {
	const record = plainRecord(value, 'OpenFX Interact request');
	exactKeys(record, [
		'protocolVersion', 'project', 'pluginHandle', 'effect', 'effectStateSha256', 'context', 'target',
		'parameterName', 'events',
	], 'OpenFX Interact request');
	if (record.protocolVersion !== 1) throw contractError('The OpenFX Interact protocol is unsupported.');
	const project = projectIdentity(record.project, 'request');
	if (typeof record.pluginHandle !== 'string' || !HANDLE.test(record.pluginHandle)) {
		throw contractError('An OpenFX Interact request requires one opaque plug-in handle.');
	}
	const effect = structuredClone(record.effect);
	try { assertOfxEffectStateV26(effect); }
	catch (cause) { throw contractError(errorMessage(cause, 'The authored OpenFX effect is malformed.')); }
	if (record.effectStateSha256 !== framescaperOpenFxInteractEffectStateSha256V1(effect)) {
		throw contractError('An OpenFX Interact request must fingerprint its exact authored effect state.');
	}
	if (!(OFX_CONTEXTS as readonly unknown[]).includes(record.context)
		|| record.context !== effect.context) {
		throw contractError('An OpenFX Interact context must match the authored effect instance.');
	}
	if (record.target !== 'overlay' && record.target !== 'custom-parameter') {
		throw contractError('An OpenFX Interact target is unsupported.');
	}
	const parameterName = record.parameterName;
	if ((record.target === 'overlay' && parameterName !== null)
		|| (record.target === 'custom-parameter'
			&& (typeof parameterName !== 'string' || !PARAMETER.test(parameterName)
				|| !effect.parameters.some(({ name, type }) => name === parameterName && type === 'custom')))) {
		throw contractError('An OpenFX custom-parameter Interact requires one authored custom parameter.');
	}
	if (!Array.isArray(record.events) || record.events.length > OFX_INTERACT_MAXIMUM_EVENTS_V1
		|| Reflect.ownKeys(record.events).length !== record.events.length + 1) {
		throw contractError('An OpenFX Interact event batch must be a bounded dense array.');
	}
	const events = record.events.map(normalizeOfxInteractEventV1);
	for (let index = 1; index < events.length; index += 1) {
		if (events[index]!.sequence <= events[index - 1]!.sequence) {
			throw contractError('OpenFX Interact event sequences must be strictly increasing.');
		}
	}
	return deepFreeze({
		protocolVersion: 1, project, pluginHandle: record.pluginHandle, effect,
		effectStateSha256: record.effectStateSha256,
		context: record.context as OfxContext, target: record.target,
		parameterName: parameterName as string | null, events: Object.freeze(events),
	});
}

export function framescaperOpenFxInteractResultV1(
	value: unknown,
	expectedValue?: FramescaperOpenFxInteractRequestV1,
): FramescaperOpenFxInteractResultV1 {
	const record = plainRecord(value, 'OpenFX Interact result');
	exactKeys(record, [
		'protocolVersion', 'project', 'instanceId', 'effectStateSha256', 'width', 'height',
		'rowBytes', 'target', 'parameterName', 'acceptedSequences', 'redrawRequested',
		'surfaceDisposition', 'parameterMutations', 'rgba',
	], 'OpenFX Interact result');
	if (record.protocolVersion !== 1 || record.width !== 64 || record.height !== 64
		|| record.rowBytes !== 256) {
		throw contractError('An OpenFX Interact result must be one exact 64 by 64 RGBA surface.');
	}
	const project = projectIdentity(record.project, 'result');
	if (typeof record.instanceId !== 'string' || !ID.test(record.instanceId)
		|| typeof record.effectStateSha256 !== 'string' || !SHA256.test(record.effectStateSha256)) {
		throw contractError('An OpenFX Interact result has malformed authored-effect authority.');
	}
	if (record.target !== 'overlay' && record.target !== 'custom-parameter') {
		throw contractError('An OpenFX Interact result target is unsupported.');
	}
	if ((record.target === 'overlay' && record.parameterName !== null)
		|| (record.target === 'custom-parameter'
			&& (typeof record.parameterName !== 'string' || !PARAMETER.test(record.parameterName)))) {
		throw contractError('An OpenFX Interact result parameter identity is malformed.');
	}
	if (typeof record.redrawRequested !== 'boolean'
		|| (record.surfaceDisposition !== 'drawn' && record.surfaceDisposition !== 'retained')) {
		throw contractError('An OpenFX Interact result must report its redraw and surface disposition.');
	}
	const acceptedSequences = acceptedSequenceList(record.acceptedSequences);
	const parameterMutations = mutationList(record.parameterMutations);
	if (!(record.rgba instanceof Uint8Array)
		|| Object.getPrototypeOf(record.rgba) !== Uint8Array.prototype
		|| record.rgba.byteOffset !== 0 || record.rgba.buffer.byteLength !== record.rgba.byteLength
		|| record.rgba.byteLength !== OFX_INTERACT_SURFACE_BYTES_V1) {
		throw contractError('An OpenFX Interact result must carry one tightly backed 64 by 64 RGBA buffer.');
	}
	if (record.surfaceDisposition === 'retained' && record.rgba.some((byte) => byte !== 0)) {
		throw contractError('A retained OpenFX Interact surface must not smuggle replacement pixels.');
	}
	const expected = expectedValue === undefined
		? null : framescaperOpenFxInteractRequestV1(expectedValue);
	if (expected !== null) validateResultAuthority({
		project, instanceId: record.instanceId, effectStateSha256: record.effectStateSha256,
		target: record.target, parameterName: record.parameterName as string | null,
		acceptedSequences, parameterMutations,
	}, expected);
	return deepFreeze({
		protocolVersion: 1, project, instanceId: record.instanceId,
		effectStateSha256: record.effectStateSha256, width: 64, height: 64, rowBytes: 256,
		target: record.target, parameterName: record.parameterName as string | null,
		acceptedSequences, redrawRequested: record.redrawRequested,
		surfaceDisposition: record.surfaceDisposition, parameterMutations,
		rgba: new Uint8Array(record.rgba),
	});
}

export function framescaperOpenFxInteractEffectStateSha256V1(
	effect: OfxEffectStateV26,
): string {
	assertOfxEffectStateV26(effect);
	return fingerprintNativeMediaPlan(effect).sha256;
}

export function applyFramescaperOpenFxInteractMutationsV1(
	effectValue: OfxEffectStateV26,
	mutationsValue: readonly FramescaperOpenFxInteractParameterMutationV1[],
): OfxEffectStateV26 {
	const effect = structuredClone(effectValue);
	assertOfxEffectStateV26(effect);
	const mutations = mutationList(mutationsValue);
	const byName = new Map(mutations.map(({ parameter }) => [parameter.name, parameter]));
	for (const mutation of mutations) {
		const authored = effect.parameters.find(({ name }) => name === mutation.parameter.name);
		if (!authored || authored.type !== mutation.parameter.type
			|| standardParameter(effect.context, mutation.parameter.name)) {
			throw contractError('An OpenFX Interact mutation exceeds the authored parameter identity.');
		}
	}
	const updated = structuredClone({
		...effect,
		parameters: effect.parameters.map((parameter) => byName.get(parameter.name) ?? parameter),
	});
	assertOfxEffectStateV26(updated);
	return deepFreeze(updated);
}

function mutationList(value: unknown): readonly FramescaperOpenFxInteractParameterMutationV1[] {
	if (!Array.isArray(value) || value.length > OFX_BINDING_MAXIMUM_PARAMETERS
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw contractError('OpenFX Interact parameter mutations must be a bounded dense array.');
	}
	const names = new Set<string>();
	return Object.freeze(value.map((entry) => {
		const mutation = plainRecord(entry, 'OpenFX Interact parameter mutation');
		exactKeys(mutation, ['parameter'], 'OpenFX Interact parameter mutation');
		const parameter = structuredClone(mutation.parameter);
		try {
			assertOfxEffectBindingV1({
				bindingId: 'interact-validation', pluginId: 'interact-validation',
				binarySha256: '00'.repeat(32), context: 'filter', inputs: [],
				parameters: [parameter], customEncodings: {}, enabled: true, frozenRender: null,
			});
		} catch (cause) {
			throw contractError(errorMessage(cause, 'An OpenFX Interact parameter mutation is malformed.'));
		}
		const typed = parameter as OfxParameterStateV1;
		if (names.has(typed.name)) throw contractError('An OpenFX Interact result mutates a parameter twice.');
		names.add(typed.name);
		return deepFreeze({ parameter: typed });
	}));
}

function validateResultAuthority(
	result: Pick<FramescaperOpenFxInteractResultV1,
		'project' | 'instanceId' | 'effectStateSha256' | 'target' | 'parameterName'
		| 'acceptedSequences' | 'parameterMutations'>,
	expected: FramescaperOpenFxInteractRequestV1,
): void {
	if (result.project.id !== expected.project.id || result.project.revision !== expected.project.revision
		|| result.instanceId !== expected.effect.instanceId
		|| result.effectStateSha256 !== expected.effectStateSha256
		|| result.target !== expected.target || result.parameterName !== expected.parameterName) {
		throw contractError('The OpenFX Interact result does not bind the exact authored request.');
	}
	const requested = new Set(expected.events.map(({ sequence }) => sequence));
	if (result.acceptedSequences.some((sequence) => !requested.has(sequence))) {
		throw contractError('The OpenFX Interact result accepted an unrequested event sequence.');
	}
	applyFramescaperOpenFxInteractMutationsV1(expected.effect, result.parameterMutations);
}

function acceptedSequenceList(value: unknown): readonly number[] {
	if (!Array.isArray(value) || value.length > OFX_INTERACT_MAXIMUM_EVENTS_V1
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw contractError('An OpenFX Interact result carries a malformed accepted sequence list.');
	}
	return Object.freeze(value.map((sequence, index) => {
		if (!Number.isSafeInteger(sequence) || Number(sequence) < 0
			|| (index > 0 && Number(sequence) <= Number(value[index - 1]))) {
			throw contractError('OpenFX Interact accepted sequences must be strictly increasing safe integers.');
		}
		return Number(sequence);
	}));
}

function projectIdentity(value: unknown, label: string): FramescaperOpenFxInteractProjectV1 {
	const project = plainRecord(value, `OpenFX Interact ${label} project`);
	exactKeys(project, ['id', 'revision'], `OpenFX Interact ${label} project`);
	if (typeof project.id !== 'string' || !ID.test(project.id)
		|| !Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw contractError(`The OpenFX Interact ${label} project identity is malformed.`);
	}
	return Object.freeze({ id: project.id, revision: Number(project.revision) });
}

function standardParameter(context: OfxContext, name: string): boolean {
	return (context === 'retimer' && name === 'SourceTime')
		|| (context === 'transition' && name === 'Transition');
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw contractError(`A ${label} must be a plain record.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw contractError(`A ${label} must contain only enumerable data fields.`);
		}
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
	const actual = Object.keys(record);
	if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
		throw contractError(`A ${label} must carry exactly its schema keys.`);
	}
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function errorMessage(value: unknown, fallback: string): string {
	return value instanceof Error ? value.message : fallback;
}

function contractError(messageValue: string): OfxHostContractError {
	return new OfxHostContractError(messageValue);
}
