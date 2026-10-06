/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { acquireTimelineLaneGeometry, type TimelineLaneGeometryOwner } from './timeline-lane-geometry.ts';

export function useTimelineLaneGeometry(rootRef: RefObject<HTMLElement | null>) {
	const ownerRef = useRef<{ root: HTMLElement; value: TimelineLaneGeometryOwner } | null>(null);
	const current = useCallback(() => {
		const root = rootRef.current;
		if (ownerRef.current?.root !== root) {
			ownerRef.current?.value.dispose();
			ownerRef.current = root ? { root, value: acquireTimelineLaneGeometry(root) } : null;
		}
		return ownerRef.current?.value ?? null;
	}, [rootRef]);
	useEffect(() => {
		current()?.prepare();
		return () => { ownerRef.current?.value.dispose(); ownerRef.current = null; };
	}, [current]);
	return current;
}
