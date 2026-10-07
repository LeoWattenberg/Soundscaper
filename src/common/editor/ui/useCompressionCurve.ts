/* SPDX-License-Identifier: GPL-3.0-only */
import { useMemo } from 'react';
import { audacityCompressionCurve } from './audacity-compression-curve.ts';

export function useCompressionCurve(parameters: Readonly<Record<string, unknown>>) {
	return useMemo(() => audacityCompressionCurve(parameters), [parameters]);
}

