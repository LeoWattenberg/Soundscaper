/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { framescaperNativeDeliveryCopy } from '../../i18n/framescaper-native-delivery-copy.ts';
import { framescaperSuccessorNativeDelivery } from '../../../framescaper/editor-successor-native-delivery-adapter.ts';
import { createFramescaperNativeDeliverySession } from '../../../framescaper/editor-successor-native-delivery-session.ts';
import { exportFramescaperSuccessorNative } from '../../../framescaper/editor-successor-native-export.ts';
import type { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../../../framescaper/editor-successor-controller.ts';
type Controller = ReturnType<typeof createFramescaperSuccessorController>;
type Context = ReturnType<typeof framescaperSuccessorControllerContext>;
interface Session { owner: Controller; operation: ReturnType<typeof createFramescaperNativeDeliverySession>; close(): void }
let active: Session | null = null;
export async function disposeFramescaperNativeDelivery(controller: Controller): Promise<void> {
	const session = active; if (session?.owner !== controller) return;
	// Disposal may not erase a failed native capability. The same dialog remains available to retry cleanup.
	await session.operation.dispose(); session.close();
}
export function openFramescaperNativeDelivery(controller: Controller, context: Context): void {
	if (active && !active.operation.canClose()) return; active?.close();
	const focus = document.activeElement, host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
	const operation = createFramescaperNativeDeliverySession();
	const session: Session = { owner: controller, operation, close() {
		if (!operation.canClose()) return;
		root.unmount(); host.remove(); if (active === session) active = null; if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
	} };
	active = session; root.render(<NativeDialog context={context} session={session} />);
}
function NativeDialog({ context, session }: { context: Context; session: Session }) {
	const copy = framescaperNativeDeliveryCopy(document.documentElement.lang), dialog = useRef<HTMLDialogElement>(null);
	const source = session.owner.project?.sources.find(source => source.kind === 'video' || source.kind === 'image');
	const [width, setWidth] = useState(String(source?.width ?? 1920)), [height, setHeight] = useState(String(source?.height ?? 1080));
	const [transparent, setTransparent] = useState(true), [ready, setReady] = useState(false);
	const [preparationError, setPreparationError] = useState<string | null>(null), [progress, setProgress] = useState('');
	const state = useSyncExternalStore(session.operation.subscribe, session.operation.snapshot, session.operation.snapshot);
	const blocked = state.working || state.cleanupRequired;
	const error = state.failure ? message(state.failure) : preparationError;
	const status = state.receipt ? copy.saved.replace('{name}', state.receipt.name) : state.cancelled ? copy.cancelled : state.working && !state.cleanupRequired ? progress : '';
	const delivery = framescaperSuccessorNativeDelivery();
	useEffect(() => { dialog.current?.showModal(); let cancelled = false;
		void delivery?.getProfile().then(profile => { if (!cancelled) setReady(profile !== null); }).catch((failure: unknown) => { if (!cancelled) setPreparationError(message(failure)); });
		return () => { cancelled = true; };
	}, [delivery]);
	function start() {
		if (!delivery || !session.operation.canClose() || session.owner.getSnapshot().readOnly) return;
		setPreparationError(null); setProgress(copy.preparing);
		const sequence = session.owner.project?.sequences?.find(value => value.id === session.owner.project?.primarySequenceId);
		void session.operation.run(signal => exportFramescaperSuccessorNative(context, { delivery, signal,
			canvas: { width: Number(width), height: Number(height), frameRate: sequence?.rate, fit: 'contain', backgroundColor: transparent ? '#00000000' : '#000000' },
			onProgress(completed, total) { setProgress(copy.progress.replace('{completed}', String(completed)).replace('{total}', String(total))); },
		})).catch((failure: unknown) => { setPreparationError(message(failure)); });
	}
	return <dialog ref={dialog} data-frame-native-delivery="true" aria-labelledby="frame-native-title" style={{ maxWidth: 'min(46rem,90vw)', padding: '1.5rem' }} onCancel={event => { if (!session.operation.canClose()) event.preventDefault(); }} onClose={() => { if (session.operation.canClose()) session.close(); else dialog.current?.showModal(); }}>
		<h2 id="frame-native-title">{copy.title}</h2><p>{copy.description}</p><p>{copy.precision}</p>
		{!ready && <p role="status">{copy.unavailable}</p>}
		<fieldset disabled={blocked}><label>{copy.width}<input type="number" min="1" max="8192" value={width} onChange={event => setWidth(event.currentTarget.value)} /></label>{' '}
			<label>{copy.height}<input type="number" min="1" max="8192" value={height} onChange={event => setHeight(event.currentTarget.value)} /></label>{' '}
			<label><input type="checkbox" checked={transparent} onChange={event => setTransparent(event.currentTarget.checked)} />{copy.transparent}</label>
		</fieldset>
		{status && <p role="status">{status}</p>}{error && <p role="alert">{copy.failed} {error}</p>}
		{state.receipt && <p>{copy.identity}: <code data-frame-native-digest>{state.receipt.identity.revisionDigest}</code></p>}
		{state.cleanupRequired && <><p>{copy.cleanupRequired}</p><button type="button" disabled={state.working} onClick={() => { void session.operation.retryCleanup().catch((failure: unknown) => { setPreparationError(message(failure)); }); }}>{copy.retryCleanup}</button>{' '}</>}
		<button type="button" disabled={!ready || blocked || session.owner.getSnapshot().readOnly} onClick={start}>{copy.export}</button>{' '}
		{state.working && !state.cleanupRequired && <button type="button" onClick={session.operation.cancel}>{copy.cancel}</button>}{' '}
		<button type="button" disabled={blocked} onClick={() => session.close()}>{copy.close}</button>
	</dialog>;
}
function message(value: unknown): string {
	if (value instanceof AggregateError) return `${value.message} ${(value.errors as unknown[]).map(message).join(' ')}`;
	return value instanceof Error ? value.message : String(value);
}
