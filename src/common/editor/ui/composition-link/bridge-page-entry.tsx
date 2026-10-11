/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveMotionLinkOrigins, MOTION_LINK_SEND_PATH, MOTION_LINK_RECEIVE_PATH, type MotionLinkOrigins } from '../../motion-link-connection-urls.ts';
import { openMotionLinkSendBridge, acceptMotionLinkReceiveBridge, readMotionLinkSendBridgeIntent, readMotionLinkReceiveBridgeIntent, type MotionLinkBridgeSession, type MotionLinkSendBridgeIntent, type MotionLinkReceiveBridgeIntent } from '../../controller/composition/motion-link-window-bridge.ts';
import { MOTION_LINK_BRIDGE_COPY_BY_LOCALE } from '../../../i18n/editor-motion-link-bridge-copy.ts';
import './bridge-page.css';

type Intent = Readonly<{ role: 'send'; value: MotionLinkSendBridgeIntent }> | Readonly<{ role: 'receive'; value: MotionLinkReceiveBridgeIntent }>;
interface Props { readonly scope: Window; readonly origins: MotionLinkOrigins; readonly intent: Intent; readonly copy: Readonly<Record<keyof typeof MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en, string>> }
function CompositionBridge({ scope, origins, intent, copy }: Props) {
	const lifetime = useRef(new AbortController()); const session = useRef<MotionLinkBridgeSession | null>(null);
	const [status, setStatus] = useState(intent.role === 'receive' ? copy.sending : ''); const [started, setStarted] = useState(intent.role === 'receive'); const [closed, setClosed] = useState(false);
	function stop() { lifetime.current.abort(); session.current?.dispose(); setClosed(true); setStatus(copy.closed); }
	const connect = useCallback(async () => {
		setStarted(true); setStatus(intent.role === 'send' ? copy.receiving : copy.sending);
		try {
			session.current = intent.role === 'send' ? await openMotionLinkSendBridge(scope, origins, intent.value, lifetime.current.signal) : await acceptMotionLinkReceiveBridge(scope, origins, intent.value, lifetime.current.signal);
			setStatus(copy.connected); await session.current.closed; setClosed(true); setStatus(copy.closed);
		} catch { setClosed(true); setStatus(copy.failed); }
	}, [scope, origins, intent, copy]);
	useEffect(() => {
		const cancellation = lifetime.current;
		const dispose = () => { cancellation.abort(); session.current?.dispose(); };
		scope.addEventListener('pagehide', dispose, { once: true });
		if (intent.role === 'receive') void connect();
		return () => { dispose(); scope.removeEventListener('pagehide', dispose); };
	}, [scope, intent.role, connect]);
	return <><h1>{copy.title}</h1><p>{copy.hint}</p><p role="status" aria-live="polite">{status}</p>
		{intent.role === 'send' && <button type="button" disabled={started || closed} onClick={() => { void connect(); }}>{copy.send}</button>}
		<button type="button" disabled={closed} onClick={stop}>{copy.cancel}</button></>;
}
/** Standalone opt-in bridge document; it has no editor session or storage access. */
export function mountMotionLinkBridgePage(scope: Window = window): void {
	const element = scope.document.getElementById('composition-link-bridge'); if (!element) throw new Error('Composition bridge document is missing.');
	const locale = new URLSearchParams(scope.location.hash.slice(1)).get('locale') === 'de' ? 'de' : 'en'; const copy = MOTION_LINK_BRIDGE_COPY_BY_LOCALE[locale];
	scope.document.documentElement.lang = locale; scope.document.title = copy.title; const root = createRoot(element);
	try {
		if (scope.top !== scope || scope.crossOriginIsolated) throw new Error('Composition bridges require their dedicated top-level route.');
		const productId = __SCAPE_PRODUCT__;
		if (productId !== 'motionscaper' && !(productId === 'framescaper' && __SCAPE_FRAMESCAPER_LINE__ === 'successor')) throw new Error('This product line cannot host a composition bridge.');
		const origins = resolveMotionLinkOrigins(productId, scope.location.origin, import.meta.env.PUBLIC_MOTION_LINK_PEER_ORIGIN); let intent: Intent;
		if (productId === 'motionscaper' && scope.location.pathname === MOTION_LINK_SEND_PATH) intent = { role: 'send', value: readMotionLinkSendBridgeIntent(scope.location.hash, origins.receiverOrigin) };
		else if (productId === 'framescaper' && scope.location.pathname === MOTION_LINK_RECEIVE_PATH) intent = { role: 'receive', value: readMotionLinkReceiveBridgeIntent(scope.location.hash, origins.senderOrigin) };
		else throw new Error('Composition bridge route does not match this product.');
		scope.history.replaceState(null, '', scope.location.pathname); root.render(<CompositionBridge scope={scope} origins={origins} intent={intent} copy={copy} />);
	} catch { root.render(<><h1>{copy.title}</h1><p role="status">{copy.failed}</p></>); }
}
if (typeof window !== 'undefined' && document.getElementById('composition-link-bridge')) mountMotionLinkBridgePage();
