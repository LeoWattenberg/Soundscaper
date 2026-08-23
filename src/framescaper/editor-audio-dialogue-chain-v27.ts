/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import type {
	AudioEditorCommand,
	BatchAudioEditorCommand,
	CommandObject,
	EffectRackTarget,
} from '../common/editor/commands/protocol.ts';
import { normalizeNoiseReductionContext } from '../common/editor/effect-macros.js';
import { normalizeEffect } from '../common/editor/effects.js';
import { snapshotInertJsonValue } from '../common/editor/inert-json-snapshot.ts';
import {
	LOUDNESS_NORMALIZATION_TARGETS,
	normalizeLoudnessNormalizationTarget,
	type LoudnessNormalizationPreset,
	type LoudnessNormalizationTarget,
} from '../common/editor/loudness-normalization.ts';

export const FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_V27 = 1 as const;
export const FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_V27 =
	'after-highpass-before-gate' as const;
export const FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_V27 = Object.freeze([
	'highpass', 'gate', 'eq', 'compressor', 'limiter',
] as const);
export const FRAMESCAPER_LOUDNESS_TARGET_PRESET_IDS_V27 = Object.freeze(
	Object.keys(LOUDNESS_NORMALIZATION_TARGETS) as LoudnessNormalizationPreset[],
);
/** No delivery gain is selected until the operator explicitly chooses a target. */
export const FRAMESCAPER_DEFAULT_LOUDNESS_TARGET_V27 = null;

type DialogueCoreEffectTypeV27 = typeof FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_V27[number];
type DialogueEffectTypeV27 = DialogueCoreEffectTypeV27 | 'audacity-noise-reduction';

export interface FramescaperDialogueEffectV27 {
	readonly id: string;
	readonly type: DialogueEffectTypeV27;
	readonly enabled: true;
	readonly params: Readonly<Record<string, unknown>>;
	readonly context?: Readonly<{
		readonly noiseProfile: FramescaperNoiseProfileV27;
	}>;
}

export interface FramescaperNoiseProfileV27 extends Readonly<Record<string, unknown>> {
	readonly type: 'audacity-noise-profile';
	readonly version: 1;
	readonly sampleRate: number;
	readonly windowSize: 2_048;
	readonly stepsPerWindow: 4;
	readonly meanPowers: readonly number[];
}

export interface FramescaperDialogueChainV27 {
	readonly schemaVersion: typeof FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_V27;
	readonly id: string;
	readonly sampleRate: number;
	readonly noiseReductionPlacement:
		| typeof FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_V27
		| null;
	readonly effects: readonly FramescaperDialogueEffectV27[];
}

export interface FramescaperDialogueChainOptionsV27 {
	readonly id: string;
	readonly sampleRate: number;
	readonly parameters?: Readonly<Partial<Record<
		DialogueCoreEffectTypeV27,
		Readonly<Record<string, unknown>>
	>>>;
	readonly noiseReduction?: Readonly<{
		readonly profile: Readonly<Record<string, unknown>>;
		readonly params?: Readonly<Record<string, unknown>>;
	}>;
}

const CHAIN_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'sampleRate', 'noiseReductionPlacement', 'effects',
]);
const CREATION_FIELDS = Object.freeze(['id', 'sampleRate', 'parameters', 'noiseReduction']);
const EFFECT_FIELDS = Object.freeze(['id', 'type', 'enabled', 'params', 'context']);
const NOISE_OPTIONS_FIELDS = Object.freeze(['profile', 'params']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;
const RACK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

/** Build the complete non-AI dialogue rack with stable caller-owned identities. */
export function createFramescaperDialogueChainV27(
	value: FramescaperDialogueChainOptionsV27 | unknown,
): FramescaperDialogueChainV27 {
	const options = readClosedDomainRecord(
		value, 'Framescaper dialogue chain options', CREATION_FIELDS, ['id', 'sampleRate'],
	);
	const chainId = stableChainId(field(options, 'id', 'Framescaper dialogue chain options'));
	const sampleRate = audioSampleRate(field(options, 'sampleRate', 'Framescaper dialogue chain options'));
	const parameters = Object.hasOwn(options, 'parameters')
		? readClosedDomainRecord(
			field(options, 'parameters', 'Framescaper dialogue chain options'),
			'Framescaper dialogue parameters', FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_V27, [],
		)
		: null;
	const core = FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_V27.map((type) => rawEffect(
		chainEffectId(chainId, type), type, parameterValue(parameters, type),
	));
	const noise = Object.hasOwn(options, 'noiseReduction')
		? rawNoiseEffect(chainId, sampleRate, field(
			options, 'noiseReduction', 'Framescaper dialogue chain options',
		))
		: null;
	const effects = noise === null
		? core
		: [core[0]!, noise, ...core.slice(1)];
	return normalizeFramescaperDialogueChainV27({
		schemaVersion: FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_V27,
		id: chainId,
		sampleRate,
		noiseReductionPlacement: noise === null
			? null
			: FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_V27,
		effects,
	});
}

/** Normalize persisted/menu state while refusing any alternate processor order. */
export function normalizeFramescaperDialogueChainV27(
	value: unknown,
): FramescaperDialogueChainV27 {
	const name = 'Framescaper dialogue chain';
	const chain = readClosedDomainRecord(value, name, CHAIN_FIELDS);
	exact(field(chain, 'schemaVersion', name), FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_V27, 'dialogue chain schema');
	const id = stableChainId(field(chain, 'id', name));
	const sampleRate = audioSampleRate(field(chain, 'sampleRate', name));
	const placement = noisePlacement(field(chain, 'noiseReductionPlacement', name));
	const expectedTypes: readonly DialogueEffectTypeV27[] = placement === null
		? FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_V27
		: Object.freeze(['highpass', 'audacity-noise-reduction', 'gate', 'eq', 'compressor', 'limiter']);
	const values = readClosedDomainArray(field(chain, 'effects', name), 'dialogue chain effects', 5, 6);
	if (values.length !== expectedTypes.length) {
		throw new RangeError(`The dialogue chain effect count does not match its explicit noise-reduction placement.`);
	}
	const effects = values.map((effect, index) => normalizeDialogueEffect(
		effect, expectedTypes[index]!, chainEffectId(id, expectedTypes[index]!), sampleRate,
	));
	return Object.freeze({
		schemaVersion: FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_V27,
		id,
		sampleRate,
		noiseReductionPlacement: placement,
		effects: Object.freeze(effects),
	});
}

/**
 * Create one atomic shared-protocol transaction for the menu/controller layer.
 * The applier still owns admission and history; this helper only fixes rack
 * scope, identities, processor order, and insertion indexes.
 */
export function createFramescaperDialogueChainAddCommandV27(
	targetValue: EffectRackTarget | unknown,
	chainValue: FramescaperDialogueChainV27 | unknown,
	startIndex?: number,
): BatchAudioEditorCommand {
	const target = normalizeRackTarget(targetValue);
	const chain = normalizeFramescaperDialogueChainV27(chainValue);
	const index = startIndex === undefined
		? null
		: boundedInteger(startIndex, 0, 256 - chain.effects.length, 'dialogue chain start index');
	const commands = chain.effects.map((effect, offset): AudioEditorCommand => Object.freeze({
		type: 'effect/add' as const,
		...target,
		effect: effect as unknown as CommandObject,
		...(index === null ? {} : { index: index + offset }),
	}));
	return Object.freeze({ type: 'batch', commands: Object.freeze(commands) });
}

/** Delegate to the shared target authority, preserving its presets and null default. */
export function resolveFramescaperLoudnessTargetV27(
	value: unknown,
): LoudnessNormalizationTarget | null {
	return normalizeLoudnessNormalizationTarget(value);
}

function rawEffect(
	id: string,
	type: DialogueCoreEffectTypeV27,
	params: unknown,
): Readonly<Record<string, unknown>> {
	return { id, type, enabled: true, params };
}

function rawNoiseEffect(
	chainId: string,
	sampleRate: number,
	value: unknown,
): Readonly<Record<string, unknown>> {
	const snapshot = snapshotInertJsonValue(value, 'Framescaper profiled noise reduction', {
		maximumArrayLength: 1_025, maximumNodes: 2_048,
	});
	const options = readClosedDomainRecord(
		snapshot, 'Framescaper profiled noise reduction', NOISE_OPTIONS_FIELDS, ['profile'],
	);
	const context = normalizeNoiseReductionContext({
		noiseProfile: field(options, 'profile', 'Framescaper profiled noise reduction'),
	}) as Readonly<{ readonly noiseProfile: FramescaperNoiseProfileV27 }>;
	if (context.noiseProfile.sampleRate !== sampleRate) {
		throw new RangeError('The profiled noise-reduction sample rate must match the dialogue chain sample rate.');
	}
	return {
		id: chainEffectId(chainId, 'audacity-noise-reduction'),
		type: 'audacity-noise-reduction',
		enabled: true,
		params: Object.hasOwn(options, 'params')
			? field(options, 'params', 'Framescaper profiled noise reduction')
			: {},
		context,
	};
}

function normalizeDialogueEffect(
	value: unknown,
	expectedType: DialogueEffectTypeV27,
	expectedId: string,
	sampleRate: number,
): FramescaperDialogueEffectV27 {
	const name = `Framescaper dialogue ${expectedType} effect`;
	const required = expectedType === 'audacity-noise-reduction'
		? EFFECT_FIELDS
		: EFFECT_FIELDS.filter((item) => item !== 'context');
	const effect = readClosedDomainRecord(value, name, EFFECT_FIELDS, required);
	if (field(effect, 'id', name) !== expectedId) {
		throw new RangeError(`The dialogue ${expectedType} effect identity is not canonical.`);
	}
	if (field(effect, 'type', name) !== expectedType) {
		throw new RangeError(`The dialogue chain processor order requires ${expectedType}.`);
	}
	if (field(effect, 'enabled', name) !== true) {
		throw new RangeError(`The complete dialogue ${expectedType} effect must be enabled.`);
	}
	if (expectedType !== 'audacity-noise-reduction' && Object.hasOwn(effect, 'context')) {
		throw new TypeError(`The dialogue ${expectedType} effect does not admit profile context.`);
	}
	const candidate: Record<string, unknown> = {
		id: expectedId,
		type: expectedType,
		enabled: true,
		params: inertParams(field(effect, 'params', name), name),
	};
	if (expectedType === 'audacity-noise-reduction') {
		const context = normalizeNoiseReductionContext(field(effect, 'context', name)) as Readonly<{
			readonly noiseProfile: FramescaperNoiseProfileV27;
		}>;
		if (context.noiseProfile.sampleRate !== sampleRate) {
			throw new RangeError('The profiled noise-reduction sample rate must match the dialogue chain sample rate.');
		}
		candidate.context = context;
	}
	const normalized = normalizeEffect(candidate) as FramescaperDialogueEffectV27;
	return deepFreeze(normalized);
}

function parameterValue(
	parameters: ClosedDomainRecord | null,
	type: DialogueCoreEffectTypeV27,
): unknown {
	return parameters !== null && Object.hasOwn(parameters, type)
		? inertParams(field(parameters, type, 'Framescaper dialogue parameters'), `dialogue ${type}`)
		: {};
}

function inertParams(value: unknown, name: string): unknown {
	const snapshot = snapshotInertJsonValue(value, `${name} parameters`, {
		maximumArrayLength: 64, maximumNodes: 512,
	});
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
		throw new TypeError(`${name} parameters must be a plain object.`);
	}
	return snapshot;
}

function normalizeRackTarget(value: unknown): EffectRackTarget {
	const name = 'Framescaper dialogue rack target';
	const target = readClosedDomainRecord(value, name, ['scope', 'trackId', 'busId'], ['scope']);
	const scope = field(target, 'scope', name);
	if (scope === 'master') {
		if (Object.hasOwn(target, 'trackId') || Object.hasOwn(target, 'busId')) {
			throw new TypeError('A master dialogue rack target cannot carry an owner ID.');
		}
		return Object.freeze({ scope });
	}
	if (scope === 'track') {
		if (Object.hasOwn(target, 'busId')) throw new TypeError('A track dialogue rack target cannot carry a bus ID.');
		return Object.freeze({ scope, trackId: stableRackId(field(target, 'trackId', name), 'track') });
	}
	if (scope === 'group' || scope === 'send') {
		if (Object.hasOwn(target, 'trackId')) throw new TypeError('A mixer dialogue rack target cannot carry a track ID.');
		return Object.freeze({ scope, busId: stableRackId(field(target, 'busId', name), 'bus') });
	}
	throw new RangeError('A dialogue rack scope must be track, master, group, or send.');
}

function noisePlacement(
	value: unknown,
): FramescaperDialogueChainV27['noiseReductionPlacement'] {
	if (value === null || value === FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_V27) return value;
	throw new RangeError('The dialogue noise-reduction placement is unsupported.');
}

function chainEffectId(chainId: string, type: DialogueEffectTypeV27): string {
	return `${chainId}:${type === 'audacity-noise-reduction' ? 'profiled-noise-reduction' : type}`;
}

function stableChainId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) {
		throw new TypeError('The Framescaper dialogue chain ID must be a bounded stable ID.');
	}
	return value;
}

function stableRackId(value: unknown, kind: 'track' | 'bus'): string {
	if (typeof value !== 'string' || !RACK_ID.test(value)) {
		throw new TypeError(`The dialogue rack ${kind} ID must be a bounded stable ID.`);
	}
	return value;
}

function audioSampleRate(value: unknown): number {
	return boundedInteger(value, 8_000, 384_000, 'dialogue chain sample rate');
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`);
	}
	return Number(value);
}

function exact<const Value extends number>(
	value: unknown,
	expected: Value,
	name: string,
): Value {
	if (value !== expected) throw new RangeError(`${name} is unsupported.`);
	return expected;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
