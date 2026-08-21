/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	selectWebVcrTarget,
	type WebVcrTargetGeometryCandidate,
	type WebVcrTargetSelection,
} from '../src/common/editor/web-vcr-geometry.ts';
import type {
	WebVcrDimensions,
	WebVcrMediaState,
} from '../src/common/editor/web-vcr-domain.ts';
import {
	FRAMESCAPER_WEB_VCR_TARGET_BINDING,
	FRAMESCAPER_WEB_VCR_TARGET_TRACKER_SOURCE,
} from './framescaper-web-vcr-target-tracker.ts';

export { FRAMESCAPER_WEB_VCR_TARGET_BINDING } from './framescaper-web-vcr-target-tracker.ts';
const ISOLATED_WORLD = 'framescaper-web-vcr-target-v1';
const MAX_BINDING_PAYLOAD = 32_768;
const MAX_CANDIDATES = 16;

type ObservedFallbackReason = 'canvas-player' | 'inaccessible-shadow-dom' | 'unsupported-transform';

interface TargetCandidateV1 extends Omit<
	WebVcrTargetGeometryCandidate,
	'targetId' | 'manualFallbackReason'
> {
	readonly slot: number;
	readonly manualFallbackReason: ObservedFallbackReason | null;
}

export interface FramescaperWebVcrTargetObservationV1 {
	readonly version: 1;
	readonly sequence: number;
	readonly candidates: readonly Readonly<TargetCandidateV1>[];
	readonly ended: Readonly<{
		readonly slot: number;
		readonly generation: number;
		readonly recordingToken: string | null;
	}> | null;
}

export interface FramescaperWebVcrResolvedTargetObservationV1 {
	readonly navigationGeneration: number;
	readonly selection: WebVcrTargetSelection;
	readonly targets: readonly Readonly<{
		readonly targetId: string;
		readonly generation: number;
		readonly mediaState: WebVcrMediaState;
	}>[];
	readonly endedTarget: Readonly<{
		readonly targetId: string;
		readonly generation: number;
		readonly endedRecordingToken: string | null;
	}> | null;
}

export interface FramescaperWebVcrDebuggerPort {
	isAttached(): boolean;
	attach(protocolVersion: string): void;
	detach(): void;
	sendCommand(method: string, parameters?: unknown): Promise<unknown>;
	on(name: 'message', listener: (event: unknown, method: string, parameters: unknown) => void): void;
	removeListener(
		name: 'message',
		listener: (event: unknown, method: string, parameters: unknown) => void,
	): void;
}

interface ObserverOptions {
	readonly debuggerPort: FramescaperWebVcrDebuggerPort;
	readonly viewport: Readonly<WebVcrDimensions>;
	readonly navigationGeneration: () => number;
	readonly createOpaqueId: () => string;
	readonly onObservation: (value: Readonly<FramescaperWebVcrResolvedTargetObservationV1>) => void;
	readonly onFailure: (error: unknown) => void;
}

export interface FramescaperWebVcrTargetObserverV1 {
	start(): Promise<void>;
	setRecordingToken(value: string | null): Promise<void>;
	dispose(): void;
}

export function createFramescaperWebVcrTargetObserverV1(
	value: ObserverOptions,
): Readonly<FramescaperWebVcrTargetObserverV1> {
	const options = validateOptions(value);
	const identities = new Map<string, string>();
	let started = false;
	let disposed = false;
	let attachedHere = false;
	let lastNavigationGeneration = 0;
	let lastSequence = 0;
	let mainFrameId: string | null = null;
	let mainExecutionContextId: number | null = null;
	const isolatedContexts = new Map<number, string>();

	const receive = (_event: unknown, method: string, parametersValue: unknown): void => {
		if (disposed) return;
		try {
			if (method === 'Runtime.executionContextCreated') {
				const parameters = record(parametersValue);
				const context = record(parameters.context);
				const auxiliary = record(context.auxData);
				if (context.name !== ISOLATED_WORLD || typeof auxiliary.frameId !== 'string') return;
				const contextId = positiveInteger(context.id, 'Web VCR execution context');
				isolatedContexts.set(contextId, auxiliary.frameId);
				if (auxiliary.frameId === mainFrameId) mainExecutionContextId = contextId;
				return;
			}
			if (method === 'Runtime.executionContextDestroyed') {
				const contextId = Number(record(parametersValue).executionContextId);
				if (!Number.isSafeInteger(contextId) || contextId <= 0) return;
				isolatedContexts.delete(contextId);
				if (mainExecutionContextId === contextId) mainExecutionContextId = null;
				return;
			}
			if (method === 'Runtime.executionContextsCleared') {
				isolatedContexts.clear();
				mainExecutionContextId = null;
				return;
			}
			if (method === 'Page.frameNavigated') {
				const frame = record(record(parametersValue).frame);
				if (typeof frame.id === 'string' && typeof frame.parentId !== 'string') {
					mainFrameId = frame.id;
					mainExecutionContextId = null;
					for (const [contextId, frameId] of isolatedContexts) {
						if (frameId === mainFrameId) isolatedContexts.delete(contextId);
					}
				}
				return;
			}
			if (method !== 'Runtime.bindingCalled') return;
			const parameters = closedRecord(
				parametersValue,
				['name', 'payload', 'executionContextId'],
				'Web VCR CDP binding event',
			);
			if (parameters.name !== FRAMESCAPER_WEB_VCR_TARGET_BINDING) return;
			const contextId = positiveInteger(parameters.executionContextId, 'Web VCR binding context');
			if (contextId !== mainExecutionContextId) return;
			if (typeof parameters.payload !== 'string' || parameters.payload.length > MAX_BINDING_PAYLOAD) {
				throw new TypeError('Web VCR target binding payload exceeds its bound.');
			}
			const observation = validateFramescaperWebVcrTargetObservationV1(
				JSON.parse(parameters.payload) as unknown,
			);
			const navigationGeneration = positiveInteger(
				options.navigationGeneration(),
				'Web VCR navigation generation',
			);
			if (navigationGeneration !== lastNavigationGeneration) {
				lastNavigationGeneration = navigationGeneration;
				lastSequence = 0;
			}
			if (observation.sequence <= lastSequence) return;
			lastSequence = observation.sequence;
			const candidates = observation.candidates.map((candidate) => Object.freeze({
				...candidate,
				targetId: identityFor(navigationGeneration, candidate.slot, candidate.generation),
			}));
			const endedTarget = observation.ended === null ? null : Object.freeze({
				targetId: identityFor(
					navigationGeneration,
					observation.ended.slot,
					observation.ended.generation,
				),
				generation: observation.ended.generation,
				endedRecordingToken: observation.ended.recordingToken,
			});
			options.onObservation(Object.freeze({
				navigationGeneration,
				selection: selectWebVcrTarget({ viewport: options.viewport, candidates }),
				targets: Object.freeze(candidates.map(({ targetId, generation, mediaState }) => Object.freeze({
					targetId, generation, mediaState,
				}))),
				endedTarget,
			}));
		} catch (error) {
			options.onFailure(error);
		}
	};

	return Object.freeze({
		async start(): Promise<void> {
			if (disposed) throw new Error('Web VCR target observer is disposed.');
			if (started) return;
			started = true;
			try {
				if (!options.debuggerPort.isAttached()) {
					options.debuggerPort.attach('1.3');
					attachedHere = true;
				}
				options.debuggerPort.on('message', receive);
				await options.debuggerPort.sendCommand('Page.enable');
				await options.debuggerPort.sendCommand('Runtime.enable');
				mainFrameId = mainFrameIdFromTree(
					await options.debuggerPort.sendCommand('Page.getFrameTree'),
				);
				for (const [contextId, frameId] of isolatedContexts) {
					if (frameId === mainFrameId) mainExecutionContextId = contextId;
				}
				await options.debuggerPort.sendCommand('Runtime.addBinding', {
					name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
					executionContextName: ISOLATED_WORLD,
				});
				await options.debuggerPort.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
					source: FRAMESCAPER_WEB_VCR_TARGET_TRACKER_SOURCE,
					worldName: ISOLATED_WORLD,
					includeCommandLineAPI: false,
					runImmediately: true,
				});
			} catch (error) {
				disposeObserver();
				throw error;
			}
		},
		async setRecordingToken(value: string | null): Promise<void> {
			const token = value === null ? null : opaqueId(value);
			const contextId = mainExecutionContextId;
			if (disposed || !started || contextId === null) {
				throw new Error('Web VCR main-frame recording fence is unavailable.');
			}
			try {
				const response = record(await options.debuggerPort.sendCommand('Runtime.callFunctionOn', {
					functionDeclaration: RECORDING_FENCE_FUNCTION,
					executionContextId: contextId,
					arguments: [{ value: token }],
					returnByValue: true,
					awaitPromise: false,
					userGesture: false,
				}));
				const result = record(response.result);
				if (contextId !== mainExecutionContextId || result.value !== true) {
					throw new Error('Web VCR main-frame recording fence did not acknowledge the token.');
				}
			} catch (error) {
				options.onFailure(error);
				throw error;
			}
		},
		dispose: disposeObserver,
	});

	function identityFor(navigation: number, slot: number, generation: number): string {
		const key = `${String(navigation)}:${String(slot)}:${String(generation)}`;
		let identity = identities.get(key);
		if (!identity) {
			identity = opaqueId(options.createOpaqueId());
			identities.set(key, identity);
			if (identities.size > MAX_CANDIDATES * 4) {
				const oldest = identities.keys().next().value as string | undefined;
				if (oldest) identities.delete(oldest);
			}
		}
		return identity;
	}

	function disposeObserver(): void {
		if (disposed) return;
		disposed = true;
		options.debuggerPort.removeListener('message', receive);
		if (attachedHere && options.debuggerPort.isAttached()) options.debuggerPort.detach();
		identities.clear();
		isolatedContexts.clear();
	}
}

export function validateFramescaperWebVcrTargetObservationV1(
	value: unknown,
): Readonly<FramescaperWebVcrTargetObservationV1> {
	const record = closedRecord(
		value,
		['version', 'sequence', 'candidates', 'ended'],
		'Web VCR target observation',
	);
	if (record.version !== 1) throw new TypeError('Web VCR target observation version is invalid.');
	if (!Array.isArray(record.candidates) || record.candidates.length > MAX_CANDIDATES) {
		throw new RangeError('Web VCR target candidate inventory exceeds its limit.');
	}
	const candidates = record.candidates.map((candidate, index) => validateCandidate(candidate, index));
	const ended = record.ended === null ? null : validateEnded(record.ended);
	return Object.freeze({
		version: 1,
		sequence: positiveInteger(record.sequence, 'Web VCR target observation sequence'),
		candidates: Object.freeze(candidates),
		ended,
	});
}

function validateCandidate(value: unknown, index: number): Readonly<TargetCandidateV1> {
	const label = `Web VCR target candidate ${String(index)}`;
	const record = closedRecord(value, [
		'slot', 'generation', 'mediaState', 'elementRect', 'clipRect', 'intrinsicSize',
		'objectFit', 'objectPosition', 'manualFallbackReason',
	], label);
	const mediaStates = ['playing', 'paused', 'ended'] as const;
	const objectFits = ['fill', 'contain', 'cover', 'none', 'scale-down'] as const;
	const fallbackReasons = ['canvas-player', 'inaccessible-shadow-dom', 'unsupported-transform'] as const;
	if (!mediaStates.includes(record.mediaState as WebVcrMediaState)
		|| !objectFits.includes(record.objectFit as typeof objectFits[number])
		|| (record.manualFallbackReason !== null
			&& !fallbackReasons.includes(record.manualFallbackReason as typeof fallbackReasons[number]))) {
		throw new TypeError(`${label} has an invalid media geometry vocabulary.`);
	}
	return Object.freeze({
		slot: positiveInteger(record.slot, `${label} slot`, 65_535),
		generation: positiveInteger(record.generation, `${label} generation`),
		mediaState: record.mediaState as WebVcrMediaState,
		elementRect: pixelRect(record.elementRect, `${label} element rectangle`),
		clipRect: record.clipRect === null ? null : pixelRect(record.clipRect, `${label} clip rectangle`),
		intrinsicSize: dimensions(record.intrinsicSize, `${label} intrinsic size`),
		objectFit: record.objectFit as typeof objectFits[number],
		objectPosition: objectPosition(record.objectPosition, label),
		manualFallbackReason: record.manualFallbackReason as ObservedFallbackReason | null,
	});
}

function validateEnded(value: unknown): FramescaperWebVcrTargetObservationV1['ended'] {
	const record = closedRecord(value, ['slot', 'generation', 'recordingToken'], 'Web VCR ended target');
	return Object.freeze({
		slot: positiveInteger(record.slot, 'Web VCR ended target slot', 65_535),
		generation: positiveInteger(record.generation, 'Web VCR ended target generation'),
		recordingToken: record.recordingToken === null ? null : opaqueId(record.recordingToken),
	});
}

function pixelRect(value: unknown, label: string) {
	const record = closedRecord(value, ['x', 'y', 'width', 'height'], label);
	return Object.freeze({
		x: boundedNumber(record.x, `${label} x`, -32_768, 32_768),
		y: boundedNumber(record.y, `${label} y`, -32_768, 32_768),
		width: positiveNumber(record.width, `${label} width`, 32_768),
		height: positiveNumber(record.height, `${label} height`, 32_768),
	});
}

function dimensions(value: unknown, label: string) {
	const record = closedRecord(value, ['width', 'height'], label);
	return Object.freeze({
		width: positiveInteger(record.width, `${label} width`, 16_384),
		height: positiveInteger(record.height, `${label} height`, 16_384),
	});
}

function objectPosition(value: unknown, label: string) {
	const record = closedRecord(value, ['x', 'y'], `${label} object position`);
	return Object.freeze({
		x: positionComponent(record.x, `${label} horizontal object position`),
		y: positionComponent(record.y, `${label} vertical object position`),
	});
}

function positionComponent(value: unknown, label: string) {
	const record = closedRecord(value, ['fraction', 'offsetPixels'], label);
	return Object.freeze({
		fraction: boundedNumber(record.fraction, `${label} fraction`, -4, 4),
		offsetPixels: boundedNumber(record.offsetPixels, `${label} offset`, -16_384, 16_384),
	});
}

function validateOptions(value: ObserverOptions): ObserverOptions {
	if (!value || typeof value !== 'object' || !value.debuggerPort
		|| typeof value.debuggerPort.isAttached !== 'function'
		|| typeof value.debuggerPort.attach !== 'function' || typeof value.debuggerPort.detach !== 'function'
		|| typeof value.debuggerPort.sendCommand !== 'function' || typeof value.debuggerPort.on !== 'function'
		|| typeof value.debuggerPort.removeListener !== 'function'
		|| !value.viewport || typeof value.navigationGeneration !== 'function'
		|| typeof value.createOpaqueId !== 'function' || typeof value.onObservation !== 'function'
		|| typeof value.onFailure !== 'function') {
		throw new TypeError('Web VCR target observer seams are invalid.');
	}
	return value;
}

function closedRecord(value: unknown, fields: readonly string[], label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a closed record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| fields.some((field) => !Object.hasOwn(value, field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>> : Object.freeze({});
}

function mainFrameIdFromTree(value: unknown): string {
	const frame = record(record(record(value).frameTree).frame);
	if (typeof frame.id !== 'string' || frame.id.length === 0) {
		throw new TypeError('Web VCR main frame identity is unavailable.');
	}
	return frame.id;
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
		throw new RangeError(`${label} must be a bounded positive safe integer.`);
	}
	return Number(value);
}

function positiveNumber(value: unknown, label: string, maximum: number): number {
	const result = boundedNumber(value, label, 0, maximum);
	if (result === 0) throw new RangeError(`${label} must be positive.`);
	return result;
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${label} is outside its numeric bound.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
		throw new TypeError('Web VCR target observer opaque identity is invalid.');
	}
	return value;
}

const RECORDING_FENCE_FUNCTION = `function (token) {
	const fence = globalThis.__framescaperWebVcrRecordingFenceV1;
	return Boolean(fence && fence.set(token) === true);
}`;
