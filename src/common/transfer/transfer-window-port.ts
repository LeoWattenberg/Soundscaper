/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The window half of the transfer handshake: popups, openers and `postMessage`.
 *
 * `project-transfer-handshake.ts` deliberately knows nothing about windows - it
 * speaks to an injected `ProjectTransferPort`. This module is the only place
 * that touches one, which is what keeps the protocol testable without a DOM and
 * keeps the origin checks in one auditable place.
 *
 * Why a popup at all: third-party storage is partitioned by top-level site and
 * `COEP: credentialless` hands a cross-origin iframe an ephemeral empty bucket,
 * so an embedded frame of the other product can see none of its own projects. A
 * popup is a top-level context with ordinary first-party storage. It only works
 * while the opener relationship survives, which is what the per-route
 * `Cross-Origin-Opener-Policy` values in `public/_headers` exist for.
 */

import type {
	ProjectTransferInboundMessage,
	ProjectTransferPort,
} from './project-transfer-handshake.ts';

export interface TransferMessageEventLike {
	readonly origin: unknown;
	readonly data: unknown;
	readonly source?: unknown;
}

export interface TransferMessageTarget {
	postMessage(message: unknown, targetOrigin: string): void;
	readonly closed?: boolean;
}

export interface TransferMessageSource {
	addEventListener(type: 'message', listener: (event: TransferMessageEventLike) => void): void;
	removeEventListener(type: 'message', listener: (event: TransferMessageEventLike) => void): void;
}

export class TransferWindowError extends Error {
	readonly code: 'popup-blocked' | 'no-opener' | 'peer-closed';

	constructor(code: 'popup-blocked' | 'no-opener' | 'peer-closed', message: string) {
		super(message);
		this.name = 'TransferWindowError';
		this.code = code;
	}
}

export interface CreateWindowTransferPortOptions {
	/** The window messages are posted to - the popup, or the opener. */
	readonly peer: TransferMessageTarget;
	/** The window messages are heard on - normally the local `window`. */
	readonly listener: TransferMessageSource;
	/** Exactly the origins whose messages may enter the mailbox. */
	readonly allowedOrigins: readonly string[];
	/**
	 * When given, only messages whose `event.source` is this window are
	 * admitted. A popup can be navigated away and a page can be opened by more
	 * than one window; identity is the cheapest way to be sure the traffic came
	 * from the peer this port was built for.
	 */
	readonly expectedSource?: unknown;
}

export interface WindowTransferPort extends ProjectTransferPort {
	/** Detach the message listener. Safe to call more than once. */
	close(): void;
}

export function createWindowTransferPort(
	options: CreateWindowTransferPortOptions,
): WindowTransferPort {
	if (options === null || typeof options !== 'object') {
		throw new TypeError('A window transfer port needs an options record.');
	}
	const { peer, listener, expectedSource } = options;
	if (typeof peer?.postMessage !== 'function') {
		throw new TypeError('A window transfer port needs a peer window that can post messages.');
	}
	if (typeof listener?.addEventListener !== 'function'
		|| typeof listener.removeEventListener !== 'function') {
		throw new TypeError('A window transfer port needs a listener target.');
	}
	const allowed = admitAllowedOriginSet(options.allowedOrigins);
	const listeners = new Set<(message: ProjectTransferInboundMessage) => void>();
	let closed = false;

	const onMessage = (event: TransferMessageEventLike): void => {
		if (closed) return;
		const origin = event?.origin;
		if (typeof origin !== 'string' || !allowed.has(origin)) return;
		if (expectedSource !== undefined && expectedSource !== null && event.source !== expectedSource) return;
		const message: ProjectTransferInboundMessage = { origin, data: event.data };
		for (const subscriber of [...listeners]) subscriber(message);
	};
	listener.addEventListener('message', onMessage);

	return Object.freeze({
		post(message: unknown, targetOrigin: string): void {
			if (closed) throw new TransferWindowError('peer-closed', 'The transfer port is closed.');
			if (peer.closed === true) {
				throw new TransferWindowError('peer-closed', 'The transfer peer window was closed.');
			}
			if (!allowed.has(targetOrigin)) {
				throw new TransferWindowError(
					'peer-closed',
					`Refusing to post a transfer message to the unlisted origin ${targetOrigin}.`,
				);
			}
			peer.postMessage(message, targetOrigin);
		},
		subscribe(subscriber: (message: ProjectTransferInboundMessage) => void): () => void {
			if (typeof subscriber !== 'function') {
				throw new TypeError('A transfer port subscriber must be a function.');
			}
			listeners.add(subscriber);
			return () => {
				listeners.delete(subscriber);
			};
		},
		close(): void {
			if (closed) return;
			closed = true;
			listeners.clear();
			listener.removeEventListener('message', onMessage);
		},
	});
}

function admitAllowedOriginSet(value: unknown): ReadonlySet<string> {
	if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
		throw new TypeError('A window transfer port needs between one and eight allowed origins.');
	}
	const origins = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== 'string' || !entry || entry === '*' || entry === 'null') {
			throw new TypeError('Every allowed transfer origin must be one exact origin.');
		}
		origins.add(entry);
	}
	return origins;
}

export interface TransferPopupScope {
	open(url: string, target: string, features: string): TransferMessageTarget | null;
}

export interface OpenTransferPopupOptions {
	readonly scope: TransferPopupScope;
	readonly url: string;
	readonly name?: string;
	readonly features?: string;
}

/**
 * Popup features are named explicitly: without them some browsers open a tab,
 * and a tab that the user switches away from is a transfer the user cannot see
 * finish. `noopener` is exactly what must NOT be set - it is the opener
 * relationship that carries the handshake.
 */
export const TRANSFER_POPUP_FEATURES = 'popup=1,width=720,height=640,noreferrer=0';

export function openTransferPopup(options: OpenTransferPopupOptions): TransferMessageTarget {
	const { scope, url } = options ?? {};
	if (typeof scope?.open !== 'function') {
		throw new TypeError('Opening a transfer popup needs a scope that can open windows.');
	}
	if (typeof url !== 'string' || !/^https?:\/\//u.test(url)) {
		throw new TypeError('A transfer popup URL must be an absolute http(s) URL.');
	}
	const popup = scope.open(url, options.name ?? 'kw-project-transfer', options.features ?? TRANSFER_POPUP_FEATURES);
	if (!popup || typeof popup.postMessage !== 'function') {
		throw new TransferWindowError(
			'popup-blocked',
			'The browser blocked the transfer popup. Allow popups for this site, or use the archive'
			+ ' download instead.',
		);
	}
	return popup;
}

export interface TransferOpenerScope {
	readonly opener?: unknown;
}

/**
 * The receiving document's view of whoever opened it.
 *
 * A null opener here is not a bug to work around: it means the browser severed
 * the relationship, which is what `Cross-Origin-Opener-Policy: same-origin`
 * does. The page has to say so and fall back to file import rather than wait
 * for a handshake that can never arrive.
 */
export function resolveTransferOpener(scope: TransferOpenerScope): TransferMessageTarget {
	const opener = scope?.opener;
	if (!opener || typeof (opener as TransferMessageTarget).postMessage !== 'function') {
		throw new TransferWindowError(
			'no-opener',
			'This page was not opened by the other product, so there is no transfer to accept.'
			+ ' Import downloaded .scape archives instead.',
		);
	}
	return opener as TransferMessageTarget;
}
