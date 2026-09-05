/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCapturedVideoProxyActiveUpdate,
} from '../common/editor/controller/framescaper-capture-proxy-quiescence.ts';
import {
	cleanupCapturedVideoProxyClaims,
	type CapturedVideoProxyClaimCleanup,
	type CapturedVideoProxyCleanupOperation,
} from './editor-captured-video-proxy-claim-cleanup.ts';
import type {
	FramescaperCapturedVideoProxyProject,
} from './editor-captured-video-proxy-preservation.ts';
import {
	captureLandedCapturedVideoProxyControllerTicket,
	installOrReadLandedCapturedVideoProxyProject,
	type CapturedVideoProxyControllerTicket,
	type CapturedVideoProxySessionController,
} from './editor-captured-video-proxy-session-reconciliation.ts';

export interface LandedCapturedVideoProxy {
	readonly outcome: 'committed' | 'indeterminate';
	readonly base: FramescaperCapturedVideoProxyProject;
	readonly target: FramescaperCapturedVideoProxyProject;
	readonly cleanupOperation: CapturedVideoProxyCleanupOperation | null;
}

export async function reconcileLandedCapturedVideoProxyProject(
	dependencies: Readonly<{
		readonly session: CapturedVideoProxySessionController;
		readonly claimCleanup: CapturedVideoProxyClaimCleanup;
		readonly synchronizeActiveProject: ((
			update: FramescaperCapturedVideoProxyActiveUpdate,
		) => PromiseLike<unknown> | unknown) | null;
		readonly sameProject: (left: unknown, right: unknown) => boolean;
	}>,
	reconciliation: LandedCapturedVideoProxy,
	sourceId: string,
	signal: AbortSignal,
	controllerTicket?: CapturedVideoProxyControllerTicket | null,
): Promise<void> {
	throwIfAborted(signal);
	const cleanupErrors = await cleanupCapturedVideoProxyClaims(
		dependencies.claimCleanup,
		reconciliation.cleanupOperation,
		dependencies.session.getSnapshot(),
	);
	if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Captured proxy cleanup failed.');
	throwIfAborted(signal);
	const ownsTicket = controllerTicket === undefined;
	let ticket: CapturedVideoProxyControllerTicket | null = controllerTicket ?? null;
	let primaryFailure: unknown = null;
	try {
		if (ownsTicket) {
			ticket = captureLandedCapturedVideoProxyControllerTicket(
				dependencies.session,
				reconciliation.base,
				reconciliation.target,
				dependencies.sameProject,
			);
		}
		throwIfAborted(signal);
		const activeUpdate = await installOrReadLandedCapturedVideoProxyProject(
			dependencies.session,
			ticket,
			reconciliation.target,
			sourceId,
			dependencies.sameProject,
		);
		throwIfAborted(signal);
		if (activeUpdate && dependencies.synchronizeActiveProject) {
			await dependencies.synchronizeActiveProject(activeUpdate);
			throwIfAborted(signal);
		}
	} catch (error) {
		primaryFailure = error;
		throw error;
	} finally {
		try { if (ownsTicket) ticket?.reservation.release(); }
		catch (releaseError) {
			if (primaryFailure !== null) {
				throw new AggregateError(
					[primaryFailure, releaseError],
					'Captured proxy reconciliation and reservation release failed.',
					{ cause: primaryFailure },
				);
			}
			throw releaseError;
		}
	}
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Captured video proxy reconciliation was cancelled.', 'AbortError');
}
