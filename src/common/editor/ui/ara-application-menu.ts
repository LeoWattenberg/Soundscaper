/* SPDX-License-Identifier: AGPL-3.0-only */

/** ARA is opt-in desktop clip editing in either product. */
export function createAraApplicationMenuItems(input: Readonly<{
	productId: string
	available: boolean
	selectedClipId?: string | null
	project: unknown
	editingBlocked: boolean
	readOnly: boolean
	copy?: Readonly<Record<string, string | undefined>>
}>, open: () => unknown) {
	if (!input.available || !['soundscaper', 'framescaper'].includes(input.productId)) return []
	const project = input.project as { clips?: readonly { id: string; kind: string }[];
		tracks?: readonly { type?: string; clipIds?: readonly string[] }[] } | null
	const selected = project?.clips?.some((clip) => clip.kind === 'audio' && clip.id === input.selectedClipId) === true
		&& project.tracks?.some((track) => track.type === 'audio' && track.clipIds?.includes(input.selectedClipId ?? '')) === true
	const disabledReason = input.editingBlocked || input.readOnly
		? input.copy?.projectReadOnly ?? 'The project cannot be edited right now.'
		: !selected ? input.copy?.['ui.ara.selectClip'] ?? 'Select an audio clip first.' : ''
	return [Object.freeze({ id: 'ara-clip-editor', label: input.copy?.['ui.ara.clipEditor'] ?? 'Edit selected clip with ARA',
		disabled: disabledReason !== '', disabledReason,
		...(disabledReason ? {} : { onClick: open }),
	})]
}
