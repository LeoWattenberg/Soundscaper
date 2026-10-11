/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { framescaperNativeDeliveryCopy } from '../../i18n/framescaper-native-delivery-copy.ts';
import { framescaperSuccessorNativeDelivery } from '../../../framescaper/editor-successor-native-delivery-adapter.ts';
import { exportFramescaperSuccessorNative } from '../../../framescaper/editor-successor-native-export.ts';
import type { FramescaperSuccessorNativeReceipt } from '../../../framescaper/editor-successor-native-delivery-contract.ts';
import type { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../../../framescaper/editor-successor-controller.ts';
type Controller = ReturnType<typeof createFramescaperSuccessorController>;
type Context = ReturnType<typeof framescaperSuccessorControllerContext>;
interface Session { owner: Controller; abort: AbortController | null; pending: Promise<void> | null; close(): void }
let active: Session | null = null;
export async function disposeFramescaperNativeDelivery(controller: Controller): Promise<void> {
	const session = active; if (session?.owner !== controller) return;
	session.abort?.abort(new DOMException('Frame native delivery closed.', 'AbortError')); await session.pending; session.close();
}
export function openFramescaperNativeDelivery(controller: Controller, context: Context): void {
	if (active?.pending) return; active?.close();
	const focus = document.activeElement, host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
	const session: Session = { owner: controller, abort: null, pending: null, close() { root.unmount(); host.remove(); if (active === session) active = null; if (focus instanceof HTMLElement && focus.isConnected) focus.focus(); } };
	active = session; root.render(<NativeDialog context={context} session={session} />);
}
function NativeDialog({ context, session }: { context: Context; session: Session }) {
	const copy = framescaperNativeDeliveryCopy(document.documentElement.lang), dialog = useRef<HTMLDialogElement>(null);
	const source = session.owner.project?.sources.find(source => source.kind === 'video' || source.kind === 'image');
	const [width, setWidth] = useState(String(source?.width ?? 1920)), [height, setHeight] = useState(String(source?.height ?? 1080));
	const [transparent, setTransparent] = useState(true), [ready, setReady] = useState(false), [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null), [status, setStatus] = useState(''), [receipt, setReceipt] = useState<FramescaperSuccessorNativeReceipt | null>(null);
	const delivery = framescaperSuccessorNativeDelivery();
	useEffect(() => { dialog.current?.showModal(); let cancelled = false;
		void delivery?.getProfile().then(profile => { if (!cancelled) setReady(profile !== null); }).catch((failure: unknown) => { if (!cancelled) setError(message(failure)); });
		return () => { cancelled = true; };
	}, [delivery]);
	function start() {
		if (!delivery || session.pending || session.owner.getSnapshot().readOnly) return;
		const abort = new AbortController(); session.abort = abort; setWorking(true); setError(null); setReceipt(null); setStatus(copy.preparing);
		const sequence = session.owner.project?.sequences?.find(value => value.id === session.owner.project?.primarySequenceId);
		session.pending = exportFramescaperSuccessorNative(context, { delivery, signal: abort.signal,
			canvas: { width: Number(width), height: Number(height), frameRate: sequence?.rate, fit: 'contain', backgroundColor: transparent ? '#00000000' : '#000000' },
			onProgress(completed, total) { setStatus(copy.progress.replace('{completed}', String(completed)).replace('{total}', String(total))); },
		}).then(value => { setReceipt(value); setStatus(value ? copy.saved.replace('{name}', value.name) : copy.cancelled); }).catch((failure: unknown) => {
			if (failure instanceof DOMException && failure.name === 'AbortError') setStatus(copy.cancelled); else { setError(message(failure)); setStatus(''); }
		}).finally(() => { session.pending = null; session.abort = null; setWorking(false); });
	}
	return <dialog ref={dialog} data-frame-native-delivery="true" aria-labelledby="frame-native-title" style={{ maxWidth: 'min(46rem,90vw)', padding: '1.5rem' }} onCancel={event => { if (working) event.preventDefault(); }} onClose={() => session.close()}>
		<h2 id="frame-native-title">{copy.title}</h2><p>{copy.description}</p><p>{copy.precision}</p>
		{!ready && <p role="status">{copy.unavailable}</p>}
		<fieldset disabled={working}><label>{copy.width}<input type="number" min="1" max="8192" value={width} onChange={event => setWidth(event.currentTarget.value)} /></label>{' '}
			<label>{copy.height}<input type="number" min="1" max="8192" value={height} onChange={event => setHeight(event.currentTarget.value)} /></label>{' '}
			<label><input type="checkbox" checked={transparent} onChange={event => setTransparent(event.currentTarget.checked)} />{copy.transparent}</label>
		</fieldset>
		{status && <p role="status">{status}</p>}{error && <p role="alert">{copy.failed} {error}</p>}
		{receipt && <p>{copy.identity}: <code data-frame-native-digest>{receipt.identity.revisionDigest}</code></p>}
		<button type="button" disabled={!ready || working || session.owner.getSnapshot().readOnly} onClick={start}>{copy.export}</button>{' '}
		{working && <button type="button" onClick={() => session.abort?.abort(new DOMException(copy.cancelled, 'AbortError'))}>{copy.cancel}</button>}{' '}
		<button type="button" disabled={working} onClick={() => session.close()}>{copy.close}</button>
	</dialog>;
}
function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
