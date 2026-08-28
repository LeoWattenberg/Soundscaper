/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCapturedVideoProxyProject,
} from './editor-captured-video-proxy-preservation.ts';
import {
	FramescaperDesktopProjectLibraryCommittedError,
	FramescaperDesktopProjectLibraryIndeterminateError,
} from './desktop-project-library-errors.ts';

interface CapturedVideoProxyDesktopPublicationOptions {
	readonly base: FramescaperCapturedVideoProxyProject;
	readonly target: FramescaperCapturedVideoProxyProject;
	readonly publishProject: (
		project: unknown,
		signal?: AbortSignal,
		beforeFinish?: () => PromiseLike<void> | void,
	) => Promise<unknown>;
	readonly beforeFinish?: () => PromiseLike<void> | void;
	readonly loadAuthoritativeProject: (signal?: AbortSignal) => Promise<unknown>;
	readonly cloneProject: (project: unknown) => FramescaperCapturedVideoProxyProject;
	readonly fingerprint: (project: unknown) => string;
	readonly signal?: AbortSignal;
}

/** Main durably owns target, but its renderer shadow could not yet reconcile it. */
export class CapturedVideoProxyDesktopCommittedReconciliationError extends Error {
	readonly target: FramescaperCapturedVideoProxyProject;

	constructor(target: FramescaperCapturedVideoProxyProject, cause: unknown) {
		super('Desktop captured proxy publication committed and requires renderer reconciliation.', { cause });
		this.name = 'CapturedVideoProxyDesktopCommittedReconciliationError';
		this.target = target;
	}
}

/** Main may own target, so exact predecessor/target evidence must survive reread failure. */
export class CapturedVideoProxyDesktopIndeterminateReconciliationError extends Error {
	readonly base: FramescaperCapturedVideoProxyProject;
	readonly target: FramescaperCapturedVideoProxyProject;

	constructor(
		base: FramescaperCapturedVideoProxyProject,
		target: FramescaperCapturedVideoProxyProject,
		cause: unknown,
	) {
		super('Desktop captured proxy publication outcome requires authoritative reconciliation.', { cause });
		this.name = 'CapturedVideoProxyDesktopIndeterminateReconciliationError';
		this.base = base;
		this.target = target;
	}
}

/**
 * Publish main first while the renderer shadow remains the exact predecessor.
 * The admitted renderer uploads already claim-rooted bodies, commits main by
 * its private witness, and only then reconciles the shadow. A crash therefore
 * leaves either base/base or base-or-target/target, both restart-reconcilable;
 * it can never expose an unowned target only in the renderer database.
 */
export async function publishCapturedVideoProxyDesktopMainFirst(
	options: CapturedVideoProxyDesktopPublicationOptions,
): Promise<FramescaperCapturedVideoProxyProject> {
	try {
		throwIfAborted(options.signal);
		const authoritative = options.cloneProject(
			await options.publishProject(options.target, options.signal, options.beforeFinish),
		);
		if (options.fingerprint(authoritative) !== options.fingerprint(options.target)) {
			throw new Error('Desktop captured proxy publication changed its exact committed project.');
		}
		return authoritative;
	} catch (primary) {
		let authoritative: FramescaperCapturedVideoProxyProject;
		try {
			// Main may have committed immediately before cancellation became visible.
			authoritative = options.cloneProject(await options.loadAuthoritativeProject());
		} catch (reconcileError) {
			if (primary instanceof FramescaperDesktopProjectLibraryCommittedError
				&& primary.operation === 'publication') {
				throw new CapturedVideoProxyDesktopCommittedReconciliationError(
					options.target,
					new AggregateError(
						[primary, reconcileError],
						'Desktop captured proxy renderer reconciliation is pending.',
						{ cause: primary },
					),
				);
			}
			if (primary instanceof FramescaperDesktopProjectLibraryIndeterminateError
				&& primary.operation === 'publication') {
				throw new CapturedVideoProxyDesktopIndeterminateReconciliationError(
					options.base,
					options.target,
					new AggregateError(
						[primary, reconcileError],
						'Desktop captured proxy publication outcome remains indeterminate.',
						{ cause: primary },
					),
				);
			}
			throw new AggregateError(
				[primary, reconcileError],
				'Desktop captured proxy publication outcome is indeterminate.',
				{ cause: primary },
			);
		}
		if (options.fingerprint(authoritative) === options.fingerprint(options.target)) {
			return authoritative;
		}
		if (primary instanceof FramescaperDesktopProjectLibraryCommittedError
			&& primary.operation === 'publication') {
			throw new CapturedVideoProxyDesktopCommittedReconciliationError(
				options.target,
				new AggregateError(
					[primary, abortError('Desktop captured proxy shadow did not expose its committed target.')],
					'Desktop captured proxy renderer reconciliation is pending.',
					{ cause: primary },
				),
			);
		}
		if (options.fingerprint(authoritative) === options.fingerprint(options.base)) throw primary;
		throw new AggregateError(
			[primary, abortError('Desktop captured proxy authority moved to an unrelated generation.')],
			'Desktop captured proxy publication is indeterminate.',
			{ cause: primary },
		);
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw abortError('Desktop captured proxy publication was cancelled.');
}

function abortError(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}
