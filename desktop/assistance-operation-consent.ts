/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native consent copy for selection-bound media work and source-free speech. */

interface ConsentRequest {
	readonly operation: string;
	readonly selectionFence: Readonly<{
		readonly sourceStartFrame: number;
		readonly sourceEndFrame: number;
		readonly occurrenceIds: readonly string[];
	}> | null;
	readonly models: readonly Readonly<{ readonly modelId: string; readonly version: string }>[];
}

export function assistanceOperationConsentOptions(request: ConsentRequest) {
	const speech = request.operation === 'text-to-speech';
	const selection = request.selectionFence;
	if (speech !== (selection === null)) {
		throw new TypeError('The assistance consent request has an invalid selection.');
	}
	return {
		type: 'question',
		title: 'Local Assistance consent',
		message: speech ? 'Generate speech from this text locally?'
			: 'Process this exact media selection locally?',
		detail: [
			`Operation: ${request.operation}`,
			...(selection === null ? ['Input: typed text'] : [
				`Selected range: ${selection.sourceStartFrame}–${selection.sourceEndFrame} frames`,
				`Timeline items: ${selection.occurrenceIds.length}`,
			]),
			`Model: ${request.models.map(({ modelId, version }) => `${modelId} ${version}`).join(', ') || 'none'}`,
		].join('\n'),
		buttons: ['Run locally', 'Cancel'],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
	} as const;
}
