/* SPDX-License-Identifier: AGPL-3.0-only */
import { createRoot } from 'react-dom/client';
import { resolveMotionLinkOrigins, MOTION_LINK_SEND_PATH, MOTION_LINK_RECEIVE_PATH } from '../../motion-link-connection-urls.ts';
import { openMotionLinkSendBridge, acceptMotionLinkReceiveBridge, readMotionLinkSendBridgeIntent, readMotionLinkReceiveBridgeIntent, type MotionLinkSendBridgeIntent, type MotionLinkReceiveBridgeIntent } from '../../controller/composition/motion-link-window-bridge.ts';
import { loadMotionLinkBridgeCopy, resolveMotionLinkBridgeCopy } from '../../../i18n/editor-motion-link-bridge-copy.ts';
import { motionLinkLocaleForEditor } from '../../motion-link-locale.ts';
import CompositionBridge from './CompositionBridge.tsx';
import './bridge-page.css';

type Intent = Readonly<{ role: 'send'; value: MotionLinkSendBridgeIntent }> | Readonly<{ role: 'receive'; value: MotionLinkReceiveBridgeIntent }>;
/** Standalone opt-in bridge document; it has no editor session or storage access. */
export function mountMotionLinkBridgePage(scope: Window = window): void {
	const element = scope.document.getElementById('composition-link-bridge'); if (!element) throw new Error('Composition bridge document is missing.');
	const locale = motionLinkLocaleForEditor(new URLSearchParams(scope.location.hash.slice(1)).get('locale') ?? 'en');
	const copy = resolveMotionLinkBridgeCopy(locale);
	scope.document.documentElement.lang = locale; scope.document.title = copy.title; const root = createRoot(element);
	try {
		if (scope.top !== scope || scope.crossOriginIsolated) throw new Error('Composition bridges require their dedicated top-level route.');
		const productId = __SCAPE_PRODUCT__;
		if (productId !== 'motionscaper' && !(productId === 'framescaper' && __SCAPE_FRAMESCAPER_LINE__ === 'successor')) throw new Error('This product line cannot host a composition bridge.');
		const origins = resolveMotionLinkOrigins(productId, scope.location.origin, import.meta.env.PUBLIC_MOTION_LINK_PEER_ORIGIN); let intent: Intent;
		if (productId === 'motionscaper' && scope.location.pathname === MOTION_LINK_SEND_PATH) intent = { role: 'send', value: readMotionLinkSendBridgeIntent(scope.location.hash, origins.receiverOrigin) };
		else if (productId === 'framescaper' && scope.location.pathname === MOTION_LINK_RECEIVE_PATH) intent = { role: 'receive', value: readMotionLinkReceiveBridgeIntent(scope.location.hash, origins.senderOrigin) };
		else throw new Error('Composition bridge route does not match this product.');
		const open = (signal: AbortSignal) => intent.role === 'send' ? openMotionLinkSendBridge(scope, origins, intent.value, signal) : acceptMotionLinkReceiveBridge(scope, origins, intent.value, signal);
		const render = (value: typeof copy) => { scope.document.title = value.title; root.render(<CompositionBridge scope={scope} role={intent.role} open={open} copy={value} />); };
		scope.history.replaceState(null, '', scope.location.pathname); render(copy);
		let retired = false; const retire = () => { retired = true; }; scope.addEventListener('pagehide', retire, { once: true });
		void loadMotionLinkBridgeCopy(locale).then(value => { if (!retired) render(value); }).catch(() => undefined)
			.finally(() => scope.removeEventListener('pagehide', retire));
	} catch { root.render(<><h1>{copy.title}</h1><p role="status">{copy.failed}</p></>); }
}
if (typeof window !== 'undefined' && document.getElementById('composition-link-bridge')) mountMotionLinkBridgePage();
