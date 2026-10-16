/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type RefObject } from 'react';
import { retainNativeRangeTouchOwner } from '../../../../vendor/audacity-design-system/components/src/Slider/native-range-touch-owner.ts';
export { retainNativeRangeTouchOwner };

/** Retain the browser's native range gesture when another finger taps it. */
export function useNativeRangeTouchOwner(): RefObject<HTMLInputElement | null> {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (input.current) return retainNativeRangeTouchOwner(input.current);
	}, []);
	return input;
}
