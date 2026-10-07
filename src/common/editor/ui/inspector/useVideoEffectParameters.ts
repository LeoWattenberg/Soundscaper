/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';

/** Descriptor parameter order belongs to the immutable video-effect catalog. */
export function useVideoEffectParameters<Parameter>(parameters: Readonly<Record<string, Parameter>>) {
	return useMemo(() => Object.entries(parameters), [parameters]);
}
