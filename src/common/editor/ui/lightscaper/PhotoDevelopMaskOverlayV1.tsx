/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { withImageDevelopMaskOverlayV1 } from '../../imaging/image-develop-mask-overlay-v1.ts';
import { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, type PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import type { PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';
import { photoDevelopLocalAdjustmentsCopy } from '../../../i18n/lightscaper-develop-local-adjustments-copy.ts';

export interface PhotoDevelopMaskOverlayPropsV1 {
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly selection: Readonly<PhotoDevelopMaskOverlaySelectionV1>;
	readonly source: Readonly<{ width: number; height: number }>;
	readonly extent: Readonly<{ width: number; height: number }>;
	readonly resolution: PhotoDevelopResolutionV1;
	readonly locale: string;
	readonly isCurrent: () => boolean;
	readonly registerRetirement: (retire: () => Promise<void>) => () => void;
}
const PROXY = Object.freeze({ source: Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 }),
	render: Object.freeze({ maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 33_554_432 }) });
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Paint only the shared owner's borrowed, geometry-projected mask coverage. */
export default function PhotoDevelopMaskOverlayV1(props: PhotoDevelopMaskOverlayPropsV1) {
	const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props); latest.current = props;
	const text = photoDevelopLocalAdjustmentsCopy(props.locale);
	const { develop, selection, source, extent, resolution, registerRetirement } = props;
	const registration = useRef({ method: registerRetirement, receiver: props });
	if (registration.current.method !== registerRetirement) registration.current = { method: registerRetirement, receiver: props };
	const registered = registration.current;
	const request = useMemo(() => ({ develop, selection, source, extent, resolution, registered }), [develop, selection, source, extent, resolution, registered]);
	const active = useRef(request); active.current = request;
	const retirement = useRef<Promise<void>>(Promise.resolve());
	const [observed, setObserved] = useState<Readonly<{ request: typeof request; state: 'pending' | 'ready' | 'failed' }>>({ request, state: 'pending' });
	const state = observed.request === request ? observed.state : 'pending';
	useLayoutEffect(() => {
		const target = canvas.current;
		if (!target) return;
		const controller = new AbortController(), { signal } = controller;
		const profile = request.resolution === 'full' ? PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 : PROXY;
		let retired = false;
		const current = () => !retired && active.current === request && latest.current.isCurrent();
		const check = () => { if (!current()) controller.abort(); Reflect.apply(CHECK, signal, []); };
		const clear = () => { clearPixelFrameCanvasV1(target); };
		const predecessor = retirement.current;
		const retire = () => {
			retired = true; controller.abort();
			const cleanup: Promise<void>[] = [];
			try { clear(); } catch (error) { cleanup.push(Promise.reject(error)); }
			return joinPhotoLibraryRetirementV1([pending, ...cleanup]);
		};
		const pending = predecessor.then(async () => {
			check();
			await withImageDevelopMaskOverlayV1({ develop: request.develop, source: request.source,
				maskId: request.selection.maskId, effectId: request.selection.effectId, signal }, view => {
				check();
				if (view.width !== request.extent.width || view.height !== request.extent.height || view.coverage.length !== view.width * view.height) {
					throw new RangeError('Mask coverage does not match the ready After image.');
				}
				const pixels = new Uint8Array(view.coverage.length * 4);
				try {
					for (let index = 0; index < view.coverage.length; index++) {
						if (index % 16_384 === 0) check();
						pixels[index * 4] = 255; pixels[index * 4 + 1] = 48; pixels[index * 4 + 2] = 48; pixels[index * 4 + 3] = view.coverage[index]!;
					}
					check();
					paintPixelFrameCanvasV1(target, { descriptor: { schemaVersion: 1, width: view.width, height: view.height,
						sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, { limits: profile.render, signal });
					check();
				} finally { pixels.fill(0); }
			}, profile);
			if (current()) setObserved({ request, state: 'ready' });
		}).catch((error: unknown) => {
			let cleanup: Readonly<{ value: unknown }> | null = null;
			try { clear(); } catch (value) { cleanup = { value }; }
			if (cleanup) throw new AggregateError([error, cleanup.value], 'Mask overlay and backing cleanup failed.', { cause: error });
			if (Reflect.apply(ABORTED, signal, []) && error === Reflect.apply(REASON, signal, [])) return;
			if (current()) setObserved({ request, state: 'failed' }); throw error;
		});
		void pending.catch(() => undefined);
		const unregister = Reflect.apply(request.registered.method, request.registered.receiver, [retire]) as () => void;
		return () => { retirement.current = joinPhotoLibraryRetirementV1([retirement.current, retire()]);
			void retirement.current.catch(() => undefined); unregister(); };
	}, [request]);
	return <><canvas ref={canvas} width={0} height={0} role="img" aria-label={text.maskOverlay} data-photo-develop-mask-overlay data-state={state}
		className="lightscaper-develop-mask-overlay" hidden={state !== 'ready'} />{state === 'failed' && <span role="alert">{text.overlayFailed}</span>}</>;
}
