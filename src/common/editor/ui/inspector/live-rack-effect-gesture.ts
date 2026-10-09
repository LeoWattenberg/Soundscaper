/* SPDX-License-Identifier: AGPL-3.0-only */

import { isStandardEffect } from '../../first-party-effects/standard/definition.ts';

interface RackGestureEffect {
	readonly type: string;
	readonly enabled?: boolean;
	readonly bypassed?: boolean;
	readonly params?: Readonly<Record<string, unknown>>;
}

type RackParams = Readonly<Record<string, unknown>>;
type GestureBegin = () => unknown;
type GestureCommit = (params: RackParams) => unknown;

function supportsNativeCommit(type: string): boolean {
	return isStandardEffect(type) || ['audacity-echo', 'audacity-graphic-eq', 'audacity-filter-curve-eq'].includes(type);
}

export function nativeRackEffectCommit(
	effect: RackGestureEffect | null | undefined,
	params: RackParams,
	onBegin: GestureBegin | null | undefined,
	onCommit: GestureCommit | null | undefined,
	onCancel?: GestureBegin | null,
): (() => Promise<void>) | null {
	if (!effect || !supportsNativeCommit(effect.type) || !onBegin || !onCommit) return null;
	return async () => {
		try {
			await onBegin();
			await onCommit({ ...effect.params, ...params });
		} catch (cause) {
			try { await onCancel?.(); } catch { /* Preserve the original operation error. */ }
			throw cause;
		}
	};
}

export function supportsLiveRackEffectGesture(
	effect: RackGestureEffect | null | undefined,
	effectOwner: Readonly<{ effectsActive?: boolean }> | null | undefined,
): boolean {
	if (!effect || effect.enabled === false || effectOwner?.effectsActive === false) return false;
	if (supportsNativeCommit(effect.type)) return effect.bypassed !== true;
	return effect.type === 'delay' && Number(effect.params?.mix) > 0;
}
