/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { framescaperSuccessorCopy } from '../../i18n/framescaper-successor-copy.ts';
import { createFramescaperCompositionConnection, type SuccessorController, type SuccessorContext } from './framescaper-composition-link-connection.ts';
import type { FramescaperCompositionLinkOwnerReceipt } from '../../../framescaper/editor-composition-link-owner-repository.ts';
type Connection = ReturnType<typeof createFramescaperCompositionConnection>;
const connections = new WeakMap<object, Connection>();
let active: Readonly<{ owner: object; close(): void }> | null = null;
export function disposeFramescaperCompositionLinks(controller: SuccessorController): void { if (active?.owner === controller) active.close(); connections.get(controller)?.dispose(); connections.delete(controller); }
export function openFramescaperCompositionLinksDialog(controller: SuccessorController, context: SuccessorContext): void {
	active?.close(); let connection = connections.get(controller); if (!connection) { connection = createFramescaperCompositionConnection(controller, context); connections.set(controller, connection); }
	const focus = document.activeElement; const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
	const close = () => { root.unmount(); host.remove(); active = null; if (focus instanceof HTMLElement && focus.isConnected) focus.focus(); };
	active = { owner: controller, close }; root.render(<LinksDialog controller={controller} context={context} connection={connection} close={close} />);
}
function LinksDialog({ controller, context, connection, close }: { controller: SuccessorController; context: SuccessorContext; connection: Connection; close(): void }) {
	const copy = framescaperSuccessorCopy(document.documentElement.lang); const dialog = useRef<HTMLDialogElement>(null);
	const state = useSyncExternalStore(connection.subscribe, connection.snapshot); const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
	const [receipt, setReceipt] = useState<FramescaperCompositionLinkOwnerReceipt | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
	const projectId = snapshot.project?.id;
	useEffect(() => { dialog.current?.showModal(); }, []);
	useEffect(() => { let cancelled = false; if (projectId) void context.environment.owners.loadOwner(projectId).then(value => { if (!cancelled) setReceipt(value); }).catch((failure: unknown) => { if (!cancelled) setError(message(failure)); }); return () => { cancelled = true; }; }, [context, projectId, snapshot.project, state]);
	function run(action: () => Promise<unknown> | void) { setBusy(true); setError(null); void Promise.resolve().then(action).catch((failure: unknown) => setError(message(failure))).finally(() => setBusy(false)); }
	const status = { idle: copy.connectionIdle, pending: copy.connectionPending, ready: copy.connectionReady, received: copy.connectionReceived }[state.status];
	return <dialog ref={dialog} data-framescaper-composition-links="true" aria-labelledby="frame-links-title" style={{ maxWidth: 'min(54rem,90vw)', maxHeight: '80vh', overflow: 'auto', padding: '1.5rem' }} onClose={close}>
		<h2 id="frame-links-title">{copy.linksTitle}</h2><p>{copy.linksDescription}</p>
		<p role="status">{status}</p>{(error ?? state.error) && <p role="alert">{error ?? state.error}</p>}
		<button type="button" disabled={busy || snapshot.readOnly || !projectId || state.url !== null} onClick={() => run(() => connection.connect())}>{copy.connect}</button>{' '}
		<button type="button" disabled={state.url === null} onClick={() => connection.disconnect()}>{copy.disconnect}</button>
		{state.url && <><label>{copy.pairingUrl}<input aria-label={copy.pairingUrl} readOnly value={state.url} onFocus={event => event.currentTarget.select()} style={{ width: '100%' }} /></label><p>{copy.pairingHelp}</p></>}
		{receipt?.project.compositionLinks.length ? <ul>{receipt.project.compositionLinks.map(link => {
			const receiver = receipt.linkStates.find(entry => entry.sourceId === link.sourceId)?.state;
			return <li key={link.sourceId}><strong>{link.snapshot.project.title}</strong><p>{copy.accepted}: <code>{link.acceptedDigest}</code></p>
				{receiver?.pending && <p>{copy.pending}</p>}{receiver?.paused && <p>{copy.paused}</p>}
				<button type="button" disabled={busy || !receiver?.pending || snapshot.readOnly} onClick={() => run(async () => { setReceipt(await context.links.transition(link.sourceId, 'conform')); })}>{copy.conform}</button>{' '}
				<button type="button" disabled={busy || !receiver?.paused || snapshot.readOnly} onClick={() => run(async () => { setReceipt(await context.links.transition(link.sourceId, 'resume')); })}>{copy.resume}</button>
			</li>;
		})}</ul> : <p>{copy.emptyLinks}</p>}
		<button type="button" onClick={close}>{copy.close}</button>
	</dialog>;
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
