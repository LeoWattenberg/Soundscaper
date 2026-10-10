/* SPDX-License-Identifier: AGPL-3.0-only */

import { ARA_COPY_BY_LOCALE } from '../../i18n/editor-ara-copy.ts'

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
	const project = input.project as { clips?: readonly { id: string; kind: string; sourceId: string }[];
		sources?: readonly { id: string; channelCount: number }[];
		tracks?: readonly { type?: string; clipIds?: readonly string[]; locked?: boolean }[] } | null
	const clip = project?.clips?.find(clip => clip.kind === 'audio' && clip.id === input.selectedClipId)
	const track = clip && project?.tracks?.find(track => track.type === 'audio' && track.clipIds?.includes(clip.id))
	const source = clip && project?.sources?.find(source => source.id === clip.sourceId)
	const selected = Boolean(track && track.locked !== true && (source?.channelCount === 1 || source?.channelCount === 2))
	const disabledReason = input.editingBlocked || input.readOnly
		? input.copy?.projectReadOnly ?? 'The project cannot be edited right now.'
		: !selected ? input.copy?.['ui.ara.selectClip'] ?? ARA_COPY_BY_LOCALE.en.selectClip : ''
	return [Object.freeze({ id: 'ara-clip-editor', label: input.copy?.['ui.ara.clipEditor'] ?? 'Edit selected clip with ARA',
		disabled: disabledReason !== '', disabledReason,
		...(disabledReason ? {} : { onClick: open }),
	})]
}
