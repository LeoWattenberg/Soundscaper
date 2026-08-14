/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDACITY_EFFECT_DEFINITIONS,
	normalizeAudacityEffectParams,
} from '../audacity-effects/manifest.js';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';
import { NYQUIST_BUNDLED_PLUGIN_CATALOG } from '../nyquist/plugins/catalog.js';

export type RestorationTarget = 'selection' | 'rack';
export type RestorationToolId =
	| 'click-removal'
	| 'noise-reduction'
	| 'filter-curve-eq'
	| 'clip-fix';

export interface RestorationToolDescriptor {
	readonly id: RestorationToolId;
	readonly family: 'audacity-effect' | 'audacity-nyquist-plugin';
	readonly processorId: string;
	readonly supportedTargets: readonly RestorationTarget[];
	readonly requiresNoiseProfile: boolean;
}

export interface RestorationStage {
	readonly id: string;
	readonly tool: RestorationToolId;
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, unknown>>;
}

export interface RestorationWorkflow {
	readonly target: RestorationTarget;
	readonly stages: readonly RestorationStage[];
}

export interface RestorationOperation {
	readonly stageId: string;
	readonly family: RestorationToolDescriptor['family'];
	readonly processorId: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly requiresNoiseProfile: boolean;
}

export interface RestorationWorkflowPlan {
	readonly target: RestorationTarget;
	readonly historyMode: 'single-transaction';
	readonly operations: readonly RestorationOperation[];
}

interface AudacityParameterDescriptor {
	readonly kind: 'number' | 'boolean' | 'enum' | 'curve' | 'bands';
}

interface AudacityEffectDefinition {
	readonly params: Readonly<Record<string, AudacityParameterDescriptor>>;
}

interface NyquistControl {
	readonly variable: string;
	readonly defaultValue: number;
	readonly min: number | null;
	readonly max: number | null;
}

interface NyquistPlugin {
	readonly id: string;
	readonly controls: readonly NyquistControl[];
}

const MAXIMUM_STAGES = 16;
const MAXIMUM_CURVE_POINTS = 128;
const RESTORATION_STAGE_FIELDS = ['id', 'tool', 'enabled', 'params'] as const;
const AUDACITY_DEFINITIONS = AUDACITY_EFFECT_DEFINITIONS as unknown as Readonly<
	Record<string, AudacityEffectDefinition>
>;
const NYQUIST_PLUGINS = NYQUIST_BUNDLED_PLUGIN_CATALOG as unknown as readonly NyquistPlugin[];

export const RESTORATION_WORKFLOW_POLICY = deepFreeze({
	parameterAuthority: 'existing-effect-definitions',
	historyMode: 'single-transaction',
	projectFields: [] as readonly string[],
	exportTransforms: [] as readonly string[],
});

export const RESTORATION_TOOL_CATALOG: readonly RestorationToolDescriptor[] = deepFreeze([
	{
		id: 'click-removal',
		family: 'audacity-effect',
		processorId: 'audacity-click-removal',
		supportedTargets: ['selection', 'rack'],
		requiresNoiseProfile: false,
	},
	{
		id: 'noise-reduction',
		family: 'audacity-effect',
		processorId: 'audacity-noise-reduction',
		supportedTargets: ['selection', 'rack'],
		requiresNoiseProfile: true,
	},
	{
		id: 'filter-curve-eq',
		family: 'audacity-effect',
		processorId: 'audacity-filter-curve-eq',
		supportedTargets: ['selection', 'rack'],
		requiresNoiseProfile: false,
	},
	{
		id: 'clip-fix',
		family: 'audacity-nyquist-plugin',
		processorId: 'nyquist:clipfix',
		supportedTargets: ['selection'],
		requiresNoiseProfile: false,
	},
]);

const TOOL_BY_ID = new Map(RESTORATION_TOOL_CATALOG.map((tool) => [tool.id, tool]));
const CLIP_FIX_PLUGIN = NYQUIST_PLUGINS.find(({ id }) => id === 'nyquist:clipfix');
if (!CLIP_FIX_PLUGIN) throw new Error('The pinned Audacity Clip Fix processor is unavailable.');

/**
 * Normalize the dialog/controller value. This remains runtime workflow state;
 * only the existing effect parameter and history authorities may commit it.
 */
export function normalizeRestorationWorkflow(value: unknown): RestorationWorkflow {
	const record = readClosedDomainRecord(value, 'restoration workflow', ['target', 'stages']);
	const target = normalizeTarget(readClosedDomainField(record, 'target', 'restoration workflow'));
	const stageValues = readClosedDomainArray(
		readClosedDomainField(record, 'stages', 'restoration workflow'),
		'restoration workflow stages',
		1,
		MAXIMUM_STAGES,
	);
	const ids = new Set<string>();
	const stages = stageValues.map((stageValue, index) => {
		const stage = normalizeStage(stageValue, index, target);
		if (ids.has(stage.id)) throw new RangeError('Restoration stage IDs must be unique.');
		ids.add(stage.id);
		return stage;
	});
	return deepFreeze({ target, stages });
}

/** Compile enabled stages in their declared order as one undoable operation. */
export function compileRestorationWorkflowPlan(value: unknown): RestorationWorkflowPlan {
	const workflow = normalizeRestorationWorkflow(value);
	const operations = workflow.stages.flatMap((stage): readonly RestorationOperation[] => {
		if (!stage.enabled) return [];
		const tool = requireTool(stage.tool);
		return [{
			stageId: stage.id,
			family: tool.family,
			processorId: tool.processorId,
			params: tool.id === 'clip-fix' ? clipFixControls(stage.params) : stage.params,
			requiresNoiseProfile: tool.requiresNoiseProfile,
		}];
	});
	return deepFreeze({
		target: workflow.target,
		historyMode: 'single-transaction',
		operations,
	});
}

function normalizeStage(value: unknown, index: number, target: RestorationTarget): RestorationStage {
	const name = `restoration workflow stages[${String(index)}]`;
	const record = readClosedDomainRecord(value, name, RESTORATION_STAGE_FIELDS);
	const id = stableId(readClosedDomainField(record, 'id', name), `${name}.id`);
	const toolId = readClosedDomainField(record, 'tool', name);
	if (typeof toolId !== 'string' || !TOOL_BY_ID.has(toolId as RestorationToolId)) {
		throw new RangeError(`${name}.tool must name a supported restoration tool.`);
	}
	const tool = requireTool(toolId as RestorationToolId);
	if (!tool.supportedTargets.includes(target)) {
		throw new RangeError(`${tool.id} is selection only and cannot target a rack.`);
	}
	const enabled = readClosedDomainField(record, 'enabled', name);
	if (typeof enabled !== 'boolean') throw new TypeError(`${name}.enabled must be boolean.`);
	const paramsValue = readClosedDomainField(record, 'params', name);
	const params = tool.id === 'clip-fix'
		? normalizeClipFixParams(paramsValue)
		: normalizeAudacityParams(tool.processorId, paramsValue);
	return deepFreeze({ id, tool: tool.id, enabled, params });
}

function normalizeAudacityParams(type: string, value: unknown): Readonly<Record<string, unknown>> {
	const definition = AUDACITY_DEFINITIONS[type];
	if (!definition) throw new Error(`The maintained ${type} parameter definition is unavailable.`);
	const fields = Object.keys(definition.params);
	const record = readClosedDomainRecord(value, `${type} parameters`, fields, []);
	const inert: Record<string, unknown> = {};
	for (const field of fields) {
		if (!Object.hasOwn(record, field)) continue;
		const candidate = readClosedDomainField(record, field, `${type} parameters`);
		inert[field] = normalizeAudacityParameterInput(
			candidate,
			definition.params[field]!,
			`${type}.${field}`,
		);
	}
	const normalized = normalizeAudacityEffectParams(type, inert) as unknown;
	if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
		throw new Error(`The maintained ${type} normalizer returned an invalid value.`);
	}
	return deepFreeze(normalized as Record<string, unknown>);
}

function normalizeAudacityParameterInput(
	value: unknown,
	descriptor: AudacityParameterDescriptor,
	name: string,
): unknown {
	if (descriptor.kind === 'number') {
		if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
		return value;
	}
	if (descriptor.kind === 'boolean') {
		if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
		return value;
	}
	if (descriptor.kind === 'enum') {
		if (typeof value !== 'string' && typeof value !== 'number') {
			throw new TypeError(`${name} must be a string or number.`);
		}
		return value;
	}
	if (descriptor.kind === 'curve') return normalizeCurvePoints(value, name);
	throw new TypeError(`${name} uses an unsupported restoration parameter shape.`);
}

function normalizeCurvePoints(value: unknown, name: string): readonly Readonly<{
	readonly frequency: number;
	readonly gain: number;
}>[] {
	const points = readClosedDomainArray(value, name, 1, MAXIMUM_CURVE_POINTS);
	return Object.freeze(points.map((point, index) => {
		const pointName = `${name}[${String(index)}]`;
		const record = readClosedDomainRecord(point, pointName, ['frequency', 'gain']);
		const frequency = finiteNumber(readClosedDomainField(record, 'frequency', pointName), `${pointName}.frequency`);
		const gain = finiteNumber(readClosedDomainField(record, 'gain', pointName), `${pointName}.gain`);
		return Object.freeze({ frequency, gain });
	}));
}

function normalizeClipFixParams(value: unknown): Readonly<Record<string, unknown>> {
	const record = readClosedDomainRecord(
		value,
		'clip-fix parameters',
		['thresholdPercent', 'gainDb'],
		[],
	);
	return deepFreeze({
		thresholdPercent: normalizeNyquistControl(
			Object.hasOwn(record, 'thresholdPercent')
				? readClosedDomainField(record, 'thresholdPercent', 'clip-fix parameters')
				: undefined,
			'THRESHOLD',
		),
		gainDb: normalizeNyquistControl(
			Object.hasOwn(record, 'gainDb')
				? readClosedDomainField(record, 'gainDb', 'clip-fix parameters')
				: undefined,
			'GAIN',
		),
	});
}

function normalizeNyquistControl(value: unknown, variable: string): number {
	const control = CLIP_FIX_PLUGIN!.controls.find((candidate) => candidate.variable === variable);
	if (!control || control.min == null || control.max == null) {
		throw new Error(`The pinned Clip Fix ${variable} control is unavailable.`);
	}
	const candidate = value === undefined ? control.defaultValue : finiteNumber(value, `clip-fix ${variable}`);
	if (candidate < control.min || candidate > control.max) {
		throw new RangeError(`clip-fix ${variable} must be between ${String(control.min)} and ${String(control.max)}.`);
	}
	return candidate;
}

function clipFixControls(params: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	return deepFreeze({ THRESHOLD: params.thresholdPercent, GAIN: params.gainDb });
}

function normalizeTarget(value: unknown): RestorationTarget {
	if (value !== 'selection' && value !== 'rack') {
		throw new RangeError('Restoration target must be selection or rack.');
	}
	return value;
}

function requireTool(id: RestorationToolId): RestorationToolDescriptor {
	const tool = TOOL_BY_ID.get(id);
	if (!tool) throw new RangeError('A supported restoration tool is required.');
	return tool;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value.trim() !== value) {
		throw new RangeError(`${name} must be a canonical ID from 1 through 128 characters.`);
	}
	return value;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a canonical finite number.`);
	}
	return value;
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
