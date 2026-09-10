/* SPDX-License-Identifier: AGPL-3.0-only */

interface NativeProjectAdmissionRuntime {
	loadProject(value: unknown): Readonly<{ project: unknown; readOnly: boolean; intrinsicReadOnly?: boolean }>;
	createHistory(project: unknown): Readonly<{ present: unknown }>;
}

/** Decoded native audio must have an editable document before PCM can be published. */
export function loadNativeEditableProject<Runtime extends NativeProjectAdmissionRuntime>(
	runtime: Runtime, value: unknown,
): { project: ReturnType<Runtime['createHistory']>['present'] };
export function loadNativeEditableProject(runtime: NativeProjectAdmissionRuntime, value: unknown) {
	const loaded = runtime.loadProject(value);
	if (loaded.readOnly || loaded.intrinsicReadOnly) {
		throw new TypeError('Decoded native audio requires a current editable project.');
	}
	return { project: runtime.createHistory(loaded.project).present };
}
