/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type { createAudioEditorSessionController } from '../../session.js';
import type { DocumentHistory, DocumentProject } from '../document/document-composition-types.ts';
import type { FramescaperCaptureAppBindingOptions } from './framescaper-capture-app-binding.ts';
import { admitFramescaperCaptureProject } from './internal/framescaper-capture-project-admission.ts';
import { admitControllerSessionHistory } from '../document/session-history-admission.ts';

type Session = ReturnType<typeof createAudioEditorSessionController>;
type CaptureDocumentPorts = Pick<FramescaperCaptureAppBindingOptions,
	'adminInterlock' | 'projectRuntime' | 'sessionController' | 'getActiveProject' | 'getActiveHistory'
	| 'setActiveProject' | 'setActiveHistory' | 'synchronizeProject'>;

export interface FramescaperCaptureDocumentDependencies {
	readonly adminInterlock: CaptureDocumentPorts['adminInterlock'] | null;
	readonly session: Session;
	readonly runtime: Readonly<{
		validateProject?: (value: unknown) => value is DocumentProject;
		createHistory(project: unknown): DocumentHistory;
		executeCommand(history: DocumentHistory, command: AudioEditorCommand,
			options?: Readonly<{ now?: Date | string }>): DocumentHistory;
	}>;
	getProject(): DocumentProject | null;
	getHistory(): DocumentHistory | null;
	setProject(project: DocumentProject): void;
	setHistory(history: DocumentHistory): void;
	synchronizeProject(project: DocumentProject): PromiseLike<unknown> | unknown;
}

/** Keep capture's current Framescaper authority separate from the editor's other document states. */
export function createFramescaperCaptureDocumentPorts(
	dependencies: FramescaperCaptureDocumentDependencies,
): Readonly<CaptureDocumentPorts> {
	const { runtime, session, adminInterlock } = dependencies;
	if (!adminInterlock) throw new TypeError('Framescaper capture requires its administration interlock.');
	const requireProject = projectAdmission(runtime);
	const history = (value: unknown, projectId: string) => (
		admitControllerSessionHistory(value, projectId, requireProject)
	);
	return Object.freeze({
		adminInterlock,
		getActiveProject() {
			const project = dependencies.getProject();
			return isCurrentFrame(project) ? requireProject(project) : null;
		},
		getActiveHistory() {
			const value = dependencies.getHistory();
			return isCurrentFrame(value?.present) && value ? history(value, value.present.id) : null;
		},
		setActiveProject: value => dependencies.setProject(requireProject(value)),
		setActiveHistory: value => dependencies.setHistory(history(value, value.present.id)),
		async synchronizeProject(value) { await dependencies.synchronizeProject(requireProject(value)); },
		projectRuntime: {
			createHistory(value) {
				const created = runtime.createHistory(requireProject(value));
				return history(created, value.id);
			},
			executeCommand(value, command, options) {
				const next = runtime.executeCommand(history(value, value.present.id), command, options);
				return history(next, value.present.id);
			},
		},
		sessionController: {
			...session,
			captureProjectHistory(projectId) {
				const capture = session.captureProjectHistory(projectId);
				return Object.freeze({ history: history(capture.history, projectId), token: capture.token });
			},
			getProjectHistory: projectId => history(session.getProjectHistory(projectId), projectId),
		},
	});
}

/** Admit the entire background update before replacing the history authority. */
export function createFramescaperCaptureProxyDocumentInstaller(
	dependencies: Pick<FramescaperCaptureDocumentDependencies, 'runtime' | 'setHistory' | 'synchronizeProject'>,
) {
	const requireProject = projectAdmission(dependencies.runtime);
	return async (update: Readonly<{ projectId: string; project: unknown; history: unknown }>): Promise<void> => {
		const history = admitControllerSessionHistory(update.history, update.projectId, requireProject);
		if (history.present !== update.project) {
			throw new TypeError('Captured proxy publication requires one project/history identity.');
		}
		dependencies.setHistory(history);
		await dependencies.synchronizeProject(history.present);
	};
}

function projectAdmission(runtime: FramescaperCaptureDocumentDependencies['runtime']) {
	return (value: unknown) => {
		admitFramescaperCaptureProject(value);
		if (!runtime.validateProject || !runtime.validateProject(value)) {
			throw new TypeError('Framescaper capture requires an admitted current document.');
		}
		return admitFramescaperCaptureProject(value);
	};
}

function isCurrentFrame(value: DocumentProject | null | undefined): boolean {
	return value?.schemaFamily === 'framescaper' && value.schemaVersion === 1;
}
