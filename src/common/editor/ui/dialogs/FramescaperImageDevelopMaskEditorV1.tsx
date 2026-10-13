/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ImageDevelopDraftPresentationV1, type ImageDevelopDraftPresentationSnapshotV1,
	type ImageDevelopDraftFrameRequestV1, type WithImageDevelopDraftFrameV1 } from '../../controller/shared/image-develop-draft-presentation-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../../imaging/image-develop-frame-core.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { PhotoDevelopMaskDisplaySelectionV1 } from '../../photo-develop-mask-display-v1.ts';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../../i18n/lightscaper-develop-repair-spots-copy.ts';
import PhotoDevelopMaskManagerV1 from '../lightscaper/PhotoDevelopMaskManagerV1.tsx';
import PhotoDevelopMaskOverlayV1 from '../lightscaper/PhotoDevelopMaskOverlayV1.tsx';

export interface FramescaperImageDevelopMaskEditorPropsV1 {
	readonly develop: Readonly<ImageDevelopStateCurrentV1>;
	readonly withDraftFrame?: WithImageDevelopDraftFrameV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (develop: Readonly<ImageDevelopStateCurrentV1>) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
interface Scope {
	readonly owner: ImageDevelopDraftPresentationV1;
	readonly source: Readonly<ImageDevelopStateCurrentV1>;
	readonly renderer: WithImageDevelopDraftFrameV1;
	sealed: boolean;
	intent: 'apply' | 'close' | null;
	closing: Promise<void> | null;
}
interface Selection { readonly source: Readonly<ImageDevelopStateCurrentV1>; readonly draft: Readonly<ImageDevelopStateCurrentV1>; readonly overlay: Readonly<PhotoDevelopMaskDisplaySelectionV1> | null }
const idle = (): ImageDevelopDraftPresentationSnapshotV1 => ({ status: 'idle', extent: null, error: null });

/** The optional native renderer owns all frame/resource authority. This adapter
 * observes local scalar drafts and joins its neutral presenter before forwarding
 * the caller's existing Apply or Close; the selected owner still publishes. */
export default function FramescaperImageDevelopMaskEditorV1(props: FramescaperImageDevelopMaskEditorPropsV1) {
	const latest = useRef(props); latest.current = props;
	const active = useRef<Scope | null>(null), predecessor = useRef<Promise<void>>(Promise.resolve());
	const after = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
	const selected = useRef<Selection>({ source: props.develop, draft: props.develop, overlay: null });
	if (selected.current.source !== props.develop) selected.current = { source: props.develop, draft: props.develop, overlay: null };
	const [state, setState] = useState<{ scope: Scope | null; snapshot: ImageDevelopDraftPresentationSnapshotV1; finishing: boolean }>({ scope: null, snapshot: idle(), finishing: false });
	const presented = useCallback((scope: Scope) => active.current === scope && latest.current.develop === scope.source && latest.current.withDraftFrame === scope.renderer, []);
	const nativeCurrent = useCallback(() => { const value = latest.current; return !value.disabled && Reflect.apply(value.isCurrent, value, []) === true; }, []);
	const draw = useCallback((scope: Scope) => {
		if (!presented(scope) || scope.sealed || !nativeCurrent() || !after.current) return;
		const value = selected.current, choice = value.overlay;
		scope.owner.setView({ develop: value.draft, after: after.current,
			...(choice && overlay.current ? { overlay: overlay.current, maskOverlay: { maskId: choice.maskId, effectId: choice.effectId }, maskOverlayMode: choice.displayMode ?? 'color' } : {}) });
	}, [presented, nativeCurrent]);
	const retire = useCallback((scope: Scope) => { scope.sealed = true; scope.closing ??= scope.owner.close(); return scope.closing; }, []);
	useLayoutEffect(() => {
		const renderer = props.withDraftFrame; if (!renderer) return;
		const receiver = latest.current, source = props.develop;
		const owner: ImageDevelopDraftPresentationV1 = new ImageDevelopDraftPresentationV1({ beforePresent: predecessor.current,
			withDraftFrame<Result>(request: Readonly<ImageDevelopDraftFrameRequestV1>, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) {
				return Reflect.apply(renderer, receiver, [request, consume, options]) as Promise<Result>;
			},
			isCurrent: (): boolean => { const scope = active.current; return Boolean(scope && scope.owner === owner && !scope.sealed && nativeCurrent()); } });
		const scope: Scope = { owner, source, renderer, sealed: false, intent: null, closing: null }; active.current = scope;
		const unsubscribe = owner.subscribe(snapshot => { if (presented(scope)) setState({ scope, snapshot, finishing: scope.sealed }); });
		const unregister = latest.current.registerRetirement?.(() => retire(scope));
		try { draw(scope); } catch { setState({ scope, snapshot: { status: 'failed', extent: null, error: null }, finishing: false }); }
		return () => {
			unsubscribe(); if (active.current === scope) active.current = null;
			predecessor.current = retire(scope); void predecessor.current.catch(() => undefined); unregister?.();
		};
	}, [props.withDraftFrame, props.develop, draw, nativeCurrent, presented, retire]);
	useLayoutEffect(() => {
		const scope = active.current; if (!scope || !presented(scope) || scope.sealed) return;
		if (!nativeCurrent()) { if (scope.owner.snapshot().status !== 'idle') void scope.owner.pause().catch(() => undefined); return; }
		if (scope.owner.snapshot().status === 'idle') try { draw(scope); } catch { /* The owning presenter retains its exact failure. */ }
	});
	const observe = useCallback((draft: Readonly<ImageDevelopStateCurrentV1>, choice: Readonly<PhotoDevelopMaskDisplaySelectionV1> | null) => {
		const value = latest.current; selected.current = { source: value.develop, draft, overlay: choice };
		const scope = active.current; if (scope && presented(scope) && !scope.sealed) try { draw(scope); } catch { setState({ scope, snapshot: { status: 'failed', extent: null, error: null }, finishing: false }); }
	}, [draw, presented]);
	const finish = (develop: Readonly<ImageDevelopStateCurrentV1> | null) => {
		const scope = active.current; if (!scope || !presented(scope) || develop && (scope.sealed || !nativeCurrent()) || !develop && scope.intent === 'close') return;
		const receiver = latest.current, callback = develop ? receiver.onApply : receiver.onClose;
		const intent = develop ? 'apply' : 'close'; scope.intent = intent;
		scope.sealed = true; setState({ scope, snapshot: idle(), finishing: true });
		void retire(scope).then(() => {
			if (!presented(scope) || scope.intent !== intent || develop && !nativeCurrent()) return;
			Reflect.apply(callback, receiver, develop ? [develop] : []);
		}, () => {
			if (!presented(scope) || scope.intent !== intent) return;
			setState({ scope, snapshot: { status: 'failed', extent: null, error: scope.owner.snapshot().error }, finishing: true });
			// This rejection certifies settlement, not successful retirement. The
			// registered child keeps its exact rejected promise for the outer owner,
			// which must still join its native Session before reporting the failure.
			if (!develop) Reflect.apply(callback, receiver, []);
		});
	};
	if (!props.withDraftFrame) return <PhotoDevelopMaskManagerV1 develop={props.develop} locale={props.locale} disabled={props.disabled} overlayAvailable={false}
		isCurrent={props.isCurrent} onApply={value => { Reflect.apply(props.onApply, props, [value]); }} onClose={props.onClose} />;
	const scope = active.current, snapshot = state.scope === scope ? state.snapshot : idle();
	const messages = photoDevelopCopy(props.locale), choice = selected.current.overlay;
	const preview = <div data-frame-image-develop-preview data-state={snapshot.status} className="frame-image-develop-preview">
		<div className="frame-image-develop-plane" style={{ aspectRatio: snapshot.extent ? `${snapshot.extent.width} / ${snapshot.extent.height}` : undefined }}>
			<canvas ref={after} width={0} height={0} role="img" aria-label={messages.after} data-frame-image-develop-after data-state={snapshot.status} hidden={snapshot.status !== 'ready'} />
			<PhotoDevelopMaskOverlayV1 canvasRef={overlay} locale={props.locale} displayMode={choice?.displayMode} state={choice ? snapshot.status : 'idle'} />
		</div>
		{snapshot.status === 'pending' && <p role="status">{messages.working}</p>}
		{snapshot.status === 'failed' && <p role="alert">{snapshot.error ?? photoDevelopRepairSpotsCopy(props.locale).failed}</p>}
	</div>;
	return <PhotoDevelopMaskManagerV1 develop={props.develop} locale={props.locale} disabled={props.disabled || state.finishing || snapshot.status === 'failed' || !nativeCurrent()}
		overlayAvailable isCurrent={() => Boolean(scope && presented(scope))} onPresentationChange={observe} presentation={preview}
		onApply={value => { finish(value); }} onClose={() => { finish(null); }} />;
}
