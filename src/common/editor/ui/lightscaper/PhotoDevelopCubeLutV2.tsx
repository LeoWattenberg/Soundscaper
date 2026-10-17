/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VideoEffectLeafV2 } from '../../video-effect-leaf-v2.ts';
import type { PhotoLibraryCubeLutPortV1 } from '../../photo-library-cube-lut-port-v1.ts';
import type { PhotoDevelopEffectsAuthoringPortV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
import { normalizeCubeLutProfileEffectV1 } from '../../video-cube-lut-profile-v1.ts';
import VideoCubeLutControl from '../inspector/VideoCubeLutControl.tsx';

export interface PhotoDevelopCubeLutPropsV2 {
	readonly effect: VideoEffectLeafV2; readonly effects: readonly VideoEffectLeafV2[]; readonly owner: PhotoDevelopEffectsAuthoringPortV1;
	readonly copy: Readonly<Record<string, string>>; readonly disabled: boolean; readonly isCurrent: () => boolean;
	readonly importCubeLut?: PhotoLibraryCubeLutPortV1['importFile']; readonly onPending: (pending: boolean) => void;
	readonly registerRetirement: (retire: () => Promise<void>) => () => void;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;

/** The selected Session authenticates/publishes the immutable resource. Only its
 * closed reference enters the draft; retirement joins the entire import. */
export default function PhotoDevelopCubeLutV2(props: PhotoDevelopCubeLutPropsV2) {
	const profile = normalizeCubeLutProfileEffectV1(props.effect), { owner, effect, effects } = props;
	const { importCubeLut, onPending, registerRetirement } = props;
	const capabilityRef = useRef({ owner, method: importCubeLut, onPending, registerRetirement, receiver: props });
	const previous = capabilityRef.current;
	if (previous.owner !== owner || previous.method !== importCubeLut || previous.onPending !== onPending || previous.registerRetirement !== registerRetirement) {
		capabilityRef.current = { owner, method: importCubeLut, onPending, registerRetirement, receiver: props };
	}
	const capability = capabilityRef.current;
	const scope = useMemo(() => ({ capability, live: true, pending: null as Promise<void> | null, failed: null as Promise<void> | null, stop: null as AbortController | null }), [capability]);
	const [error, setError] = useState(false);
	useLayoutEffect(() => { setError(false); }, [scope, effects]);
	const latest = useRef({ scope, effects }); latest.current = { scope, effects };
	const cancel = useCallback(() => { const pending = scope.pending ?? scope.failed; scope.stop?.abort(); return pending ?? Promise.resolve(); }, [scope]);
	useLayoutEffect(() => {
		scope.live = true; const unregister = Reflect.apply(capability.registerRetirement, capability.receiver, [cancel]) as () => void;
		return () => { scope.live = false; void cancel().catch(() => undefined); unregister(); };
	}, [scope, effects, capability, cancel]);
	const owns = () => scope.live && latest.current.scope === scope && latest.current.effects === effects && owner.snapshot().draft?.effects === effects;
	const current = () => owns() && Reflect.apply(props.isCurrent, props, []) === true && owns();
	const setReference = (lut: typeof profile.params.lut) => {
		if (current()) owner.setEffects(effects.map(value => value === effect ? { ...effect, params: { lut } } : value));
	};
	function choose(file: File): Promise<void> {
		if (scope.pending || scope.failed || props.disabled || !capability.method) return Promise.resolve();
		const stop = new AbortController(); let resolve!: () => void, reject!: (error: unknown) => void;
		const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		scope.pending = pending; scope.stop = stop; void pending.catch(() => undefined);
		const check = () => { Reflect.apply(CHECK, stop.signal, []); };
		const clear = () => { if (scope.pending === pending) { scope.pending = null; scope.stop = null; } };
		let notified = false;
		let primary: Readonly<{ error: unknown }> | null = null;
		void (async () => {
			try {
				await (async () => {
					check(); if (!current()) return; check();
					setError(false); notified = true; Reflect.apply(capability.onPending, capability.receiver, [true]); check(); if (!current()) return; check();
					const receipt = await Reflect.apply(capability.method!, capability.receiver, [file, { signal: stop.signal }]) as Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>;
					check(); if (!current()) return; check();
					const normalized = normalizeCubeLutProfileEffectV1({ ...effect, params: { lut: receipt.reference } });
					check(); setReference(normalized.params.lut);
				})();
			} catch (error) {
				if (!Reflect.apply(ABORTED, stop.signal, []) || !Object.is(error, Reflect.apply(REASON, stop.signal, []))) {
					primary = { error }; if (owns()) setError(true);
				}
			}
			try { if (scope.pending === pending && notified) Reflect.apply(capability.onPending, capability.receiver, [false]); }
			catch (error) {
				if (!Reflect.apply(ABORTED, stop.signal, []) || !Object.is(error, Reflect.apply(REASON, stop.signal, []))) {
					scope.failed = pending;
					primary = { error: primary && !Object.is(primary.error, error)
						? new AggregateError([primary.error, error], 'Photo cube import cleanup failed.', { cause: error }) : error };
				}
			}
			if (primary) throw primary.error;
		})().then(() => { clear(); resolve(); }, (error: unknown) => {
			const aborted = Reflect.apply(ABORTED, stop.signal, []) as boolean;
			if (aborted && Object.is(error, Reflect.apply(REASON, stop.signal, []))) { clear(); resolve(); return; }
			if (aborted) scope.failed = pending; clear(); reject(error);
		});
		// The local view owns generic failure copy; the original promise remains
		// registered so retirement retains the exact failure and joins cleanup.
		return pending.catch(() => undefined);
	}
	return <><VideoCubeLutControl reference={profile.params.lut} copy={props.copy} disabled={props.disabled || !props.importCubeLut}
		isCurrent={current} onImport={choose} onClear={() => { if (!scope.pending && !props.disabled) setReference(null); }} />
		{error && <p role="alert">{props.copy.videoEffectCubeLutFailed}</p>}</>;
}
