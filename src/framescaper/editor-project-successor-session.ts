/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAudioEditorSessionController } from '../common/editor/session.js';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { normalizeFramescaperSuccessorHistory, type FramescaperSuccessorHistory } from './editor-project-successor-history.ts';
import { framescaperSuccessorOpaqueProject, framescaperSuccessorOpaqueHistory, type FramescaperSuccessorOpaqueHistory } from './editor-project-successor-opaque.ts';
type Delegate = ReturnType<typeof createAudioEditorSessionController>;
export type FramescaperSuccessorSession = Omit<Delegate, 'captureProjectHistory' | 'getProjectHistory'> & Readonly<{
	captureProjectHistory(projectId: string): Readonly<{ history: FramescaperSuccessorHistory | FramescaperSuccessorOpaqueHistory; token: object }>;
	getProjectHistory(projectId: string): FramescaperSuccessorHistory | FramescaperSuccessorOpaqueHistory;
}>;
export interface FramescaperSuccessorPublicationFence {
	acceptHistory(history: FramescaperSuccessorHistory): void;
	release(): void;
}
/** The fence protects all product mutations while an asynchronous owner/link transaction is publishing. */
export function createFramescaperSuccessorSessionAuthority(retainHistory: (history: FramescaperSuccessorHistory) => FramescaperSuccessorHistory = (history) => history) {
	let active: object | null = null; const sessions = new WeakMap<FramescaperSuccessorSession, Delegate>();
	const assertEditable = () => { if (active) throw new Error('Wait for the current successor publication to finish.'); };
	return Object.freeze({ assertEditable, createSessionController, beginPublication });
	function createSessionController(): FramescaperSuccessorSession {
		const delegate = createAudioEditorSessionController({ currentSchemaVersion: 2 });
		const history = (value: unknown) => {
			if (!value || typeof value !== 'object') throw new TypeError('A successor session history is required.');
			const present: unknown = Reflect.get(value, 'present');
			return framescaperSuccessorOpaqueHistory(present) ?? retainHistory(normalizeFramescaperSuccessorHistory(value));
		};
		const session = Object.freeze({ ...delegate,
			openProject(value: unknown, options: Record<string, unknown> = {}) {
				assertEditable(); const opaque = framescaperSuccessorOpaqueProject(value);
				if (opaque) return delegate.openProject(opaque, { ...options, history: framescaperSuccessorOpaqueHistory(opaque), readOnly: true, readOnlyReason: 'opaque-project' });
				const project = normalizeFramescaperSuccessorProject(value);
				return delegate.openProject(project, { ...options, ...(options.history ? { history: normalizeFramescaperSuccessorHistory(options.history) } : {}) });
			},
			updateProject(projectId: string, update: unknown, options: Record<string, unknown> = {}) {
				assertEditable(); return delegate.updateProject(projectId, (previous: unknown) => normalizeFramescaperSuccessorProject(typeof update === 'function' ? (update as (value: unknown) => unknown)(previous) : update), options);
			},
			updateProjectHistory(projectId: string, history: unknown, options: Record<string, unknown> = {}) { assertEditable(); return delegate.updateProjectHistory(projectId, normalizeFramescaperSuccessorHistory(history), options); },
			captureProjectHistory(projectId: string) { const capture = delegate.captureProjectHistory(projectId) as { history: unknown; token: object }; return Object.freeze({ history: history(capture.history), token: capture.token }); },
			getProjectHistory(projectId: string) { return history(delegate.getProjectHistory(projectId)); },
		});
		sessions.set(session, delegate); return session;
	}
	function beginPublication(session: FramescaperSuccessorSession, projectId: string, historyToken: unknown): FramescaperSuccessorPublicationFence {
		assertEditable(); const delegate = sessions.get(session); if (!delegate) throw new TypeError('The successor publication requires its own session.');
		const reservation = delegate.beginProjectActivation(projectId, { expectedHistoryToken: historyToken, exclusive: true });
		const token = Object.freeze({}); active = token;
		return Object.freeze({
			acceptHistory(value: FramescaperSuccessorHistory) {
				if (active !== token) throw new Error('Successor publication fence is stale.');
				delegate.assertProjectHistoryToken(projectId, historyToken); const history = normalizeFramescaperSuccessorHistory(value);
				if (history.present.id !== projectId) throw new RangeError('Successor publication changed project identity.');
				delegate.installCommittedProjectHistory(projectId, history, { activationToken: reservation.token, expectedHistoryToken: historyToken, readOnly: false, dirty: false });
			},
			release() { if (active === token) { reservation.release(); active = null; } },
		});
	}
}
