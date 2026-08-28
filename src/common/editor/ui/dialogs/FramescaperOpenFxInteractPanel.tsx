/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-owned, authored-instance OpenFX Interact Suite V1 surface. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
	FramescaperNativeOpenFxAuthoringRuntimeNativeMedia,
	FramescaperOpenFxInteractAuthoringModelNativeMedia,
	FramescaperOpenFxInteractInstanceNativeMedia,
} from '../../../../framescaper/editor-native-openfx-action.ts';
import {
	framescaperOpenFxInteractEffectStateSha256V1,
	framescaperOpenFxInteractRequestV1,
	OFX_INTERACT_MAXIMUM_EVENTS_V1,
	type FramescaperOpenFxInteractRequestV1,
} from '../../native-ofx-interact-contract.ts';
import type { OfxInteractEventV1 } from '../../native-ofx-host-contract.ts';
import type { FramescaperNativeServicesBridge } from '../framescaper-native-services-bridge.ts';
import type { FramescaperNativeServicesCopy } from '../framescaper-native-services-copy.ts';

type OfxInteractModifier = 'alt' | 'control' | 'meta' | 'shift';
type UnsequencedOfxInteractEvent =
	| Omit<Extract<OfxInteractEventV1, { readonly kind: 'pointer' }>, 'sequence'>
	| Omit<Extract<OfxInteractEventV1, { readonly kind: 'keyboard' }>, 'sequence'>
	| Omit<Extract<OfxInteractEventV1, { readonly kind: 'focus' }>, 'sequence'>;
type InteractTarget = Readonly<{
	target: FramescaperOpenFxInteractRequestV1['target'];
	parameterName: string | null;
}>;
const EMPTY_MODIFIERS: readonly OfxInteractModifier[] = Object.freeze([]);

export default function FramescaperOpenFxInteractPanel({ bridge, runtime, copy }: Readonly<{
	bridge: FramescaperNativeServicesBridge;
	runtime: FramescaperNativeOpenFxAuthoringRuntimeNativeMedia;
	copy: FramescaperNativeServicesCopy;
}>) {
	const [model, setModel] = useState<FramescaperOpenFxInteractAuthoringModelNativeMedia | null>(null);
	const [instanceId, setInstanceId] = useState('');
	const [targetValue, setTargetValue] = useState('overlay');
	const [status, setStatus] = useState(copy.ofxInteractLoading);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const sequenceRef = useRef(0);
	const historyRef = useRef<readonly OfxInteractEventV1[]>(Object.freeze([]));
	const generationRef = useRef(0);
	const mountedRef = useRef(true);
	const serialRef = useRef<Promise<void>>(Promise.resolve());
	const authoritiesRef = useRef(new Map<string, FramescaperOpenFxInteractInstanceNativeMedia>());

	const installModel = useCallback((value: FramescaperOpenFxInteractAuthoringModelNativeMedia): void => {
		authoritiesRef.current = new Map(value.instances.map((instance) => [
			instance.effect.instanceId, instance,
		]));
		setModel(value);
	}, []);
	useEffect(() => () => { mountedRef.current = false; generationRef.current += 1; }, []);
	useEffect(() => {
		let active = true;
		void runtime.interactModel().then((value) => {
			if (!active) return;
			installModel(value);
			const first = value.instances[0];
			if (!first) { setStatus(copy.ofxInteractNoPlugins); return; }
			setInstanceId(first.effect.instanceId);
			setStatus(copy.ofxInteractReady);
		}, (error: unknown) => {
			if (!active) return;
			installModel(Object.freeze({ instances: Object.freeze([]) }));
			setStatus(message(error));
		});
		return () => { active = false; };
	}, [copy, installModel, runtime]);

	const instance = useMemo(() => model?.instances.find(({ effect }) => (
		effect.instanceId === instanceId
	)) ?? null, [instanceId, model]);
	const target = useMemo(() => parseTarget(targetValue), [targetValue]);
	const submit = useCallback((
		events: readonly OfxInteractEventV1[],
		commitMutations = false,
	): void => {
		if (instance === null || typeof bridge.runOpenFxInteract !== 'function') {
			setStatus(copy.ofxInteractUnavailable); return;
		}
		const selectedId = instance.effect.instanceId;
		const selectedTarget = target;
		const generation = generationRef.current;
		setStatus(copy.ofxInteractWorking);
		serialRef.current = serialRef.current.catch(() => undefined).then(async () => {
			try {
				const authority = authoritiesRef.current.get(selectedId);
				if (!authority) throw new Error('The authored OpenFX Interact instance is stale.');
				const request = createFramescaperOpenFxInteractRequestV1(
					authority, selectedTarget, events,
				);
				const result = await bridge.runOpenFxInteract!(request);
				if (commitMutations) {
					const committed = await runtime.commitInteract(request, result);
					authoritiesRef.current.set(committed.effect.instanceId, committed);
					if (result.parameterMutations.length > 0) {
						const refreshed = await runtime.interactModel();
						authoritiesRef.current = new Map(refreshed.instances.map((value) => [
							value.effect.instanceId, value,
						]));
						if (mountedRef.current) setModel(refreshed);
					}
				}
				if (!mountedRef.current || generation !== generationRef.current) return;
				if (result.surfaceDisposition === 'drawn') paint(canvasRef.current, result.rgba);
				setStatus(result.redrawRequested ? copy.ofxInteractRedrawn : copy.ofxInteractReady);
			} catch (error) {
				if (mountedRef.current && generation === generationRef.current) setStatus(message(error));
			}
		});
	}, [bridge, copy, instance, runtime, target]);

	useEffect(() => {
		if (instance === null) return;
		generationRef.current += 1;
		sequenceRef.current = 0;
		historyRef.current = Object.freeze([]);
		submit(Object.freeze([]));
	}, [instance, submit, targetValue]);

	const event = useCallback((value: UnsequencedOfxInteractEvent): void => {
		if (!Number.isSafeInteger(sequenceRef.current) || sequenceRef.current < 0
			|| historyRef.current.length >= OFX_INTERACT_MAXIMUM_EVENTS_V1) {
			setStatus(copy.ofxInteractSequenceExhausted); return;
		}
		const sequenced = Object.freeze({ ...value, sequence: sequenceRef.current }) as OfxInteractEventV1;
		historyRef.current = appendOpenFxInteractReplay(historyRef.current, sequenced);
		sequenceRef.current += 1;
		const terminal = sequenced.kind === 'focus' && !sequenced.focused;
		submit(historyRef.current, terminal);
		if (terminal) historyRef.current = Object.freeze([]);
	}, [copy.ofxInteractSequenceExhausted, submit]);
	const pointer = useCallback((
		phase: 'motion' | 'down' | 'up', value: React.PointerEvent<HTMLCanvasElement>,
	): void => {
		const normalized = normalizeOpenFxPointer(value.currentTarget.getBoundingClientRect(), value);
		event({ kind: 'pointer', phase, ...normalized, modifiers: openFxModifiers(value) });
	}, [event]);

	const chooseInstance = (value: string): void => {
		generationRef.current += 1;
		setInstanceId(value); setTargetValue('overlay');
	};

	return <section aria-label={copy.ofxInteractHeading} data-framescaper-openfx-interact="true">
		<h3>{copy.ofxInteractHeading}</h3>
		<p id="framescaper-openfx-interact-help">{copy.ofxInteractInstructions}</p>
		<p role="status" aria-live="polite" data-framescaper-openfx-interact-status="true">{status}</p>
		{model !== null && model.instances.length > 0 && <>
			<p><label>{copy.ofxInteractInstance}<br /><select value={instanceId}
				data-framescaper-openfx-interact-instance="true"
				onChange={(value) => chooseInstance(value.currentTarget.value)}>
				{model.instances.map((entry) => <option key={entry.effect.instanceId}
					value={entry.effect.instanceId}>{entry.label}</option>)}
			</select></label></p>
			<p>{copy.ofxContext}: <output data-framescaper-openfx-interact-context="true">
				{instance?.effect.context}
			</output></p>
			<p><label>{copy.ofxInteractTarget}<br /><select value={targetValue}
				data-framescaper-openfx-interact-target="true"
				onChange={(value) => setTargetValue(value.currentTarget.value)}>
				<option value="overlay">{copy.ofxInteractOverlay}</option>
				{instance?.customParameterNames.map((name) => (
					<option key={name} value={`custom:${name}`}>{copy.ofxInteractCustom} — {name}</option>
				))}
			</select></label></p>
			<canvas ref={canvasRef} width={64} height={64} tabIndex={0} role="application"
				aria-label={copy.ofxInteractCanvas} aria-describedby="framescaper-openfx-interact-help"
				data-framescaper-openfx-interact-canvas="64x64"
				style={{ width: 256, height: 256, maxWidth: '100%', imageRendering: 'pixelated',
					border: '2px solid CanvasText', background: 'Canvas', forcedColorAdjust: 'none',
					touchAction: 'none', outlineOffset: 3 }}
				onPointerMove={(value) => pointer('motion', value)}
				onPointerDown={(value) => {
					try { value.currentTarget.setPointerCapture(value.pointerId); } catch { /* unavailable */ }
					pointer('down', value);
				}}
				onPointerUp={(value) => {
					pointer('up', value);
					try { value.currentTarget.releasePointerCapture(value.pointerId); } catch { /* unavailable */ }
				}}
				onKeyDown={(value) => event({ kind: 'keyboard', phase: 'down',
					key: value.key, code: value.code, modifiers: openFxModifiers(value) })}
				onKeyUp={(value) => event({ kind: 'keyboard', phase: 'up',
					key: value.key, code: value.code, modifiers: openFxModifiers(value) })}
				onFocus={() => event({ kind: 'focus', focused: true })}
				onBlur={() => event({ kind: 'focus', focused: false })}
			/>
		</>}
	</section>;
}

export function createFramescaperOpenFxInteractRequestV1(
	instance: FramescaperOpenFxInteractInstanceNativeMedia,
	target: InteractTarget,
	events: readonly OfxInteractEventV1[],
): FramescaperOpenFxInteractRequestV1 {
	return framescaperOpenFxInteractRequestV1({
		protocolVersion: 1, project: instance.project, pluginHandle: instance.pluginHandle,
		effect: instance.effect,
		effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(instance.effect),
		context: instance.effect.context, target: target.target,
		parameterName: target.parameterName, events,
	});
}

export function normalizeOpenFxPointer(
	rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
	value: Pick<React.PointerEvent<HTMLCanvasElement>, 'clientX' | 'clientY' | 'button'>,
): Readonly<{ x: number; y: number; button: number }> {
	const x = rect.width > 0 ? clamp((value.clientX - rect.left) / rect.width) : 0;
	const y = rect.height > 0 ? clamp((value.clientY - rect.top) / rect.height) : 0;
	const button = Number.isSafeInteger(value.button) && value.button >= 0 && value.button <= 7
		? value.button : 0;
	return Object.freeze({ x, y, button });
}

export function openFxModifiers(
	value: Readonly<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>,
): readonly OfxInteractModifier[] {
	const modifiers: OfxInteractModifier[] = [];
	if (value.altKey) modifiers.push('alt');
	if (value.ctrlKey) modifiers.push('control');
	if (value.metaKey) modifiers.push('meta');
	if (value.shiftKey) modifiers.push('shift');
	return modifiers.length === 0 ? EMPTY_MODIFIERS : Object.freeze(modifiers);
}

/** Append one event to the bounded history replayed inside each fresh native lifecycle. */
export function appendOpenFxInteractReplay(
	history: readonly OfxInteractEventV1[],
	event: OfxInteractEventV1,
): readonly OfxInteractEventV1[] {
	if (history.length >= OFX_INTERACT_MAXIMUM_EVENTS_V1) {
		throw new RangeError('The OpenFX Interact replay is full.');
	}
	const previous = history.at(-1);
	if (!Number.isSafeInteger(event.sequence) || event.sequence < 0
		|| (previous !== undefined && event.sequence <= previous.sequence)) {
		throw new RangeError('OpenFX Interact replay sequences must increase.');
	}
	return Object.freeze([...history, event]);
}

function parseTarget(value: string): InteractTarget {
	return value.startsWith('custom:')
		? Object.freeze({ target: 'custom-parameter', parameterName: value.slice(7) })
		: Object.freeze({ target: 'overlay', parameterName: null });
}

function paint(canvas: HTMLCanvasElement | null, rgba: Uint8Array): void {
	const context = canvas?.getContext('2d');
	if (!context) throw new Error('The browser cannot display the OpenFX offscreen surface.');
	const image = context.createImageData(64, 64);
	image.data.set(rgba); context.putImageData(image, 0, 0);
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
