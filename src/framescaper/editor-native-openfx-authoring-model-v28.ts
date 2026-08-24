/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed menu-authoring model for every OpenFX Image Effect context in selected V28. */

import {
	assertOfxEffectBindingV1,
	type OfxInputBindingV1,
	type OfxParameterStateV1,
} from '../common/editor/native-ofx-binding.ts';
import type { OfxContext } from '../common/editor/native-ofx-descriptor.ts';
import {
	framescaperOpenFxPluginProjectionV1,
	type FramescaperOpenFxPluginProjectionV1,
} from '../common/editor/native-ofx-service-contract.ts';
import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const MAXIMUM_TARGETS = 100_000;

export interface FramescaperOpenFxAuthoringTargetV28 {
	readonly context: OfxContext;
	readonly targetId: string;
	readonly label: string;
	readonly instanceId: string | null;
	readonly inputs: readonly OfxInputBindingV1[];
}

export interface FramescaperOpenFxAuthoringModelV28 {
	readonly plugins: readonly FramescaperOpenFxPluginProjectionV1[];
	readonly targets: readonly FramescaperOpenFxAuthoringTargetV28[];
}

export interface FramescaperOpenFxAuthoringRequestV28 {
	readonly pluginHandle: string;
	readonly context: OfxContext;
	readonly targetId: string;
	readonly inputs: readonly OfxInputBindingV1[];
	readonly parameters: readonly OfxParameterStateV1[];
	readonly customEncodings: Readonly<Record<string, string>>;
}

export type FramescaperOpenFxAuthoringDraftV28 = Omit<
	OfxEffectStateV26,
	'freshness' | 'frozenFallback'
>;

export function createFramescaperOpenFxAuthoringModelV28(
	project: FramescaperProjectV28,
	pluginsValue: readonly FramescaperOpenFxPluginProjectionV1[],
): FramescaperOpenFxAuthoringModelV28 {
	const plugins = dense(pluginsValue, 1_024, 'OpenFX authoring plug-ins')
		.map(framescaperOpenFxPluginProjectionV1)
		.filter((plugin) => plugin.state === 'enabled' && !plugin.quarantined
			&& plugin.components.includes('RGBA'));
	const sources = records(project.sources, 'V28 OpenFX sources');
	const clips = records(project.clips, 'V28 OpenFX clips');
	const masks = records(project.videoMaskMattes, 'V28 OpenFX masks');
	const targets: FramescaperOpenFxAuthoringTargetV28[] = [];
	const push = (target: FramescaperOpenFxAuthoringTargetV28): void => {
		if (targets.length >= MAXIMUM_TARGETS) throw new RangeError('V28 OpenFX authoring targets exceed their ceiling.');
		if (targets.some(({ context, targetId }) => context === target.context && targetId === target.targetId)) {
			throw new RangeError('V28 OpenFX authoring targets are ambiguous.');
		}
		targets.push(deepFreeze(structuredClone(target)));
	};
	for (const source of sources) {
		if (source.kind !== 'generator') continue;
		const generator = record(source.generator, 'V28 external generator');
		if (generator.kind !== 'external-generator') continue;
		const targetId = stableId(source.id, 'external generator target');
		const instanceId = stableId(generator.bindingId, 'external generator binding');
		const inputs = inputBindings(generator.inputs, 'external generator inputs');
		for (const context of ['generator', 'general'] as const) push({
			context, targetId, instanceId, inputs,
			label: `${label(source, targetId)} — ${context}`,
		});
	}
	for (const clip of clips) {
		if (!['video', 'still', 'generator'].includes(String(clip.kind))) continue;
		const targetId = stableId(clip.id, 'visual clip target');
		const sourceRef = stableId(clip.sourceId, 'visual clip source');
		push({ context: 'filter', targetId, instanceId: null,
			inputs: frozenInputs([{ name: 'Source', sourceRef }]), label: label(clip, targetId) });
		if (clip.kind === 'video') push({ context: 'retimer', targetId, instanceId: null,
			inputs: frozenInputs([{ name: 'Source', sourceRef }]), label: label(clip, targetId) });
		const mask = masks[0];
		if (mask) push({ context: 'paint', targetId, instanceId: null,
			inputs: frozenInputs([
				{ name: 'Source', sourceRef },
				{ name: 'Mask', sourceRef: stableId(mask.id, 'paint mask') },
			]), label: label(clip, targetId) });
	}
	for (const layer of records(project.videoAdjustmentLayers, 'V28 OpenFX adjustment layers')) {
		if (layer.kind !== 'adjustment-layer') continue;
		const targetId = stableId(layer.id, 'adjustment-layer target');
		push({ context: 'filter', targetId, instanceId: null,
			inputs: frozenInputs([{ name: 'Source', sourceRef: targetId }]), label: label(layer, targetId) });
	}
	for (const track of records(project.tracks, 'V28 OpenFX tracks')) {
		for (const transition of recordsOrEmpty(track.videoTransitions, 'V28 OpenFX transitions')) {
			const targetId = stableId(transition.id, 'transition target');
			push({ context: 'transition', targetId, instanceId: null,
				inputs: frozenInputs([
					{ name: 'SourceFrom', sourceRef: stableId(transition.outgoingClipId, 'outgoing transition clip') },
					{ name: 'SourceTo', sourceRef: stableId(transition.incomingClipId, 'incoming transition clip') },
				]), label: label(transition, targetId) });
		}
	}
	return deepFreeze({ plugins, targets });
}

export function createFramescaperOpenFxAuthoringDraftV28(
	model: FramescaperOpenFxAuthoringModelV28,
	request: FramescaperOpenFxAuthoringRequestV28,
	mintId: () => string,
): FramescaperOpenFxAuthoringDraftV28 {
	const plugin = model.plugins.find(({ pluginHandle }) => pluginHandle === request.pluginHandle);
	if (!plugin || plugin.state !== 'enabled' || plugin.quarantined
		|| !plugin.supportedContexts.includes(request.context)) {
		throw new Error('The selected OpenFX plug-in or context is stale.');
	}
	const targets = model.targets.filter(({ context, targetId }) => (
		context === request.context && targetId === request.targetId
	));
	if (targets.length !== 1) throw new Error('The selected OpenFX target is stale or ambiguous.');
	const target = targets[0]!;
	const inputs = inputBindings(request.inputs, 'OpenFX authoring inputs');
	if (JSON.stringify(inputs) !== JSON.stringify(target.inputs)) {
		throw new Error('The selected OpenFX named input or source is stale.');
	}
	const parameters = parameterState(plugin, request.parameters);
	const customEncodings = customState(plugin, request.customEncodings);
	const instanceId = target.instanceId ?? stableId(mintId(), 'OpenFX instance ID');
	const draft: FramescaperOpenFxAuthoringDraftV28 = {
		schemaVersion: 1,
		instanceId,
		pluginId: plugin.pluginId,
		binarySha256: plugin.binarySha256,
		context: request.context,
		attachment: Object.freeze({ kind: request.context, targetId: target.targetId }),
		inputs,
		parameters,
		customEncodings,
		enabled: true,
	};
	assertOfxEffectBindingV1({
		bindingId: draft.instanceId, pluginId: draft.pluginId,
		binarySha256: draft.binarySha256, context: draft.context,
		inputs: draft.inputs, parameters: draft.parameters,
		customEncodings: draft.customEncodings, enabled: draft.enabled, frozenRender: null,
	});
	return deepFreeze(draft);
}

export function defaultFramescaperOpenFxParameterStateV28(
	pluginValue: FramescaperOpenFxPluginProjectionV1,
): readonly OfxParameterStateV1[] {
	const plugin = framescaperOpenFxPluginProjectionV1(pluginValue);
	return Object.freeze(plugin.parameters.map((parameter) => Object.freeze({
		name: parameter.name, type: parameter.type, value: defaultValue(parameter.type),
		keyframes: Object.freeze([]),
	})));
}

function defaultValue(type: FramescaperOpenFxPluginProjectionV1['parameters'][number]['type']): unknown {
	if (type === 'group' || type === 'page' || type === 'pushbutton') return null;
	if (type === 'boolean') return false;
	if (type === 'string' || type === 'custom') return '';
	if (type === 'choice' || type === 'integer') return 0;
	if (type === 'parametric') return Object.freeze([]);
	const count = type === 'double' ? 1
		: type === 'integer2d' || type === 'double2d' ? 2
			: type === 'rgba' ? 4 : 3;
	return Object.freeze(Array.from({ length: count }, () => 0));
}

function parameterState(
	plugin: FramescaperOpenFxPluginProjectionV1,
	value: readonly OfxParameterStateV1[],
): readonly OfxParameterStateV1[] {
	const parameters = dense<OfxParameterStateV1>(value, 4_096, 'OpenFX parameter state')
		.map((entry) => deepFreeze(structuredClone(entry)));
	if (parameters.length !== plugin.parameters.length) throw new Error('OpenFX parameter state must be complete.');
	for (let index = 0; index < plugin.parameters.length; index += 1) {
		const descriptor = plugin.parameters[index]!;
		const state = parameters[index]!;
		if (state.name !== descriptor.name || state.type !== descriptor.type
			|| (!descriptor.animates && state.keyframes.length !== 0)) {
			throw new Error('OpenFX parameter state does not match its complete descriptor order.');
		}
	}
	return Object.freeze(parameters);
}

function customState(
	plugin: FramescaperOpenFxPluginProjectionV1,
	value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	const state = record(value, 'OpenFX custom encodings');
	const customNames = plugin.parameters.filter(({ type }) => type === 'custom').map(({ name }) => name);
	const keys = Object.keys(state).sort();
	if (keys.length !== customNames.length || keys.some((key, index) => key !== [...customNames].sort()[index])
		|| keys.some((key) => typeof state[key] !== 'string')) {
		throw new Error('OpenFX custom parameter encodings must be complete and exact.');
	}
	return deepFreeze(structuredClone(state) as Record<string, string>);
}

function inputBindings(value: unknown, name: string): readonly OfxInputBindingV1[] {
	return frozenInputs(dense(value, 16, name).map((item, index) => {
		const input = record(item, `${name}[${String(index)}]`);
		return { name: stableId(input.name, 'OpenFX input name'), sourceRef: stableId(input.sourceRef, 'OpenFX input source') };
	}));
}

function frozenInputs(value: readonly OfxInputBindingV1[]): readonly OfxInputBindingV1[] {
	if (new Set(value.map(({ name }) => name)).size !== value.length) throw new Error('OpenFX input names must be unique.');
	return Object.freeze(value.map((input) => Object.freeze({ ...input })));
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	return dense(value, MAXIMUM_TARGETS, name).map((item, index) => record(item, `${name}[${String(index)}]`));
}
function recordsOrEmpty(value: unknown, name: string): Record<string, unknown>[] {
	return value === undefined ? [] : records(value, name);
}
function dense<Value>(value: unknown, maximum: number, name: string): Value[] {
	if (!Array.isArray(value) || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${name} must be a bounded dense array.`);
	return value as Value[];
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}
function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
function label(value: Record<string, unknown>, fallback: string): string {
	const candidate = value.name ?? value.title;
	return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 512
		? candidate : fallback;
}
function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
