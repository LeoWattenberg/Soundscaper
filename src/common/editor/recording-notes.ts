/* SPDX-License-Identifier: AGPL-3.0-only */

/** Recording notes are Markdown source, independent of exported audio comments. */
export function recordingNotesValue(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('Recording notes must be a string.');
	return value;
}

/** Projects saved before recording notes were added have an empty notebook. */
export function readProjectRecordingNotes(project: unknown): string {
	if (!isRecord(project) || !isRecord(project.metadata)) return '';
	return typeof project.metadata.recordingNotes === 'string' ? project.metadata.recordingNotes : '';
}

export function setProjectRecordingNotes(
	project: object,
	command: Readonly<{ notes: unknown }>,
): void {
	const notes = recordingNotesValue(command.notes);
	if (!isRecord(project) || !isRecord(project.metadata)) throw new TypeError('Project metadata is required for recording notes.');
	project.metadata = { ...project.metadata, recordingNotes: notes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
