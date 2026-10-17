/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GraphicWatermarkFields, { useGraphicWatermarkSelection } from '../GraphicWatermarkFields.tsx';
import { captureImageExportGraphicRequest } from '../../image-export-graphic-request.ts';
import { preparePhotoRasterBatchGraphicV1, reselectPhotoRasterBatchGraphicV1,
	type PhotoRasterBatchGraphicIntentV1, type PreparedPhotoRasterBatchGraphicV1 } from '../../../../lightscaper/controller/photo-raster-export-batch-graphic-v1.ts';

type Selection = Parameters<typeof GraphicWatermarkFields>[0]['value'];
interface Ports { readonly prepare: typeof preparePhotoRasterBatchGraphicV1; readonly reselect: typeof reselectPhotoRasterBatchGraphicV1; }
interface Work { readonly stop: AbortController; readonly promise: Promise<void>; }
interface Scope { live: boolean; readonly stop: AbortController; token: object; work: Work | null; retirement: Promise<void> | null; }
const DEFAULT_PORTS: Ports = Object.freeze({ prepare: preparePhotoRasterBatchGraphicV1, reselect: reselectPhotoRasterBatchGraphicV1 });
const CHECK = AbortSignal.prototype.throwIfAborted, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function joinCancelledWork(work: Work | null): Promise<void> {
	return work ? work.promise.catch((cause: unknown) => {
		if (!Object.is(cause, Reflect.apply(REASON, work.stop.signal, []))) throw cause;
	}) : Promise.resolve();
}

/** Ephemeral dialog preparation. One native read joins before retirement;
 * only the owning domain's prepared proof can enter the export gesture. */
export function usePhotoRasterBatchGraphic(owner: unknown, register: (join: () => Promise<void>) => () => void,
	retained?: Readonly<PhotoRasterBatchGraphicIntentV1>, ports: Ports = DEFAULT_PORTS) {
	const retainedKey = JSON.stringify(retained), identity = useMemo(() => ({ owner, retainedKey }), [owner, retainedKey]);
	const graphic = useGraphicWatermarkSelection(identity);
	const scope = useMemo(() => ({ current: null as Scope | null }), [owner]);
	const retiring = useRef<Promise<void> | null>(null);
	const [snapshot, setSnapshot] = useState<{ identity: unknown; prepared: Readonly<PreparedPhotoRasterBatchGraphicV1> | null; selection: Selection | null; pending: boolean; failed: boolean }>({ identity, prepared: null, selection: null, pending: false, failed: false });
	const retire = useCallback((current: Scope): Promise<void> => {
		if (current.retirement) return current.retirement;
		current.live = false; current.stop.abort(); current.work?.stop.abort();
		const work = current.work;
		current.retirement = joinCancelledWork(work);
		retiring.current = current.retirement; return current.retirement;
	}, []);
	useLayoutEffect(() => {
		const current: Scope = { live: true, stop: new AbortController(), token: {}, work: null, retirement: null };
		scope.current = current;
		const unregister = register(() => retire(current));
		return () => { current.live = false; unregister(); };
	}, [scope, register, retire]);
	useLayoutEffect(() => { setSnapshot({ identity, prepared: null, selection: null, pending: false, failed: false }); }, [identity]);
	const begin = (selection: Selection | null, run: (signal: AbortSignal) => Promise<Readonly<PreparedPhotoRasterBatchGraphicV1>>) => {
		const current = scope.current;
		if (!current?.live || current.work) return;
		const token = {}; current.token = token;
		const stop = new AbortController();
		const previous = retiring.current;
		setSnapshot({ identity, prepared: null, selection, pending: true, failed: false });
		const promise = Promise.resolve().then(async () => {
			await previous;
			Reflect.apply(CHECK, stop.signal, []);
			const prepared = await run(stop.signal); Reflect.apply(CHECK, stop.signal, []);
			if (current.live && scope.current === current && current.token === token) setSnapshot({ identity, prepared, selection, pending: false, failed: false });
		}).finally(() => { if (current.work?.promise === promise) current.work = null; });
		current.work = { stop, promise };
		void promise.catch(() => { if (current.live && scope.current === current && current.token === token) setSnapshot({ identity, prepared: null, selection, pending: false, failed: true }); });
	};
	const onChange = (value: Selection) => {
		if (!scope.current?.live || scope.current.work || retained) return;
		graphic.onChange(value); setSnapshot({ identity, prepared: null, selection: value, pending: false, failed: false });
		if (!value.enabled || !value.body) return;
		try {
			const request = captureImageExportGraphicRequest({ body: value.body, anchor: value.anchor, widthFraction: Number(value.width) / 100,
				marginFraction: Number(value.margin) / 100, opacity: Number(value.opacity) / 100 });
			const prepare = ports.prepare; begin(value, signal => Reflect.apply(prepare, ports, [request, { signal }]) as ReturnType<typeof prepare>);
		} catch { setSnapshot({ identity, prepared: null, selection: value, pending: false, failed: true }); }
	};
	const reselect = (body: File | null) => {
		if (!retained || !body) return;
		const reselect = ports.reselect; begin(null, signal => Reflect.apply(reselect, ports, [retained, body, { signal }]) as ReturnType<typeof reselect>);
	};
	const reset = (): Promise<void> => {
		const current = scope.current;
		if (!current?.live || retained) return Promise.resolve();
		const selection = { ...graphic.value, enabled: false, body: null }, token = {}; current.token = token;
		graphic.onChange(selection);
		const work = current.work; work?.stop.abort();
		setSnapshot({ identity, prepared: null, selection, pending: work !== null, failed: false });
		return joinCancelledWork(work).then(() => {
			if (current.live && scope.current === current && current.token === token) setSnapshot({ identity, prepared: null, selection, pending: false, failed: false });
		}, (cause: unknown) => {
			if (current.live && scope.current === current && current.token === token) setSnapshot({ identity, prepared: null, selection, pending: false, failed: true });
			throw cause;
		});
	};
	const state = snapshot.identity === identity ? snapshot : null;
	return { value: graphic.value, onChange, reselect,
		prepared: state && (retained || state.selection === graphic.value) ? state.prepared : null,
		pending: state?.pending ?? false, failed: state?.failed ?? false,
		reset,
		captureRetirement: useCallback(() => { const current = scope.current; return () => current ? retire(current) : Promise.resolve(); }, [scope, retire]) };
}
