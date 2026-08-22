/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact V26 persisted OFX state and verified frozen/bypass recovery. */

import {
	assertOfxEffectBindingV1,
	OFX_PLUGIN_AVAILABILITIES,
	type OfxInputBindingV1,
	type OfxParameterStateV1,
	type OfxPluginAvailability,
} from './native-ofx-binding.ts';
import { OFX_CONTEXTS, type OfxContext } from './native-ofx-descriptor.ts';
import { createNativeValidators } from './native-validation.ts';

export interface OfxEffectFreshnessV26 {
	readonly authoredStateSha256: string;
	readonly inputIdentitiesSha256: string;
	readonly renderPlanFingerprintSha256: string;
	readonly nativeEffectFingerprintSha256: string;
}

export interface OfxFrozenFallbackV26 {
	readonly externalMediaSourceId: string;
	readonly renderedAssetSha256: string;
	readonly frameCount: number;
	readonly freshness: OfxEffectFreshnessV26;
}

export interface OfxEffectStateV26 {
	readonly schemaVersion: 1;
	readonly instanceId: string;
	readonly pluginId: string;
	readonly binarySha256: string;
	readonly context: OfxContext;
	readonly attachment: Readonly<{ readonly kind: OfxContext; readonly targetId: string }>;
	readonly inputs: readonly OfxInputBindingV1[];
	readonly parameters: readonly OfxParameterStateV1[];
	readonly customEncodings: Readonly<Record<string, string>>;
	readonly enabled: boolean;
	readonly freshness: OfxEffectFreshnessV26;
	readonly frozenFallback: OfxFrozenFallbackV26 | null;
}

export interface OfxEffectRuntimeV26 {
	readonly availability: OfxPluginAvailability;
	readonly pluginId: string | null;
	readonly binarySha256: string | null;
	readonly freshness: OfxEffectFreshnessV26;
}

export interface OfxEffectResolutionV26 {
	readonly mode: 'render' | 'frozen' | 'bypass';
	readonly authoredStatePreserved: true;
	readonly reportsDegradation: boolean;
}

export class OfxEffectStateV26Error extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OfxEffectStateV26Error';
	}
}

const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const STATE_KEYS = Object.freeze([
	'schemaVersion', 'instanceId', 'pluginId', 'binarySha256', 'context',
	'attachment', 'inputs', 'parameters', 'customEncodings', 'enabled',
	'freshness', 'frozenFallback',
]);
const FRESHNESS_KEYS = Object.freeze([
	'authoredStateSha256', 'inputIdentitiesSha256', 'renderPlanFingerprintSha256',
	'nativeEffectFingerprintSha256',
]);
const { digest, exactKeys, pattern, plainRecord: record } = createNativeValidators({
	subject: 'An OFX V26 effect state',
	article: 'An',
	requirePlainPrototype: true,
	raise: (message: string): never => { throw new OfxEffectStateV26Error(message); },
});

export function assertOfxEffectStateV26(value: unknown): asserts value is OfxEffectStateV26 {
	const state = record(value, 'OFX V26 effect state');
	exactKeys(state, STATE_KEYS, 'OFX V26 effect state');
	if (state.schemaVersion !== 1) throw new OfxEffectStateV26Error('An OFX V26 effect state schema is unsupported.');
	const instanceId = pattern(state.instanceId, ID, 'instanceId');
	pattern(state.pluginId, ID, 'pluginId');
	digest(state.binarySha256, 'binarySha256');
	if (!(OFX_CONTEXTS as readonly unknown[]).includes(state.context)) {
		throw new OfxEffectStateV26Error('An OFX V26 effect state context is unsupported.');
	}
	const attachment = record(state.attachment, 'OFX V26 attachment');
	exactKeys(attachment, ['kind', 'targetId'], 'OFX V26 attachment');
	if (attachment.kind !== state.context) {
		throw new OfxEffectStateV26Error('An OFX V26 attachment kind must match its effect context.');
	}
	pattern(attachment.targetId, ID, 'attachment project identity');
	if (typeof state.enabled !== 'boolean') {
		throw new OfxEffectStateV26Error('An OFX V26 effect state must state whether it is enabled.');
	}
	try {
		assertOfxEffectBindingV1({
			bindingId: instanceId,
			pluginId: state.pluginId,
			binarySha256: state.binarySha256,
			context: state.context,
			inputs: state.inputs,
			parameters: state.parameters,
			customEncodings: state.customEncodings,
			enabled: state.enabled,
			frozenRender: null,
		});
	} catch (cause) {
		throw new OfxEffectStateV26Error(
			cause instanceof Error ? cause.message : 'An OFX V26 effect binding is invalid.',
		);
	}
	freshness(state.freshness, 'state freshness');
	if (state.frozenFallback !== null) frozenFallback(state.frozenFallback);
}

export function resolveOfxEffectStateV26(
	state: OfxEffectStateV26,
	runtimeValue: unknown,
): OfxEffectResolutionV26 {
	assertOfxEffectStateV26(state);
	const runtime = record(runtimeValue, 'OFX V26 runtime state');
	exactKeys(runtime, ['availability', 'pluginId', 'binarySha256', 'freshness'], 'OFX V26 runtime state');
	if (!(OFX_PLUGIN_AVAILABILITIES as readonly unknown[]).includes(runtime.availability)) {
		throw new OfxEffectStateV26Error('An OFX V26 runtime availability is unsupported.');
	}
	for (const [key, value] of [['pluginId', runtime.pluginId], ['binarySha256', runtime.binarySha256]] as const) {
		if (value !== null && typeof value !== 'string') {
			throw new OfxEffectStateV26Error(`An OFX V26 runtime ${key} must be a string or null.`);
		}
	}
	if (runtime.pluginId !== null) pattern(runtime.pluginId, ID, 'runtime pluginId');
	if (runtime.binarySha256 !== null) digest(runtime.binarySha256, 'runtime binarySha256');
	const observedFreshness = freshness(runtime.freshness, 'runtime freshness');
	if (!state.enabled) return resolution('bypass', false);
	const exactPlugin = runtime.availability === 'available'
		&& runtime.pluginId === state.pluginId
		&& runtime.binarySha256 === state.binarySha256;
	if (exactPlugin) return resolution('render', false);
	const fallback = state.frozenFallback;
	const frozen = fallback !== null
		&& equalFreshness(fallback.freshness, observedFreshness)
		&& equalFreshness(state.freshness, observedFreshness);
	return resolution(frozen ? 'frozen' : 'bypass', true);
}

function frozenFallback(value: unknown): OfxFrozenFallbackV26 {
	const fallback = record(value, 'OFX V26 frozen fallback');
	exactKeys(
		fallback,
		['externalMediaSourceId', 'renderedAssetSha256', 'frameCount', 'freshness'],
		'OFX V26 frozen fallback',
	);
	const externalMediaSourceId = pattern(
		fallback.externalMediaSourceId, ID, 'frozen external media source ID',
	);
	const renderedAssetSha256 = digest(fallback.renderedAssetSha256, 'frozen rendered asset digest');
	if (!Number.isSafeInteger(fallback.frameCount) || Number(fallback.frameCount) < 1) {
		throw new OfxEffectStateV26Error('An OFX V26 frozen fallback frame count must be positive.');
	}
	return Object.freeze({
		externalMediaSourceId,
		renderedAssetSha256,
		frameCount: Number(fallback.frameCount),
		freshness: freshness(fallback.freshness, 'frozen fallback freshness'),
	});
}

function freshness(value: unknown, name: string): OfxEffectFreshnessV26 {
	const source = record(value, `OFX V26 ${name}`);
	exactKeys(source, FRESHNESS_KEYS, `OFX V26 ${name}`);
	return Object.freeze({
		authoredStateSha256: digest(source.authoredStateSha256, `${name} authoredStateSha256`),
		inputIdentitiesSha256: digest(source.inputIdentitiesSha256, `${name} inputIdentitiesSha256`),
		renderPlanFingerprintSha256: digest(
			source.renderPlanFingerprintSha256, `${name} renderPlanFingerprintSha256`,
		),
		nativeEffectFingerprintSha256: digest(
			source.nativeEffectFingerprintSha256, `${name} nativeEffectFingerprintSha256`,
		),
	});
}

function equalFreshness(left: OfxEffectFreshnessV26, right: OfxEffectFreshnessV26): boolean {
	return (FRESHNESS_KEYS as readonly (keyof OfxEffectFreshnessV26)[])
		.every((key) => left[key] === right[key]);
}

function resolution(
	mode: OfxEffectResolutionV26['mode'],
	reportsDegradation: boolean,
): OfxEffectResolutionV26 {
	return Object.freeze({ mode, authoredStatePreserved: true as const, reportsDegradation });
}
