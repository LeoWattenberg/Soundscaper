/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureProxySaveLease } from '../common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import {
	cleanupCapturedVideoProxyClaims,
	type CapturedVideoProxyClaimCleanup,
} from './editor-captured-video-proxy-claim-cleanup.ts';
import {
	assertCapturedVideoProxyProjectCurrent,
	captureCapturedVideoProxyLandedControllerTicket,
} from './editor-captured-video-proxy-controller-fence.ts';
import type { LandedCapturedVideoProxy } from './editor-captured-video-proxy-landed-reconciliation.ts';
import type { FramescaperCapturedVideoProxyProject } from './editor-captured-video-proxy-preservation.ts';
import type {
	CapturedVideoProxyControllerTicket,
	CapturedVideoProxySessionController,
} from './editor-captured-video-proxy-session-reconciliation.ts';

const NO_FAILURE = Symbol('no indeterminate proxy reconciliation failure');

/** Settle a proved predecessor without ever deleting may-be-main-owned bodies before that proof. */
export async function settleIndeterminateCapturedVideoProxyPredecessor(options: Readonly<{
	readonly pending: LandedCapturedVideoProxy;
	readonly current: FramescaperCapturedVideoProxyProject;
	readonly projectId: string;
	readonly session: CapturedVideoProxySessionController;
	readonly claimCleanup: CapturedVideoProxyClaimCleanup;
	readonly quiesceProjectSaves: ((
		projectId: string,
		signal?: AbortSignal,
	) => PromiseLike<FramescaperCaptureProxySaveLease> | FramescaperCaptureProxySaveLease) | null;
	readonly loadCurrent: (signal: AbortSignal) => PromiseLike<unknown> | unknown;
	readonly cloneProject: (project: unknown) => FramescaperCapturedVideoProxyProject;
	readonly fingerprint: (project: unknown) => string;
	readonly signal: AbortSignal;
}>): Promise<void> {
	if (options.fingerprint(options.current) !== options.fingerprint(options.pending.base)) {
		throw abortError('The indeterminate captured proxy authority moved beyond its predecessor.');
	}
	let saveLease: FramescaperCaptureProxySaveLease | null = null;
	let ticket: CapturedVideoProxyControllerTicket | null = null;
	let primary: unknown | typeof NO_FAILURE = NO_FAILURE;
	try {
		if (options.quiesceProjectSaves) {
			saveLease = await options.quiesceProjectSaves(options.projectId, options.signal);
		}
		await assertCapturedVideoProxyProjectCurrent({
			expected: options.pending.base,
			loadCurrent: options.loadCurrent,
			cloneProject: options.cloneProject,
			fingerprint: options.fingerprint,
			changedMessage: 'The indeterminate captured proxy predecessor changed during cleanup.',
			signal: options.signal,
		});
		ticket = captureCapturedVideoProxyLandedControllerTicket(
			options.session, options.pending.base, options.pending.target, options.fingerprint,
		);
		if (ticket?.kind === 'present' && ticket.alreadyInstalled) {
			throw abortError('The session owns an indeterminate proxy target absent from durable authority.');
		}
		const cleanupErrors = await cleanupCapturedVideoProxyClaims(
			options.claimCleanup, options.pending.cleanupOperation, options.session.getSnapshot(),
		);
		if (cleanupErrors.length) {
			throw new AggregateError(cleanupErrors, 'Indeterminate captured proxy cleanup failed.');
		}
	} catch (error) {
		primary = error;
		throw error;
	} finally {
		const failures: unknown[] = [];
		try { ticket?.reservation.release(); } catch (error) { failures.push(error); }
		try { saveLease?.release(); } catch (error) { failures.push(error); }
		if (failures.length && primary !== NO_FAILURE) {
			throw new AggregateError(
				[primary, ...failures], 'Indeterminate proxy settlement and finalization failed.', { cause: primary },
			);
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Indeterminate proxy finalization failed.');
	}
}

function abortError(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}
