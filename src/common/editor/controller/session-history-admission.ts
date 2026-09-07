/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ControllerRuntimeHistory, ControllerRuntimeProject } from './project-runtime.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type AdmittedHistory<Project extends ControllerRuntimeProject> = ControllerRuntimeHistory<Project>
	& Readonly<{ limit: number }>;

interface SessionHistoryCapturePort {
	captureProjectHistory(projectId: string): Readonly<{ history: unknown; token: object }>;
}

/** Admit detached session captures through the selected document owner before activation. */
export function bindSessionHistoryAdmission<
	Session extends SessionHistoryCapturePort,
	Project extends ControllerRuntimeProject,
>(session: Session, admitProject: (value: unknown) => Project) {
	const { captureProjectHistory, ...methods } = session;
	return Object.freeze({
		...methods,
		captureProjectHistory(projectId: string): Readonly<{ history: AdmittedHistory<Project>; token: object }> {
			const capture = captureProjectHistory.call(session, projectId);
			const history = admitHistory(capture.history, projectId, admitProject);
			return Object.freeze({ history, token: capture.token });
		},
	});
}

function admitHistory<Project extends ControllerRuntimeProject>(
	value: unknown,
	projectId: string,
	admitProject: (value: unknown) => Project,
): AdmittedHistory<Project> {
	const history = dataRecord(value, 'Session history');
	const limit = history.limit;
	if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) {
		throw new TypeError('Session history requires a positive safe integer limit.');
	}
	const present = admitProject(history.present);
	if (present.id !== projectId) throw new RangeError('Session history belongs to another project.');
	const entries = (value: unknown) => {
		if (!Array.isArray(value)) throw new TypeError('Session history stacks must be arrays.');
		return value.map((value: unknown) => {
			const entry = dataRecord(value, 'Session history entry');
			const project = admitProject(entry.project);
			if (project.id !== projectId) throw new RangeError('Session history entry belongs to another project.');
			if (project.schemaVersion !== present.schemaVersion || project.schemaFamily !== present.schemaFamily) {
				throw new RangeError('Session history entry has a different document generation.');
			}
			return { ...entry, project };
		});
	};
	const playheadFrame = history.playheadFrame;
	if (playheadFrame !== undefined && (typeof playheadFrame !== 'number'
		|| !Number.isSafeInteger(playheadFrame) || playheadFrame < 0)) {
		throw new TypeError('Session history playhead must be a non-negative safe integer.');
	}
	return {
		...history, limit, present,
		undoStack: entries(history.undoStack), redoStack: entries(history.redoStack),
		...(playheadFrame === undefined ? {} : { playheadFrame }),
	};
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is required.`);
	const result: Record<string, unknown> = {};
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (!('value' in descriptor)) throw new TypeError(`${name} must contain data properties.`);
		Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
	}
	return result;
}
