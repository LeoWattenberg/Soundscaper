/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface Params { readonly bands: readonly Readonly<{ id: string }>[] }
interface Gesture<Value> {
	readonly start: Value;
	readonly latest: Value;
	readonly automationParameter?: string | null;
	readonly bandId?: string;
	readonly pointerId?: number;
}
interface Options<Value extends Params> {
	readonly dragRef: RefObject<Gesture<Value> | null>;
	readonly outputGestureRef: RefObject<Gesture<Value> | null>;
	readonly previewFrameRef: RefObject<number>;
	readonly pendingPreviewRef: RefObject<Value | null>;
	readonly graphRef: RefObject<HTMLElement | null>;
	readonly setDraft: (value: Value) => void;
	readonly setSelectedId: (update: (current: string | null) => string | null) => void;
	readonly onCancel?: (value: Value) => void;
	readonly parameterAutomation?: Readonly<{ cancel(parameter: string, band: string | null): unknown }>;
}

/** An external authored edit retires the old preview without restoring its obsolete start. */
export function useParametricEqAuthoredState<Value extends Params>(normalized: Value, options: Options<Value>): number {
	const authored = JSON.stringify(normalized);
	const previous = useRef(authored);
	const currentOptions = useRef(options);
	currentOptions.current = options;
	const [epoch, setEpoch] = useState(0);
	useLayoutEffect(() => {
		const changed = previous.current !== authored;
		previous.current = authored;
		const current = currentOptions.current;
		const drag = current.dragRef.current;
		const gesture = drag ?? current.outputGestureRef.current;
		if (gesture) {
			if (!changed || JSON.stringify(gesture.latest) === authored) return;
			current.dragRef.current = null;
			current.outputGestureRef.current = null;
			if (current.previewFrameRef.current) cancelAnimationFrame(current.previewFrameRef.current);
			current.previewFrameRef.current = 0;
			current.pendingPreviewRef.current = null;
			if (drag?.pointerId !== undefined) {
				const handle = [...(current.graphRef.current?.querySelectorAll<HTMLElement>('[data-band-id]') ?? [])]
					.find(node => node.dataset.bandId === drag.bandId);
				if (handle?.hasPointerCapture?.(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
			}
			if (gesture.automationParameter) current.parameterAutomation?.cancel(gesture.automationParameter, drag?.bandId ?? null);
			else current.onCancel?.(gesture.start);
			setEpoch(value => value + 1);
		}
		current.setDraft(normalized);
		current.setSelectedId(selected => normalized.bands.some(band => band.id === selected)
			? selected : normalized.bands[0]?.id ?? null);
	}, [authored, normalized]);
	return epoch;
}
