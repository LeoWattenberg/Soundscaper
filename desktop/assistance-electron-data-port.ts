/* SPDX-License-Identifier: AGPL-3.0-only */

import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';

/** Admit exactly one Electron main-process port from the trusted IPC event. */
export function assistanceElectronEventPort(event: unknown): HelperDataPlaneIoPort | null {
	if (!event || typeof event !== 'object') return null;
	const ports = (event as Readonly<{ ports?: unknown }>).ports;
	if (!Array.isArray(ports)) return null;
	if (ports.length !== 1) {
		for (const port of ports) closePort(port);
		return null;
	}
	const port = ports[0] as Partial<HelperDataPlaneIoPort> | null;
	if (!port || typeof port.postMessage !== 'function' || typeof port.on !== 'function'
		|| typeof port.close !== 'function') { closePort(port); return null; }
	// MessagePortMain accepts only MessagePortMain instances in its transfer
	// list. Keep generic worker transfers intact and clone bytes at this boundary.
	const postMessage = port.postMessage.bind(port);
	return Object.freeze({
		postMessage: (message: unknown): void => { postMessage(message); },
		on: port.on.bind(port),
		...(typeof port.off === 'function' ? { off: port.off.bind(port) } : {}),
		...(typeof port.removeListener === 'function' ? { removeListener: port.removeListener.bind(port) } : {}),
		...(typeof port.start === 'function' ? { start: port.start.bind(port) } : {}),
		close: port.close.bind(port),
	});
}

function closePort(value: unknown): void {
	if (value && typeof value === 'object' && typeof (value as { close?: unknown }).close === 'function') {
		try { (value as { close(): void }).close(); } catch { /* already closed */ }
	}
}
