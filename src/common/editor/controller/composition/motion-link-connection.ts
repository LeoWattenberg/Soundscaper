/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLinkConnectionUrl, readMotionLinkConnectionUrl, createMotionLinkNonce, motionLinkOrigin, MOTION_LINK_SEND_PATH, type MotionLinkOrigins } from '../../motion-link-connection-urls.ts';
import { normalizeMotionCompositionOffer } from '../../motion-link-protocol.ts';
import { listenMotionLinkBroadcast } from './internal/motion-link-broadcast.ts';
import { receiveMotionCompositionPort, sendMotionCompositionPort, type MotionLinkPortReceiverOptions, type MotionLinkPortSenderOptions } from './motion-link-port.ts';

export interface MotionLinkReceiverConnection { readonly url: string; readonly completion: Promise<string>; dispose(): void }
export function createMotionLinkReceiverConnection(options: MotionLinkOrigins & Pick<MotionLinkPortReceiverOptions, 'receive' | 'signal'>): MotionLinkReceiverConnection {
	motionLinkOrigin(options.senderOrigin); motionLinkOrigin(options.receiverOrigin);
	const cap = createMotionLinkNonce(); const cancellation = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, cancellation.signal]) : cancellation.signal;
	const listener = listenMotionLinkBroadcast({ cap, peerOrigin: options.senderOrigin, signal });
	const completion = listener.connection.then(async (connection) => {
		try { return await receiveMotionCompositionPort({ ...options, signal, port: connection.port, session: connection.session }); } finally { connection.dispose(); }
	}).finally(() => { listener.dispose(); });
	return { url: createMotionLinkConnectionUrl(options.receiverOrigin, cap), completion, dispose() { cancellation.abort(); listener.dispose(); } };
}
export async function sendMotionLinkConnection(options: MotionLinkOrigins & Pick<MotionLinkPortSenderOptions, 'offer' | 'readAsset' | 'signal'> & Readonly<{
	connectionUrl: string; locale?: 'en' | 'de'; openWindow?: (url: string) => Window | null;
}>): Promise<string> {
	options.signal?.throwIfAborted(); const receiver = readMotionLinkConnectionUrl(options.connectionUrl, options.receiverOrigin); const senderOrigin = motionLinkOrigin(options.senderOrigin);
	const offer = normalizeMotionCompositionOffer(options.offer); const cap = createMotionLinkNonce(); const session = createMotionLinkNonce();
	const listener = listenMotionLinkBroadcast({ cap, session, peerOrigin: options.receiverOrigin, signal: options.signal });
	const bridge = new URL(MOTION_LINK_SEND_PATH, senderOrigin); bridge.hash = new URLSearchParams({ cap, session, receiver: receiver.href, locale: options.locale ?? 'en' }).toString();
	try {
		const popup = options.openWindow ? options.openWindow(bridge.href) : window.open(bridge.href, '_blank', 'popup=1,width=680,height=460');
		// Isolated editors lose their WindowProxy relationship after navigation; popup.closed is not evidence of failure here.
		if (!popup) { listener.dispose(); await listener.connection.catch(() => undefined); throw new Error('The browser blocked the composition bridge window.'); }
		const connection = await listener.connection;
		try { return await sendMotionCompositionPort({ ...options, offer, port: connection.port, session }); } finally { connection.dispose(); }
	} finally { listener.dispose(); await listener.connection.catch(() => undefined); }
}
