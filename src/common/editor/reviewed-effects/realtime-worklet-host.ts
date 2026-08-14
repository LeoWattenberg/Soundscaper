/* SPDX-License-Identifier: AGPL-3.0-only */

import { reviewedEffectError } from './errors.ts';
import { resolveReviewedEffectCatalogEntry } from './catalog.ts';
import {
	REVIEWED_EFFECT_ABI_VERSION,
	type ReviewedEffectManifest,
} from './manifest.ts';
import { loadReviewedEffectPackage } from './runtime.ts';

export const REVIEWED_EFFECT_WORKLET_NAME = 'soundscaper-reviewed-effect-v1';

export interface ReviewedEffectRealtimeOptions {
	readonly channelCount: number;
	readonly parameters?: Readonly<Record<string, number>>;
}

const loadedContexts = new WeakSet<BaseAudioContext>();
const pendingContextLoads = new WeakMap<BaseAudioContext, Promise<void>>();

/** Create only separately realtime-approved catalog packages in the static host. */
export async function createReviewedEffectRealtimeNode(
	context: BaseAudioContext,
	packageReference: unknown,
	options: ReviewedEffectRealtimeOptions,
): Promise<AudioWorkletNode> {
	if (!context.audioWorklet?.addModule || typeof globalThis.AudioWorkletNode !== 'function') {
		throw reviewedEffectError('REALTIME_NOT_APPROVED', 'Reviewed realtime effects require AudioWorklet support.');
	}
	const descriptor = resolveReviewedEffectCatalogEntry(packageReference);
	if (!descriptor.realtimeApproved) {
		throw reviewedEffectError('REALTIME_NOT_APPROVED', 'This reviewed effect is not approved for realtime hosting.');
	}
	const channelCount = options.channelCount;
	if (!Number.isSafeInteger(channelCount) || channelCount < 1
		|| channelCount > descriptor.manifest.resources.maximumChannels) {
		throw reviewedEffectError('INPUT_LIMIT', 'Reviewed realtime effect channel count exceeds its package limit.');
	}
	const parameterValues = normalizeParameters(descriptor.manifest, options.parameters);
	const loadedPackage = await loadReviewedEffectPackage(packageReference);
	await ensureWorkletSource(context);
	return new globalThis.AudioWorkletNode(context, REVIEWED_EFFECT_WORKLET_NAME, {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		channelCount,
		channelCountMode: 'explicit',
		channelInterpretation: 'discrete',
		outputChannelCount: [channelCount],
		processorOptions: {
			packageKey: loadedPackage.key,
			abiVersion: REVIEWED_EFFECT_ABI_VERSION,
			wasmModule: loadedPackage.module,
			channelCount,
			parameterValues,
		},
	});
}

export function configureReviewedEffectRealtimeNode(
	node: AudioWorkletNode,
	packageReference: unknown,
	parameters: Readonly<Record<string, number>>,
): void {
	if (!node?.port || typeof node.port.postMessage !== 'function') {
		throw new TypeError('An AudioWorkletNode with a MessagePort is required.');
	}
	const descriptor = resolveReviewedEffectCatalogEntry(packageReference);
	if (!descriptor.realtimeApproved) {
		throw reviewedEffectError('REALTIME_NOT_APPROVED', 'This reviewed effect is not approved for realtime hosting.');
	}
	node.port.postMessage({
		type: 'parameters',
		values: normalizeParameters(descriptor.manifest, parameters),
	});
}

async function ensureWorkletSource(context: BaseAudioContext): Promise<void> {
	if (loadedContexts.has(context)) return;
	let pending = pendingContextLoads.get(context);
	if (!pending) {
		pending = context.audioWorklet.addModule(new URL('./realtime-worklet.js', import.meta.url).href)
			.then(() => { loadedContexts.add(context); });
		pendingContextLoads.set(context, pending);
	}
	try {
		await pending;
	} finally {
		pendingContextLoads.delete(context);
	}
}

function normalizeParameters(
	manifest: ReviewedEffectManifest,
	value: Readonly<Record<string, number>> | undefined,
): readonly number[] {
	const candidate: unknown = value ?? {};
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
		|| (Object.getPrototypeOf(candidate) !== Object.prototype && Object.getPrototypeOf(candidate) !== null)) {
		throw reviewedEffectError('INPUT_LIMIT', 'Reviewed realtime effect parameters must be a plain object.');
	}
	const identifiers = new Set(manifest.parameters.map(({ id }) => id));
	for (const key of Reflect.ownKeys(candidate)) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (typeof key !== 'string' || !identifiers.has(key) || !descriptor?.enumerable
			|| !Object.hasOwn(descriptor, 'value')) {
			throw reviewedEffectError('INPUT_LIMIT', `Unknown reviewed realtime effect parameter: ${String(key)}.`);
		}
	}
	const record = candidate as Readonly<Record<string, unknown>>;
	return Object.freeze(manifest.parameters.map((parameter) => {
		const parameterValue = record[parameter.id] ?? parameter.defaultValue;
		if (typeof parameterValue !== 'number' || !Number.isFinite(parameterValue)
			|| parameterValue < parameter.minimum || parameterValue > parameter.maximum) {
			throw reviewedEffectError('INPUT_LIMIT', `Reviewed realtime parameter ${parameter.id} is outside its range.`);
		}
		return parameterValue;
	}));
}
