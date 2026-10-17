/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionLinkNonce, normalizeMotionLinkPacket, motionLinkPacketTransfers, type MotionLinkPacket, type MotionLinkRequest, type MotionLinkResponse } from '../../../motion-link-wire.ts';

/** One request in each direction. A read request also acknowledges retention of the previous chunk. */
export function createMotionLinkRpc(port: MessagePort, sessionValue: string, handle: (request: MotionLinkRequest, signal: AbortSignal) => Promise<MotionLinkResponse>, options: Readonly<{ signal?: AbortSignal; idleTimeoutMs?: number; onHandled?: (response: MotionLinkResponse) => void; onPeerClose?: () => void; allowIdle?: () => boolean }> = {}) {
	const session = motionLinkNonce(sessionValue); const idle = options.idleTimeoutMs ?? 30_000;
	if (!Number.isSafeInteger(idle) || idle < 10 || idle > 120_000) throw new RangeError('Motion link idle timeout is outside its range.');
	const lifetime = new AbortController(); let outgoing = 0; let incoming = 0; let busy = false; let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: { id: number; resolve(value: MotionLinkResponse): void; reject(error: unknown): void } | null = null;
	let task: Promise<void> | null = null;
	function touch() { clearTimeout(timer); timer = setTimeout(() => { if (options.allowIdle?.() && !pending && !busy) touch(); else fail(new Error('Motion link idle timeout.')); }, idle); }
	function post(packet: MotionLinkPacket) { port.postMessage(packet, motionLinkPacketTransfers(packet)); }
	function fail(reason: unknown, notify = true) {
		if (disposed) return; disposed = true;
		if (notify) { try { post({ protocol: 'motion-link-port', version: 1, session, type: 'close' }); } catch { /* A dead peer is already terminal. */ } }
		clearTimeout(timer); port.removeEventListener('message', message); port.removeEventListener('messageerror', malformed); options.signal?.removeEventListener('abort', cancelled);
		lifetime.abort(reason); pending?.reject(reason); pending = null; port.close();
	}
	function cancelled() { fail(options.signal?.reason ?? new DOMException('Motion link cancelled.', 'AbortError')); }
	function malformed() { fail(new TypeError('Motion link message could not be decoded.')); }
	function message(event: MessageEvent<unknown>) {
		try {
			const packet = normalizeMotionLinkPacket(event.data, session); touch();
			if (packet.type === 'close') { options.onPeerClose?.(); fail(new Error('Motion link peer closed or refused the transfer.'), false); return; }
			if (packet.type === 'response') {
				if (!pending || packet.id !== pending.id) throw new Error('Motion link response sequence changed.');
				const waiting = pending; pending = null; waiting.resolve(packet.response); return;
			}
			if (busy || packet.id !== incoming + 1) throw new Error('Motion link request exceeded its one-message window.');
			incoming = packet.id; busy = true;
			task = handle(packet.request, lifetime.signal).then((response) => {
				if (!disposed) { post({ protocol: 'motion-link-port', version: 1, session, type: 'response', id: packet.id, response }); touch(); options.onHandled?.(response); }
			}).catch((error: unknown) => { fail(error); }).finally(() => { busy = false; task = null; });
		} catch (error) { fail(error); }
	}
	port.addEventListener('message', message); port.addEventListener('messageerror', malformed); port.start();
	options.signal?.addEventListener('abort', cancelled, { once: true }); if (options.signal?.aborted) cancelled(); else touch();
	return {
		signal: lifetime.signal,
		request(request: MotionLinkRequest): Promise<MotionLinkResponse> {
			if (disposed) return Promise.reject(lifetime.signal.reason as unknown); if (pending) return Promise.reject(new Error('Motion link permits only one unacknowledged request.'));
			return new Promise((resolve, reject) => { const id = ++outgoing; pending = { id, resolve, reject }; try { post({ protocol: 'motion-link-port', version: 1, session, type: 'request', id, request }); touch(); } catch (error) { fail(error); } });
		},
		fail,
		async dispose() { fail(new DOMException('Motion link disposed.', 'AbortError')); await task; },
	};
}
