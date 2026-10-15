/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionLinkNonce, normalizeMotionLinkPacket, motionLinkPacketTransfers } from '../../motion-link-wire.ts';
import { readMotionLinkConnectionUrl, motionLinkOrigin, type MotionLinkOrigins } from '../../motion-link-connection-urls.ts';
import { assertMotionLinkLocale } from '../../motion-link-locale.ts';
import { connectMotionLinkBroadcast } from './internal/motion-link-broadcast.ts';

export interface MotionLinkBridgeSession { readonly closed: Promise<void>; dispose(): void }
interface BridgeIntent { readonly cap: string; readonly session: string; readonly locale: string }
export interface MotionLinkSendBridgeIntent extends BridgeIntent { readonly receiver: URL }
export interface MotionLinkReceiveBridgeIntent extends BridgeIntent { readonly senderOrigin: string }
function params(hash: string, keys: readonly string[]): URLSearchParams {
	if (hash.length > 8192) throw new Error('Motion bridge intent exceeds its bound.');
	const value = new URLSearchParams(hash.slice(1)); const actual = [...value.keys()];
	if (actual.length !== keys.length || keys.some((key) => !value.has(key))) throw new Error('Motion bridge intent is malformed.'); return value;
}
function common(value: URLSearchParams): BridgeIntent {
	const locale = assertMotionLinkLocale(value.get('locale'));
	return { cap: motionLinkNonce(value.get('cap')), session: motionLinkNonce(value.get('session')), locale };
}
export function readMotionLinkSendBridgeIntent(hash: string, receiverOrigin: string): MotionLinkSendBridgeIntent {
	const value = params(hash, ['cap', 'session', 'receiver', 'locale']); return { ...common(value), receiver: readMotionLinkConnectionUrl(value.get('receiver'), receiverOrigin) };
}
export function readMotionLinkReceiveBridgeIntent(hash: string, senderOrigin: string): MotionLinkReceiveBridgeIntent {
	const value = params(hash, ['cap', 'session', 'sender', 'locale']);
	if (value.get('sender') !== motionLinkOrigin(senderOrigin)) throw new Error('Motion bridge sender differs from its configured origin.'); return { ...common(value), senderOrigin };
}
function handshake(event: MessageEvent<unknown>, type: 'ready' | 'connect', session: string): boolean {
	const value = event.data;
	return Boolean(value && typeof value === 'object' && Object.keys(value).length === 4 && 'protocol' in value && value.protocol === 'motion-link-window' && 'version' in value && value.version === 1 && 'type' in value && value.type === type && 'session' in value && value.session === session);
}
function waitWindow(scope: Window, peer: Window, origin: string, session: string, type: 'ready' | 'connect', signal: AbortSignal): Promise<MessageEvent<unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => fail(new Error('Motion bridge window handshake timeout.')), 30_000);
		function cleanup() { clearTimeout(timer); scope.removeEventListener('message', message); signal.removeEventListener('abort', abort); }
		function fail(error: unknown) { cleanup(); reject(error); }
		function abort() { fail(signal.reason as unknown); }
		function message(event: MessageEvent<unknown>) {
			if (event.origin !== origin || event.source !== peer) return;
			if (!handshake(event, type, session) || event.ports.length !== (type === 'connect' ? 1 : 0)) { event.ports.forEach((port) => port.close()); fail(new Error('Motion bridge window identity or protocol changed.')); return; }
			cleanup(); resolve(event);
		}
		scope.addEventListener('message', message); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
	});
}
function lifecycle(scope: Window, peer: Window, cancellation: AbortController): () => void {
	const close = () => cancellation.abort(new Error('Motion bridge window closed.'));
	const timer = setInterval(() => { if (peer.closed) close(); }, 500);
	scope.addEventListener('pagehide', close, { once: true });
	const dispose = () => { clearInterval(timer); scope.removeEventListener('pagehide', close); cancellation.signal.removeEventListener('abort', dispose); };
	cancellation.signal.addEventListener('abort', dispose, { once: true }); return dispose;
}
export async function openMotionLinkSendBridge(scope: Window, origins: MotionLinkOrigins, intent: MotionLinkSendBridgeIntent, signal?: AbortSignal): Promise<MotionLinkBridgeSession> {
	const cancellation = new AbortController(); const combined = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal;
	const receiver = new URL(intent.receiver); const cap = motionLinkNonce(new URLSearchParams(receiver.hash.slice(1)).get('cap'));
	receiver.hash = new URLSearchParams({ cap, session: intent.session, sender: origins.senderOrigin, locale: intent.locale }).toString();
	const peer = scope.open(receiver.href, '_blank', 'popup=1,width=680,height=460'); if (!peer) throw new Error('The browser blocked the receiving composition bridge.');
	const cleanup = lifecycle(scope, peer, cancellation);
	try {
		await waitWindow(scope, peer, origins.receiverOrigin, intent.session, 'ready', combined);
		const connection = await connectMotionLinkBroadcast({ cap: intent.cap, session: intent.session, peerOrigin: origins.receiverOrigin, signal: combined });
		peer.postMessage({ protocol: 'motion-link-window', version: 1, type: 'connect', session: intent.session }, origins.receiverOrigin, [connection.port]);
		const dispose = () => { cancellation.abort(); connection.dispose(); cleanup(); };
		void connection.closed.then(dispose); return { closed: connection.closed, dispose };
	} catch (error) { cancellation.abort(); cleanup(); throw error; }
}
export async function acceptMotionLinkReceiveBridge(scope: Window, origins: MotionLinkOrigins, intent: MotionLinkReceiveBridgeIntent, signal?: AbortSignal): Promise<MotionLinkBridgeSession> {
	const peer: Window | null = scope.opener as Window | null; if (!peer) throw new Error('Open this receiving bridge from the sending bridge.');
	const cancellation = new AbortController(); const combined = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal; const cleanup = lifecycle(scope, peer, cancellation);
	let connection: Awaited<ReturnType<typeof connectMotionLinkBroadcast>> | null = null;
	try {
		connection = await connectMotionLinkBroadcast({ cap: intent.cap, session: intent.session, peerOrigin: origins.senderOrigin, signal: combined });
		const waiting = waitWindow(scope, peer, origins.senderOrigin, intent.session, 'connect', combined);
		peer.postMessage({ protocol: 'motion-link-window', version: 1, type: 'ready', session: intent.session }, origins.senderOrigin);
		const event = await waiting; const remote = event.ports[0]; const local = connection.port; let disposed = false;
		const forward = (destination: MessagePort) => (message: MessageEvent<unknown>) => {
			try { const packet = normalizeMotionLinkPacket(message.data, intent.session); destination.postMessage(packet, motionLinkPacketTransfers(packet)); if (packet.type === 'close') dispose(); } catch { dispose(); }
		};
		const incoming = forward(local); const outgoing = forward(remote);
		function dispose() { if (disposed) return; disposed = true; cancellation.abort(); remote.removeEventListener('message', incoming); local.removeEventListener('message', outgoing); remote.close(); local.close(); connection?.dispose(); cleanup(); }
		remote.addEventListener('message', incoming); local.addEventListener('message', outgoing); remote.start(); local.start(); combined.addEventListener('abort', dispose, { once: true });
		void connection.closed.then(dispose); return { closed: connection.closed, dispose };
	} catch (error) { cancellation.abort(); connection?.dispose(); cleanup(); throw error; }
}
