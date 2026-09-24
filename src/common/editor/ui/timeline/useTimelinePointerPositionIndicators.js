import { useCallback, useRef } from 'react';

export function useTimelinePointerPositionIndicators(panelRef, scrollRef) {
	const timeIndicatorRef = useRef(null);
	const verticalIndicatorRef = useRef(null);
	const hidePointerPosition = useCallback(() => {
		if (timeIndicatorRef.current) timeIndicatorRef.current.hidden = true;
		if (verticalIndicatorRef.current) verticalIndicatorRef.current.hidden = true;
	}, []);
	const updatePointerPosition = useCallback((event) => {
		if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
			hidePointerPosition();
			return;
		}
		const panel = panelRef.current;
		const scroll = scrollRef.current;
		const ruler = scroll?.querySelector('[data-ruler]');
		if (!panel || !scroll || !ruler) return;
		const rulerRect = ruler.getBoundingClientRect();
		const scrollRect = scroll.getBoundingClientRect();
		const overTime = event.clientX >= rulerRect.left && event.clientX < rulerRect.right
			&& event.clientY >= scrollRect.top && event.clientY < scrollRect.bottom;
		const timeIndicator = timeIndicatorRef.current;
		if (timeIndicator) {
			timeIndicator.hidden = !overTime;
			if (overTime) timeIndicator.style.transform = `translateX(${event.clientX - rulerRect.left}px)`;
		}
		const overTracks = event.clientX >= rulerRect.left && event.clientX < scrollRect.right
			&& event.clientY >= rulerRect.bottom && event.clientY < scrollRect.bottom;
		const verticalIndicator = verticalIndicatorRef.current;
		if (verticalIndicator) {
			verticalIndicator.hidden = !overTracks;
			if (overTracks) verticalIndicator.style.top = `${event.clientY - panel.getBoundingClientRect().top}px`;
		}
	}, [hidePointerPosition, panelRef, scrollRef]);
	return { timeIndicatorRef, verticalIndicatorRef, updatePointerPosition, hidePointerPosition };
}
