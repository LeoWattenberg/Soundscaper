/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which origin a transfer document talks to, and on whose say-so.
 *
 * framescaper.org does not exist yet, and a transfer that only works once it
 * does is a transfer nobody can test. So the peer origin is configuration with
 * a defaulted answer rather than a constant: the production pair is built in,
 * anything else - a preview deployment, a dev server, a packaged desktop shell
 * - defaults to talking to itself, which is a complete and honest local
 * exercise of both halves of the handshake.
 *
 * Everything here is fail-closed. An origin that is not exactly an origin is
 * refused rather than normalized, because these values are handed to
 * `postMessage` as a target origin and to the handshake channel as its allowed
 * set; a value that silently widens (`'*'`, `'null'`, a URL with a path, a
 * trailing slash) is the whole attack.
 */

export const TRANSFER_PEER_ORIGIN_SETTING = 'PUBLIC_TRANSFER_PEER_ORIGIN';

/** The production pairing, both ways round. */
export const TRANSFER_DEFAULT_PEER_ORIGINS: ReadonlyMap<string, string> = new Map([
	['https://soundscaper.org', 'https://framescaper.org'],
	['https://framescaper.org', 'https://soundscaper.org'],
]);

export class TransferConfigurationError extends Error {
	readonly field: string;

	constructor(message: string, field: string) {
		super(message);
		this.name = 'TransferConfigurationError';
		this.field = field;
	}
}

export interface TransferOriginConfiguration {
	/** The origin this document is served from. */
	readonly selfOrigin: string;
	/** The origin the other product is served from; may equal `selfOrigin`. */
	readonly peerOrigin: string;
	/** Exactly the origins the handshake channel may speak to or hear from. */
	readonly allowedOrigins: readonly string[];
	/** True when the peer defaulted to this same origin, i.e. a local exercise. */
	readonly loopback: boolean;
}

/**
 * Admit one value as an exact serialized origin.
 *
 * `new URL(value).origin` re-serializes, so the comparison against the input is
 * what rejects `https://example.org/`, `https://example.org/path`,
 * `https://user:pw@example.org` and uppercase hosts instead of quietly
 * accepting the normalized form the caller did not write.
 */
export function admitTransferOrigin(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		throw new TransferConfigurationError(`${field} must be a string origin.`, field);
	}
	const trimmed = value.trim();
	if (!trimmed) throw new TransferConfigurationError(`${field} must not be empty.`, field);
	if (trimmed.length > 2048) {
		throw new TransferConfigurationError(`${field} is longer than 2048 characters.`, field);
	}
	if (trimmed === '*' || trimmed === 'null') {
		throw new TransferConfigurationError(`${field} must name one exact origin, not ${trimmed}.`, field);
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new TransferConfigurationError(`${field} is not a URL: ${trimmed}.`, field);
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new TransferConfigurationError(
			`${field} must use http or https, not ${parsed.protocol}.`,
			field,
		);
	}
	if (parsed.origin === 'null') {
		throw new TransferConfigurationError(`${field} has an opaque origin: ${trimmed}.`, field);
	}
	if (parsed.origin !== trimmed) {
		throw new TransferConfigurationError(
			`${field} must be exactly an origin; ${trimmed} serializes as ${parsed.origin}.`,
			field,
		);
	}
	return parsed.origin;
}

/**
 * Read the configured peer origin out of an environment-shaped record.
 *
 * Vite inlines `import.meta.env.PUBLIC_*` at build time, and the desktop shell
 * has no `import.meta.env` at all, so the lookup takes a plain record and
 * treats absent, empty and whitespace-only alike as "not configured".
 */
export function readConfiguredPeerOrigin(source: unknown): string | null {
	if (source === null || typeof source !== 'object') return null;
	const value = (source as Record<string, unknown>)[TRANSFER_PEER_ORIGIN_SETTING];
	if (value === undefined || value === null) return null;
	if (typeof value === 'string' && !value.trim()) return null;
	return admitTransferOrigin(value, TRANSFER_PEER_ORIGIN_SETTING);
}

export interface ResolveTransferOriginsOptions {
	/** `location.origin` of the document being configured. */
	readonly selfOrigin: unknown;
	/** Usually `import.meta.env`; anything record-shaped will do. */
	readonly environment?: unknown;
	/** Already-admitted override, for callers that read configuration themselves. */
	readonly peerOrigin?: unknown;
}

export function resolveTransferOrigins(
	options: ResolveTransferOriginsOptions,
): TransferOriginConfiguration {
	if (options === null || typeof options !== 'object') {
		throw new TransferConfigurationError('Transfer origin options must be a record.', 'options');
	}
	const selfOrigin = admitTransferOrigin(options.selfOrigin, 'selfOrigin');
	const explicit = options.peerOrigin === undefined || options.peerOrigin === null
		? null
		: admitTransferOrigin(options.peerOrigin, 'peerOrigin');
	const configured = explicit ?? readConfiguredPeerOrigin(options.environment);
	const peerOrigin = configured
		?? TRANSFER_DEFAULT_PEER_ORIGINS.get(selfOrigin)
		?? selfOrigin;
	const allowedOrigins = peerOrigin === selfOrigin ? [selfOrigin] : [selfOrigin, peerOrigin];
	return Object.freeze({
		selfOrigin,
		peerOrigin,
		allowedOrigins: Object.freeze(allowedOrigins),
		loopback: peerOrigin === selfOrigin,
	});
}

/** The URL a sender opens to reach the peer's receiving document. */
export function transferPeerUrl(configuration: TransferOriginConfiguration, path: string): string {
	if (typeof path !== 'string' || !path.startsWith('/')) {
		throw new TransferConfigurationError('A transfer peer path must be root-relative.', 'path');
	}
	const url = new URL(path, `${configuration.peerOrigin}/`);
	if (url.origin !== configuration.peerOrigin) {
		throw new TransferConfigurationError(
			`A transfer peer path must stay on ${configuration.peerOrigin}.`,
			'path',
		);
	}
	return url.href;
}
