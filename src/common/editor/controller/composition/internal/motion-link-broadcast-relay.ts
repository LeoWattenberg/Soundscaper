/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionLinkPacket, motionLinkPacketTransfers, type MotionLinkPacket } from '../../../motion-link-wire.ts';

/** Heartbeats tolerate throttled background tabs; pagehide/cancel closes immediately.
 * Two bounded RPC directions. BroadcastChannel copies at most one admitted chunk per direction; it never queues a second request before its ACK. */
export function relayMotionLinkBroadcast(port: MessagePort, channel: BroadcastChannel, session: string, signal?: AbortSignal, onClosed?: () => void): () => void {
	let disposed = false; let lastPeer = performance.now();
	let toPeer = 0; let fromPeer = 0; let toPeerPending: number | null = null; let fromPeerPending: number | null = null;
	const closePacket = { protocol: 'motion-link-port', version: 1, session, type: 'close' } as const;
	function dispose() {
		if (disposed) return; disposed = true; clearInterval(heartbeat);
		try { channel.postMessage({ kind: 'packet', packet: closePacket }); port.postMessage(closePacket); } finally {
			channel.removeEventListener('message', incoming); channel.removeEventListener('messageerror', dispose); channel.close();
			port.removeEventListener('message', outgoing); port.removeEventListener('messageerror', dispose); port.close(); signal?.removeEventListener('abort', dispose); onClosed?.();
		}
	}
	function admit(packet: MotionLinkPacket, outbound: boolean) {
		if (packet.type === 'close') return;
		if (packet.type === 'request') {
			if (outbound) { if (toPeerPending !== null || packet.id !== toPeer + 1) throw new Error('Motion link broadcast exceeded its outgoing request window.'); toPeer = packet.id; toPeerPending = packet.id; }
			else { if (fromPeerPending !== null || packet.id !== fromPeer + 1) throw new Error('Motion link broadcast exceeded its incoming request window.'); fromPeer = packet.id; fromPeerPending = packet.id; }
		} else if (outbound) {
			if (fromPeerPending !== packet.id) throw new Error('Motion link broadcast response changed.'); fromPeerPending = null;
		} else { if (toPeerPending !== packet.id) throw new Error('Motion link broadcast response changed.'); toPeerPending = null; }
	}
	function incoming(event: MessageEvent<unknown>) {
		try {
			const value = event.data;
			if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) throw new Error('Malformed Motion broadcast envelope.');
			if ('kind' in value && value.kind === 'heartbeat' && 'session' in value && value.session === session) { lastPeer = performance.now(); return; }
			if (!('kind' in value) || value.kind !== 'packet' || !('packet' in value)) throw new Error('Malformed Motion broadcast packet.');
			const packet = normalizeMotionLinkPacket(value.packet, session); admit(packet, false); lastPeer = performance.now();
			port.postMessage(packet, motionLinkPacketTransfers(packet)); if (packet.type === 'close') dispose();
		} catch { dispose(); }
	}
	function outgoing(event: MessageEvent<unknown>) {
		try { const packet = normalizeMotionLinkPacket(event.data, session); admit(packet, true); channel.postMessage({ kind: 'packet', packet }); if (packet.type === 'close') dispose(); }
		catch { dispose(); }
	}
	const heartbeat = setInterval(() => { if (performance.now() - lastPeer > 120_000) dispose(); else channel.postMessage({ kind: 'heartbeat', session }); }, 5_000);
	channel.addEventListener('message', incoming); channel.addEventListener('messageerror', dispose);
	port.addEventListener('message', outgoing); port.addEventListener('messageerror', dispose); port.start();
	signal?.addEventListener('abort', dispose, { once: true }); if (signal?.aborted) dispose();
	return dispose;
}
