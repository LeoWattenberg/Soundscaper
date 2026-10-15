/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MotionLinkBridgeSession } from '../../controller/composition/motion-link-window-bridge.ts';
import type { MotionLinkBridgeCopy } from '../../../i18n/editor-motion-link-bridge-copy.ts';

export type { MotionLinkBridgeCopy } from '../../../i18n/editor-motion-link-bridge-copy.ts';
export interface CompositionBridgeProps {
	readonly scope: Window; readonly role: 'send' | 'receive'; readonly copy: MotionLinkBridgeCopy;
	readonly open: (signal: AbortSignal) => Promise<MotionLinkBridgeSession>;
}

export default function CompositionBridge({ scope, role, open, copy }: CompositionBridgeProps) {
	const lifetime = useRef(new AbortController()); const session = useRef<MotionLinkBridgeSession | null>(null);
	const [status, setStatus] = useState<keyof MotionLinkBridgeCopy | null>(role === 'receive' ? 'sending' : null);
	const [started, setStarted] = useState(role === 'receive'); const [closed, setClosed] = useState(false);
	function stop() { lifetime.current.abort(); session.current?.dispose(); setClosed(true); setStatus('closed'); }
	const connect = useCallback(async () => {
		setStarted(true); setStatus(role === 'send' ? 'receiving' : 'sending');
		try {
			session.current = await open(lifetime.current.signal);
			setStatus('connected'); await session.current.closed; setClosed(true); setStatus('closed');
		} catch { setClosed(true); setStatus('failed'); }
	}, [role, open]);
	useEffect(() => {
		const cancellation = lifetime.current;
		const dispose = () => { cancellation.abort(); session.current?.dispose(); };
		scope.addEventListener('pagehide', dispose, { once: true });
		if (role === 'receive') void connect();
		return () => { dispose(); scope.removeEventListener('pagehide', dispose); };
	}, [scope, role, connect]);
	return <><h1>{copy.title}</h1><p>{copy.hint}</p><p role="status" aria-live="polite">{status ? copy[status] : ''}</p>
		{role === 'send' && <button type="button" disabled={started || closed} onClick={() => { void connect(); }}>{copy.send}</button>}
		<button type="button" disabled={closed} onClick={stop}>{copy.cancel}</button></>;
}
