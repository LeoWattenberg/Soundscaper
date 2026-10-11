/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionLinkNonce } from '../../../motion-link-wire.ts';
import { motionLinkOrigin } from '../../../motion-link-connection-urls.ts';
import { relayMotionLinkBroadcast } from './motion-link-broadcast-relay.ts';

export interface MotionLinkBroadcastConnection { readonly session: string; readonly port: MessagePort; readonly closed: Promise<void>; dispose(): void }
interface Options { readonly cap: string; readonly peerOrigin: string; readonly session?: string; readonly signal?: AbortSignal; readonly timeoutMs?: number }
function rendezvous(options: Options, initiate: boolean) {
	const cap = motionLinkNonce(options.cap); const peerOrigin = motionLinkOrigin(options.peerOrigin);
	const session = options.session === undefined ? undefined : motionLinkNonce(options.session);
	if (initiate && !session) throw new Error('Motion bridge requires a session.');
	const timeout = options.timeoutMs ?? 60_000; if (!Number.isSafeInteger(timeout) || timeout < 10 || timeout > 120_000) throw new RangeError('Motion bridge timeout is outside its range.');
	const channel = new BroadcastChannel(`motionscaper-composition-link:${cap}`); let settled = false; let relay: (() => void) | null = null;
	let resolve!: (value: MotionLinkBroadcastConnection) => void; let reject!: (error: unknown) => void;
	const connection = new Promise<MotionLinkBroadcastConnection>((yes, no) => { resolve = yes; reject = no; });
	const timer = setTimeout(() => dispose(new Error('Motion bridge connection timeout.')), timeout);
	function detach() { clearTimeout(timer); channel.removeEventListener('message', message); channel.removeEventListener('messageerror', malformed); options.signal?.removeEventListener('abort', abort); }
	function dispose(reason: unknown = new DOMException('Motion bridge cancelled.', 'AbortError')) {
		if (relay) { relay(); relay = null; return; }
		if (settled) return; settled = true; detach();
		try { channel.postMessage({ kind: 'refused' }); } finally { channel.close(); reject(reason); }
	}
	function abort() { dispose(options.signal?.reason as unknown); }
	function malformed() { dispose(new Error('Motion bridge message cannot be decoded.')); }
	function message(event: MessageEvent<unknown>) {
		try {
			const value = event.data;
			if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed Motion bridge handshake.');
			if ('kind' in value && value.kind === 'refused') throw new Error('Motion bridge peer refused the connection.');
			if (Object.keys(value).length !== 4 || !('kind' in value) || value.kind !== (initiate ? 'connected' : 'connect') || !('version' in value) || value.version !== 1 || !('peerOrigin' in value) || value.peerOrigin !== peerOrigin || !('session' in value)) throw new Error('Motion bridge peer origin or handshake changed.');
			const receivedSession = motionLinkNonce(value.session); if (session && receivedSession !== session) throw new Error('Motion bridge session changed.');
			settled = true; detach(); const ports = new MessageChannel(); let closed!: () => void;
			const closure = new Promise<void>((resolveClosed) => { closed = resolveClosed; });
			relay = relayMotionLinkBroadcast(ports.port2, channel, receivedSession, options.signal, closed);
			if (!initiate) channel.postMessage({ kind: 'connected', version: 1, peerOrigin, session: receivedSession });
			resolve({ port: ports.port1, closed: closure, session: receivedSession, dispose: () => { relay?.(); relay = null; } });
		} catch (error) { dispose(error); }
	}
	channel.addEventListener('message', message); channel.addEventListener('messageerror', malformed); options.signal?.addEventListener('abort', abort, { once: true });
	if (options.signal?.aborted) abort(); else if (initiate) channel.postMessage({ kind: 'connect', version: 1, peerOrigin, session });
	return { connection, dispose: () => { dispose(); } };
}
export function listenMotionLinkBroadcast(options: Options) { return rendezvous(options, false); }
export function connectMotionLinkBroadcast(options: Options & { readonly session: string }): Promise<MotionLinkBroadcastConnection> { return rendezvous(options, true).connection; }
