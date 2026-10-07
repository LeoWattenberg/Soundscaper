import { useCallback, useEffect, useRef } from 'react';
import { createTimelinePointerIndicatorRuntime } from './timeline-pointer-indicator-runtime.ts';

export function useTimelinePointerPositionIndicators(panelRef, scrollRef) {
	const timeIndicatorRef = useRef(null);
	const verticalIndicatorRef = useRef(null);
	const runtimeRef = useRef(null);
	useEffect(() => {
		const runtime = createTimelinePointerIndicatorRuntime({ panelRef, scrollRef, timeIndicatorRef, verticalIndicatorRef,
			request: callback => requestAnimationFrame(callback), cancel: frame => cancelAnimationFrame(frame) });
		runtimeRef.current = runtime;
		return () => { runtime.dispose(); runtimeRef.current = null; };
	}, [panelRef, scrollRef]);
	const hidePointerPosition = useCallback(() => runtimeRef.current?.hide(), []);
	const updatePointerPosition = useCallback(event => runtimeRef.current?.update(event), []);
	return { timeIndicatorRef, verticalIndicatorRef, updatePointerPosition, hidePointerPosition };
}
