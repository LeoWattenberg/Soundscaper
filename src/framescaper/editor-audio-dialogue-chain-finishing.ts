/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import { normalizeNoiseReductionContext } from '../common/editor/effect-macros.js';
import { normalizeEffect } from '../common/editor/effects.js';
import { snapshotInertJsonValue } from '../common/editor/inert-json-snapshot.ts';
import {
	LOUDNESS_NORMALIZATION_TARGETS,
	normalizeLoudnessNormalizationTarget,
	type LoudnessNormalizationPreset,
	type LoudnessNormalizationTarget,
} from '../common/editor/loudness-normalization.ts';

export const createFramescaperDialogueChain = createFramescaperDialogueChainFinishing;
export const createFramescaperDialogueChainAddCommand = createFramescaperDialogueChainAddCommandFinishing;

export const FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_FINISHING = 1 as const;
export const FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_FINISHING =
	'after-highpass-before-gate' as const;
export const FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_FINISHING = Object.freeze([
	'highpass', 'gate', 'eq', 'compressor', 'limiter',
] as const);
export const FRAMESCAPER_LOUDNESS_TARGET_PRESET_IDS_FINISHING = Object.freeze(
	Object.keys(LOUDNESS_NORMALIZATION_TARGETS) as LoudnessNormalizationPreset[],
);
/** No delivery gain is selected until the operator explicitly chooses a target. */
export const FRAMESCAPER_DEFAULT_LOUDNESS_TARGET_FINISHING = null;

type DialogueCoreEffectTypeFinishing = typeof FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_FINISHING[number];
type DialogueEffectTypeFinishing = DialogueCoreEffectTypeFinishing | 'audacity-noise-reduction';

export interface FramescaperDialogueEffectFinishing {
	readonly id: string;
	readonly type: DialogueEffectTypeFinishing;
	readonly enabled: true;
	readonly params: Readonly<Record<string, unknown>>;
	readonly context?: Readonly<{
		readonly noiseProfile: FramescaperNoiseProfileFinishing;
	}>;
}

export interface FramescaperNoiseProfileFinishing extends Readonly<Record<string, unknown>> {
	readonly type: 'audacity-noise-profile';
	readonly version: 1;
	readonly sampleRate: number;
	readonly windowSize: 2_048;
	readonly stepsPerWindow: 4;
	readonly meanPowers: readonly number[];
}

export interface FramescaperDialogueChainFinishing {
	readonly schemaVersion: typeof FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_FINISHING;
	readonly id: string;
	readonly sampleRate: number;
	readonly noiseReductionPlacement:
		| typeof FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_FINISHING
		| null;
	readonly effects: readonly FramescaperDialogueEffectFinishing[];
}

export interface FramescaperDialogueChainOptionsFinishing {
	readonly id: string;
	readonly sampleRate: number;
	readonly parameters?: Readonly<Partial<Record<
		DialogueCoreEffectTypeFinishing,
		Readonly<Record<string, unknown>>
	>>>;
	readonly noiseReduction?: Readonly<{
		readonly profile: Readonly<Record<string, unknown>>;
		readonly params?: Readonly<Record<string, unknown>>;
	}>;
}

export interface FramescaperDialogueChainAddCommandFinishing {
	readonly type: 'framescaper/audio-dialogue-chain-add';
	readonly trackId: string;
	readonly startIndex: number | null;
	readonly chain: FramescaperDialogueChainFinishing;
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
export function createFramescaperDialogueChainFinishing(
	value: FramescaperDialogueChainOptionsFinishing | unknown,
): FramescaperDialogueChainFinishing {
	const options = readClosedDomainRecord(
		value, 'Framescaper dialogue chain options', CREATION_FIELDS, ['id', 'sampleRate'],
	);
	const chainId = stableChainId(field(options, 'id', 'Framescaper dialogue chain options'));
	const sampleRate = audioSampleRate(field(options, 'sampleRate', 'Framescaper dialogue chain options'));
	const parameters = Object.hasOwn(options, 'parameters')
		? readClosedDomainRecord(
			field(options, 'parameters', 'Framescaper dialogue chain options'),
			'Framescaper dialogue parameters', FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_FINISHING, [],
		)
		: null;
	const core = FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_FINISHING.map((type) => rawEffect(
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
	return normalizeFramescaperDialogueChainFinishing({
		schemaVersion: FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_FINISHING,
		id: chainId,
		sampleRate,
		noiseReductionPlacement: noise === null
			? null
			: FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_FINISHING,
		effects,
	});
}

/** Normalize persisted/menu state while refusing any alternate processor order. */
export function normalizeFramescaperDialogueChainFinishing(
	value: unknown,
): FramescaperDialogueChainFinishing {
	const name = 'Framescaper dialogue chain';
	const chain = readClosedDomainRecord(value, name, CHAIN_FIELDS);
	exact(field(chain, 'schemaVersion', name), FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_FINISHING, 'dialogue chain schema');
	const id = stableChainId(field(chain, 'id', name));
	const sampleRate = audioSampleRate(field(chain, 'sampleRate', name));
	const placement = noisePlacement(field(chain, 'noiseReductionPlacement', name));
	const expectedTypes: readonly DialogueEffectTypeFinishing[] = placement === null
		? FRAMESCAPER_DIALOGUE_CHAIN_EFFECT_TYPES_FINISHING
		: Object.freeze(['highpass', 'audacity-noise-reduction', 'gate', 'eq', 'compressor', 'limiter']);
	const values = readClosedDomainArray(field(chain, 'effects', name), 'dialogue chain effects', 5, 6);
	if (values.length !== expectedTypes.length) {
		throw new RangeError(`The dialogue chain effect count does not match its explicit noise-reduction placement.`);
	}
	const effects = values.map((effect, index) => normalizeDialogueEffect(
		effect, expectedTypes[index]!, chainEffectId(id, expectedTypes[index]!), sampleRate,
	));
	return Object.freeze({
		schemaVersion: FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_FINISHING,
		id,
		sampleRate,
		noiseReductionPlacement: placement,
		effects: Object.freeze(effects),
	});
}

/**
 * Remove only complete racks authored by the bounded finishing dialogue command.
 * Partial, reordered, disabled, or identity-forged sequences remain generic
 * audio effects and therefore retain the ordinary unavailable-feature gate.
 */
export function withoutFramescaperDialogueChainsFinishing(
	effectsValue: unknown,
	sampleRate: unknown,
): readonly unknown[] {
	if (!Array.isArray(effectsValue)) throw new TypeError('Framescaper dialogue rack effects must be an array.');
	const generic: unknown[] = [];
	for (let index = 0; index < effectsValue.length;) {
		const length = dialogueChainLengthAt(effectsValue, index, sampleRate);
		if (length > 0) index += length;
		else {
			generic.push(effectsValue[index]);
			index += 1;
		}
	}
	return Object.freeze(generic);
}

/**
 * Create one atomic finishing-owned transaction for the menu/controller layer.
 * Keeping the exact chain behind this product command avoids enabling the
 * generic effects, Nyquist, or clip time/pitch authoring surfaces.
 */
export function createFramescaperDialogueChainAddCommandFinishing(
	targetValue: unknown,
	chainValue: FramescaperDialogueChainFinishing | unknown,
	startIndex?: number,
): FramescaperDialogueChainAddCommandFinishing {
	const trackId = normalizeTrackTarget(targetValue);
	const chain = normalizeFramescaperDialogueChainFinishing(chainValue);
	const index = startIndex === undefined
		? null
		: boundedInteger(startIndex, 0, 256 - chain.effects.length, 'dialogue chain start index');
	return Object.freeze({
		type: 'framescaper/audio-dialogue-chain-add',
		trackId,
		startIndex: index,
		chain,
	});
}

export function normalizeFramescaperDialogueChainAddCommandFinishing(
	value: unknown,
): FramescaperDialogueChainAddCommandFinishing {
	const name = 'Framescaper dialogue-chain command';
	const command = readClosedDomainRecord(value, name, [
		'type', 'trackId', 'startIndex', 'chain',
	]);
	if (field(command, 'type', name) !== 'framescaper/audio-dialogue-chain-add') {
		throw new RangeError('The Framescaper dialogue-chain command type is unsupported.');
	}
	const chain = normalizeFramescaperDialogueChainFinishing(field(command, 'chain', name));
	const startIndex = field(command, 'startIndex', name);
	return Object.freeze({
		type: 'framescaper/audio-dialogue-chain-add',
		trackId: stableRackId(field(command, 'trackId', name), 'track'),
		startIndex: startIndex === null ? null : boundedInteger(
			startIndex, 0, 256 - chain.effects.length, 'dialogue chain start index',
		),
		chain,
	});
}

/** Delegate to the shared target authority, preserving its presets and null default. */
export function resolveFramescaperLoudnessTargetFinishing(
	value: unknown,
): LoudnessNormalizationTarget | null {
	return normalizeLoudnessNormalizationTarget(value);
}

function rawEffect(
	id: string,
	type: DialogueCoreEffectTypeFinishing,
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
	}) as Readonly<{ readonly noiseProfile: FramescaperNoiseProfileFinishing }>;
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
	expectedType: DialogueEffectTypeFinishing,
	expectedId: string,
	sampleRate: number,
): FramescaperDialogueEffectFinishing {
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
			readonly noiseProfile: FramescaperNoiseProfileFinishing;
		}>;
		if (context.noiseProfile.sampleRate !== sampleRate) {
			throw new RangeError('The profiled noise-reduction sample rate must match the dialogue chain sample rate.');
		}
		candidate.context = context;
	}
	const normalized = normalizeEffect(candidate) as FramescaperDialogueEffectFinishing;
	return deepFreeze(normalized);
}

function parameterValue(
	parameters: ClosedDomainRecord | null,
	type: DialogueCoreEffectTypeFinishing,
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

function normalizeTrackTarget(value: unknown): string {
	const name = 'Framescaper dialogue rack target';
	const target = readClosedDomainRecord(value, name, ['scope', 'trackId', 'busId'], ['scope']);
	const scope = field(target, 'scope', name);
	if (scope === 'track') {
		if (Object.hasOwn(target, 'busId')) throw new TypeError('A track dialogue rack target cannot carry a bus ID.');
		return stableRackId(field(target, 'trackId', name), 'track');
	}
	throw new RangeError('The Framescaper dialogue chain is restricted to one audio track.');
}

function noisePlacement(
	value: unknown,
): FramescaperDialogueChainFinishing['noiseReductionPlacement'] {
	if (value === null || value === FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_FINISHING) return value;
	throw new RangeError('The dialogue noise-reduction placement is unsupported.');
}

function chainEffectId(chainId: string, type: DialogueEffectTypeFinishing): string {
	return `${chainId}:${type === 'audacity-noise-reduction' ? 'profiled-noise-reduction' : type}`;
}

function dialogueChainLengthAt(effects: readonly unknown[], index: number, sampleRate: unknown): number {
	const first = effectIdentity(effects[index]);
	const suffix = ':highpass';
	if (first?.type !== 'highpass' || !first.id.endsWith(suffix)) return 0;
	const chainId = first.id.slice(0, -suffix.length);
	const profiled = effectIdentity(effects[index + 1])?.type === 'audacity-noise-reduction';
	const length = profiled ? 6 : 5;
	if (index + length > effects.length) return 0;
	try {
		normalizeFramescaperDialogueChainFinishing({
			schemaVersion: FRAMESCAPER_DIALOGUE_CHAIN_SCHEMA_VERSION_FINISHING,
			id: chainId,
			sampleRate,
			noiseReductionPlacement: profiled
				? FRAMESCAPER_DIALOGUE_NOISE_REDUCTION_PLACEMENT_FINISHING
				: null,
			effects: effects.slice(index, index + length),
		});
		return length;
	} catch {
		return 0;
	}
}

function effectIdentity(value: unknown): Readonly<{ id: string; type: string }> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const id = Object.getOwnPropertyDescriptor(value, 'id');
	const type = Object.getOwnPropertyDescriptor(value, 'type');
	return id?.enumerable && Object.hasOwn(id, 'value') && typeof id.value === 'string'
		&& type?.enumerable && Object.hasOwn(type, 'value') && typeof type.value === 'string'
		? Object.freeze({ id: id.value, type: type.value })
		: null;
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
