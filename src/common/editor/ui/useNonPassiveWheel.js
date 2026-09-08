import { useEffect, useRef } from 'react';

export function useNonPassiveWheel(targetRef, onWheel) {
	const callbackRef = useRef(onWheel);
	callbackRef.current = onWheel;
	useEffect(() => {
		const target = targetRef.current;
		if (!target) return undefined;
		const listener = (event) => callbackRef.current(event);
		target.addEventListener('wheel', listener, { passive: false });
		return () => target.removeEventListener('wheel', listener);
	}, [targetRef]);
}
