/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCapturedVideoProxyActiveUpdate,
} from '../common/editor/controller/framescaper-capture-proxy-quiescence.ts';

export interface CapturedVideoProxySessionController {
	getSnapshot(): Readonly<{
		readonly activeProjectId: string | null;
		readonly tabs: readonly Readonly<{
			readonly projectId: string;
			readonly readOnly: boolean;
			readonly history: Readonly<Record<string, unknown>>;
		}>[];
	}>;
	captureProjectHistory(projectId: string): Readonly<{ readonly token: object; readonly history: unknown }>;
	assertProjectHistoryToken(projectId: string, token: object): void;
	beginProjectActivation(projectId: string, options: Readonly<{
		readonly expectedHistoryToken: object;
		readonly exclusive: true;
	}> | Readonly<{
		readonly requireAbsent: true;
		readonly exclusive: true;
	}>): Readonly<{ readonly token: object; release(): boolean }>;
	installCommittedProjectHistory(projectId: string, history: unknown, options: Readonly<{
		readonly activationToken: object;
		readonly expectedHistoryToken: object;
		readonly readOnly: false;
		readonly dirty: false;
	}>): PromiseLike<unknown> | unknown;
}

interface CapturedVideoProxyPresentControllerTicket {
	readonly kind: 'present';
	readonly active: boolean;
	readonly alreadyInstalled: boolean;
	readonly historyToken: object;
	readonly history: Readonly<Record<string, unknown>>;
	readonly reservation: Readonly<{ readonly token: object; release(): boolean }>;
}

interface CapturedVideoProxyAbsentControllerTicket {
	readonly kind: 'absent';
	readonly active: false;
	readonly alreadyInstalled: false;
	readonly reservation: Readonly<{ readonly token: object; release(): boolean }>;
}

export type CapturedVideoProxyControllerTicket =
	| CapturedVideoProxyPresentControllerTicket
	| CapturedVideoProxyAbsentControllerTicket;

type SameProject = (left: unknown, right: unknown) => boolean;

export function captureCapturedVideoProxyControllerTicket(
	session: CapturedVideoProxySessionController,
	base: Readonly<Record<string, unknown>>,
	sameProject: SameProject,
): CapturedVideoProxyControllerTicket | null {
	return captureTicket(session, base, base, sameProject, false);
}

/**
 * Reacquire a released reservation after the durable target landed. Only the
 * exact predecessor or exact target may be reconciled, so a later user edit is
 * never overwritten by derivative retry.
 */
export function captureLandedCapturedVideoProxyControllerTicket(
	session: CapturedVideoProxySessionController,
	base: Readonly<Record<string, unknown>>,
	target: Readonly<Record<string, unknown>>,
	sameProject: SameProject,
): CapturedVideoProxyControllerTicket | null {
	return captureTicket(session, base, target, sameProject, true);
}

export async function installOrReadLandedCapturedVideoProxyProject(
	session: CapturedVideoProxySessionController,
	ticket: CapturedVideoProxyControllerTicket | null,
	target: Readonly<Record<string, unknown>>,
	sourceId: string,
	sameProject: SameProject,
): Promise<FramescaperCapturedVideoProxyActiveUpdate | null> {
	if (!ticket) return null;
	if (ticket.kind === 'absent') return null;
	const projectId = String(target.id);
	session.assertProjectHistoryToken(projectId, ticket.historyToken);
	let installedHistory: Readonly<Record<string, unknown>>;
	if (ticket.alreadyInstalled) {
		installedHistory = ticket.history;
	} else {
		const limit = Number(ticket.history.limit);
		const undoStack = Array.isArray(ticket.history.undoStack) ? ticket.history.undoStack : [];
		const installed = await session.installCommittedProjectHistory(projectId, {
			limit,
			present: target,
			undoStack: [...undoStack, {
				project: ticket.history.present,
				command: { type: 'framescaper/video-proxy-attach', sourceId },
			}].slice(-limit),
			redoStack: [],
		}, {
			activationToken: ticket.reservation.token,
			expectedHistoryToken: ticket.historyToken,
			readOnly: false,
			dirty: false,
		}) as Readonly<{ readonly history: Readonly<Record<string, unknown>> }>;
		installedHistory = installed.history;
	}
	const installedProject = installedHistory.present as Readonly<Record<string, unknown>>;
	if (!sameProject(installedProject, target)) {
		throw new Error('The captured proxy history normalized its committed project.');
	}
	return ticket.active
		? Object.freeze({ projectId, project: installedProject, history: installedHistory })
		: null;
}

function captureTicket(
	session: CapturedVideoProxySessionController,
	base: Readonly<Record<string, unknown>>,
	target: Readonly<Record<string, unknown>>,
	sameProject: SameProject,
	allowTarget: boolean,
): CapturedVideoProxyControllerTicket | null {
	const projectId = String(base.id);
	const snapshot = session.getSnapshot();
	const tab = snapshot.tabs.find((candidate) => candidate.projectId === projectId);
	if (!tab) {
		const reservation = session.beginProjectActivation(projectId, {
			requireAbsent: true,
			exclusive: true,
		});
		return Object.freeze({
			kind: 'absent' as const,
			active: false as const,
			alreadyInstalled: false as const,
			reservation,
		});
	}
	if (tab.readOnly) throw abortError('The open captured proxy origin became read-only.');
	const captured = session.captureProjectHistory(projectId);
	const history = captured.history as Readonly<Record<string, unknown>>;
	const alreadyInstalled = allowTarget && sameProject(history.present, target);
	if (!alreadyInstalled && !sameProject(history.present, base)) {
		throw abortError('The open captured proxy origin no longer matches its durable predecessor or target.');
	}
	const reservation = session.beginProjectActivation(projectId, {
		expectedHistoryToken: captured.token,
		exclusive: true,
	});
	try { session.assertProjectHistoryToken(projectId, captured.token); }
	catch (error) {
		try { reservation.release(); }
		catch (releaseError) {
			throw new AggregateError(
				[error, releaseError],
				'Captured proxy ticket validation and reservation release failed.',
				{ cause: error },
			);
		}
		throw error;
	}
	return Object.freeze({
		kind: 'present' as const,
		active: snapshot.activeProjectId === projectId,
		alreadyInstalled,
		historyToken: captured.token,
		history,
		reservation,
	});
}

function abortError(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}
