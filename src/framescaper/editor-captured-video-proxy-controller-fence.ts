/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	captureCapturedVideoProxyControllerTicket,
	captureLandedCapturedVideoProxyControllerTicket,
	type CapturedVideoProxyControllerTicket,
	type CapturedVideoProxySessionController,
} from './editor-captured-video-proxy-session-reconciliation.ts';
import type {
	FramescaperCapturedVideoProxyProject,
} from './editor-captured-video-proxy-preservation.ts';

type Fingerprint = (project: unknown) => string;

interface CapturedVideoProxyCurrentAssertionOptions {
	readonly expected: FramescaperCapturedVideoProxyProject;
	readonly loadCurrent: (signal: AbortSignal) => PromiseLike<unknown> | unknown;
	readonly cloneProject: (project: unknown) => FramescaperCapturedVideoProxyProject;
	readonly fingerprint: Fingerprint;
	readonly changedMessage: string;
	readonly signal: AbortSignal;
}

interface CapturedVideoProxyFinalTicketOptions extends CapturedVideoProxyCurrentAssertionOptions {
	readonly session: CapturedVideoProxySessionController;
	assertAdoptionCurrent(): void;
}

export async function assertCapturedVideoProxyProjectCurrent(
	options: CapturedVideoProxyCurrentAssertionOptions,
): Promise<void> {
	throwIfAborted(options.signal);
	const current = options.cloneProject(await options.loadCurrent(options.signal));
	if (options.fingerprint(current) !== options.fingerprint(options.expected)) {
		throw abortError(options.changedMessage);
	}
	throwIfAborted(options.signal);
}

/** Capture one exact present/absent session reservation, then revalidate CAS authority under it. */
export async function captureCapturedVideoProxyFinalControllerTicket(
	options: CapturedVideoProxyFinalTicketOptions,
): Promise<CapturedVideoProxyControllerTicket | null> {
	const ticket = captureCapturedVideoProxyControllerTicket(
		options.session,
		options.expected,
		(left, right) => options.fingerprint(left) === options.fingerprint(right),
	);
	try {
		await assertCapturedVideoProxyProjectCurrent(options);
		options.assertAdoptionCurrent();
		return ticket;
	} catch (error) {
		try { ticket?.reservation.release(); }
		catch (releaseError) {
			throw new AggregateError(
				[error, releaseError],
				'Captured proxy final ticket validation and release failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function captureCapturedVideoProxyLandedControllerTicket(
	session: CapturedVideoProxySessionController,
	base: FramescaperCapturedVideoProxyProject,
	target: FramescaperCapturedVideoProxyProject,
	fingerprint: Fingerprint,
): CapturedVideoProxyControllerTicket | null {
	return captureLandedCapturedVideoProxyControllerTicket(
		session,
		base,
		target,
		(left, right) => fingerprint(left) === fingerprint(right),
	);
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw abortError('Captured video proxy finalization was cancelled.');
}

function abortError(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}
