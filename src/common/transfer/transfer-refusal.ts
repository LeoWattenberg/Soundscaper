/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How a refusal survives the crossing.
 *
 * The handshake wire carries exactly two things about an entry the receiving
 * origin would not store: a `status` of `'failed'`, and one free-text `reason`.
 * Both of the distinctions a visitor actually needs are therefore lost by
 * default - whether the entry was *skipped* rather than failed, and what the
 * refusing layer *named* it - and both are lost in the direction that overstates
 * success. This module is the vocabulary that carries them anyway, by encoding
 * them into the front of the reason and decoding them back out on arrival.
 *
 * It is kept apart from the transports because three layers speak it: the
 * receiver encodes, the sender decodes, and the reporting reads the decoded
 * parts back to the visitor.
 */

/**
 * Marks an acknowledgement the receiver declined as a *skip* rather than a
 * failure.
 *
 * The wire's `status` field is exactly `'stored' | 'failed'` and cannot be
 * widened from here, but `reason` is free text the protocol carries back to the
 * sender untouched. So a skip travels home as a refusal whose reason begins
 * with this prefix, and the sender's reporting reads it back off to tell a skip
 * from a failure.
 *
 * The alternative - acknowledging a skip as `stored` - is the defect this
 * exists to prevent: an archive the receiving build opens read-only is never
 * written, and telling the sender it was stored is how a visitor comes to
 * delete the only copy of a project.
 */
export const TRANSFER_SKIPPED_REASON_PREFIX = 'skipped: ';

/** True when the peer declined this entry as a skip rather than a failure. */
export function isTransferSkipReason(reason: unknown): boolean {
	return typeof reason === 'string' && reason.startsWith(TRANSFER_SKIPPED_REASON_PREFIX);
}

/**
 * The reason text a refusal carried, without either wire marker.
 *
 * Defined in terms of `decodeTransferRefusal()` so it cannot drift from it: a
 * version that stripped only the skip prefix would hand its caller a reason
 * still wearing its `[code]` marker, and that string would be rendered to a
 * visitor verbatim.
 */
export function transferSkipReasonText(reason: unknown): string {
	return decodeTransferRefusal(reason).text;
}

/**
 * The marker that carries a refusal's *name* home beside its prose.
 *
 * Every layer under this one refuses by name - `'entry-too-large'`,
 * `'shared-memory'`, `'archive-read-only'` - and the wire carries exactly one
 * free-text `reason` per entry. Dropping the name at the water's edge is how a
 * precise refusal arrives on the sending origin as "the archive could not be
 * imported", which is the one thing a visitor cannot act on. So the name is
 * encoded into the front of the reason, where the protocol's own 512-character
 * truncation cannot reach it, and decoded back out on arrival.
 */
const TRANSFER_REFUSAL_CODE_PATTERN = /^\[([a-z][a-z0-9-]{0,63})\]\s*/u;

export interface TransferRefusal {
	/** True when the peer declined the entry without failing it. */
	readonly skipped: boolean;
	/** The name the refusing layer gave it, when it gave one. */
	readonly code: string | null;
	/** The reason, with both markers stripped. */
	readonly text: string;
}

export function encodeTransferRefusal(refusal: {
	readonly skipped?: boolean;
	readonly code?: string | null;
	readonly text?: string | null;
}): string {
	const code = typeof refusal.code === 'string' && TRANSFER_REFUSAL_CODE_PATTERN.test(`[${refusal.code}] `)
		? `[${refusal.code}] `
		: '';
	const text = typeof refusal.text === 'string' && refusal.text.trim()
		? refusal.text.trim()
		: 'no reason reported';
	return `${refusal.skipped ? TRANSFER_SKIPPED_REASON_PREFIX : ''}${code}${text}`;
}

export function decodeTransferRefusal(reason: unknown): TransferRefusal {
	if (typeof reason !== 'string') return Object.freeze({ skipped: false, code: null, text: '' });
	const skipped = isTransferSkipReason(reason);
	const body = skipped ? reason.slice(TRANSFER_SKIPPED_REASON_PREFIX.length) : reason;
	const named = TRANSFER_REFUSAL_CODE_PATTERN.exec(body);
	return Object.freeze({
		skipped,
		code: named ? named[1] : null,
		text: (named ? body.slice(named[0].length) : body).trim(),
	});
}

/**
 * Thrown by the receiver's `acceptEntry` for an entry the import layer skipped
 * without storing it. Its message is what crosses the wire.
 */
export class TransferDeclinedError extends Error {
	constructor(code: string | null, reason: string) {
		super(encodeTransferRefusal({ skipped: true, code, text: reason }));
		this.name = 'TransferDeclinedError';
	}
}
