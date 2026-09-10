/* SPDX-License-Identifier: AGPL-3.0-only */

function inputId(value: unknown): string | null {
	if (typeof value !== 'object' || value === null) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'id');
	return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
		&& descriptor.value.length > 0 ? descriptor.value : null;
}

export function isActiveProjectSwitchInput(value: unknown, readyId: string | null, activeId: string | undefined): boolean {
	const id = inputId(value);
	return id !== null && id === readyId && id === activeId;
}

/** Only the history owner admits a stored document into the active project shape. */
export function prepareProjectSwitchHistory<
	Input,
	History extends { present: { id: string } },
	Capture extends { history: History },
>(
	input: Input,
	history: History | undefined,
	createHistory: (input: Input) => History,
	captureHistory: (id: string) => Capture | null,
) {
	const requestedId = inputId(input);
	const existingCapture = requestedId === null ? null : captureHistory(requestedId);
	const activationHistory = existingCapture?.history ?? (history ? structuredClone(history) : createHistory(input));
	const activationProject: History['present'] = activationHistory.present;
	const projectId = activationProject.id;
	if (requestedId !== null && projectId !== requestedId) {
		throw new RangeError('Project activation history must belong to the requested project.');
	}
	return { projectId, existingCapture, activationHistory, activationProject };
}
