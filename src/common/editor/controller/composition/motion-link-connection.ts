/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLinkConnectionUrl, readMotionLinkConnectionUrl, createMotionLinkNonce, motionLinkOrigin, MOTION_LINK_SEND_PATH, type MotionLinkOrigins } from '../../motion-link-connection-urls.ts';
import { normalizeMotionCompositionOffer } from '../../motion-link-protocol.ts';
import { listenMotionLinkBroadcast, type MotionLinkBroadcastConnection } from './internal/motion-link-broadcast.ts';
import { createMotionCompositionPortSender, receiveMotionCompositionPort, type MotionCompositionPortSender, type MotionLinkPortReceiverOptions, type MotionLinkPortSenderOptions } from './motion-link-port.ts';

function pageLifetime(signal?: AbortSignal) {
	const cancellation = new AbortController(); const page = typeof window === 'undefined' ? null : window;
	const abort = () => cancellation.abort(); page?.addEventListener('pagehide', abort, { once: true });
	return { signal: signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal, abort, dispose() { page?.removeEventListener('pagehide', abort); } };
}

export interface MotionLinkReceiverConnection { readonly url: string; readonly ready: Promise<void>; readonly completion: Promise<string>; dispose(): void }
/** Pending pairing expires; an established receiver accepts serialized saved revisions until explicitly disconnected. */
export function createMotionLinkReceiverConnection(options: MotionLinkOrigins & Pick<MotionLinkPortReceiverOptions, 'receive' | 'signal'>): MotionLinkReceiverConnection {
	motionLinkOrigin(options.senderOrigin); motionLinkOrigin(options.receiverOrigin);
	const cap = createMotionLinkNonce(); const lifetime = pageLifetime(options.signal); const signal = lifetime.signal;
	const listener = listenMotionLinkBroadcast({ cap, peerOrigin: options.senderOrigin, signal });
	const ready = listener.connection.then(() => undefined); void ready.catch(() => undefined);
	const completion = listener.connection.then(async (connection) => {
		try { return await receiveMotionCompositionPort({ ...options, persistent: true, signal, port: connection.port, session: connection.session }); } finally { connection.dispose(); }
	}).finally(() => { listener.dispose(); lifetime.dispose(); });
	return { url: createMotionLinkConnectionUrl(options.receiverOrigin, cap), ready, completion, dispose() { lifetime.abort(); listener.dispose(); lifetime.dispose(); } };
}
export interface MotionLinkSenderConnectionOptions extends MotionLinkOrigins, Pick<MotionLinkPortSenderOptions, 'readAsset' | 'signal'> {
	readonly connectionUrl: string; readonly locale?: 'en' | 'de'; readonly openWindow?: (url: string) => Window | null;
}
/** Call from a menu action so the sender bridge can open; subsequent saved updates reuse this connection. */
export async function openMotionLinkSenderConnection(options: MotionLinkSenderConnectionOptions): Promise<MotionCompositionPortSender> {
	options.signal?.throwIfAborted(); const receiver = readMotionLinkConnectionUrl(options.connectionUrl, options.receiverOrigin); const senderOrigin = motionLinkOrigin(options.senderOrigin);
	const cap = createMotionLinkNonce(); const session = createMotionLinkNonce(); const lifetime = pageLifetime(options.signal);
	const listener = listenMotionLinkBroadcast({ cap, session, peerOrigin: options.receiverOrigin, signal: lifetime.signal }); let connection: MotionLinkBroadcastConnection | null = null;
	const bridge = new URL(MOTION_LINK_SEND_PATH, senderOrigin); bridge.hash = new URLSearchParams({ cap, session, receiver: receiver.href, locale: options.locale ?? 'en' }).toString();
	try {
		const popup = options.openWindow ? options.openWindow(bridge.href) : window.open(bridge.href, '_blank', 'popup=1,width=680,height=460');
		// Isolated editors lose their WindowProxy relationship after navigation; popup.closed is not evidence of failure here.
		if (!popup) throw new Error('The browser blocked the composition bridge window.');
		connection = await listener.connection; const sender = createMotionCompositionPortSender({ ...options, signal: lifetime.signal, port: connection.port, session });
		const dispose = async () => { try { await sender.dispose(); } finally { connection?.dispose(); listener.dispose(); lifetime.dispose(); } };
		void connection.closed.then(dispose).catch(() => undefined); void sender.closed.then(() => { connection?.dispose(); listener.dispose(); lifetime.dispose(); });
		return { send: sender.send, closed: sender.closed, dispose };
	} catch (error) { connection?.dispose(); listener.dispose(); lifetime.dispose(); await listener.connection.catch(() => undefined); throw error; }
}
/** A convenience wrapper for a single transfer; automatic saved updates use the persistent factory above. */
export async function sendMotionLinkConnection(options: MotionLinkSenderConnectionOptions & Pick<MotionLinkPortSenderOptions, 'offer'>): Promise<string> {
	const offer = normalizeMotionCompositionOffer(options.offer); const sender = await openMotionLinkSenderConnection(options);
	try { return await sender.send(offer); } finally { await sender.dispose(); }
}
