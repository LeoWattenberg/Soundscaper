/* SPDX-License-Identifier: AGPL-3.0-only */
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { clipInteractionCopy } from '../../../i18n/editor-clip-interactions-copy.ts';

interface Props {
	readonly clip: { readonly id: string; readonly kind: string; readonly fadeInFrames?: number; readonly fadeOutFrames?: number } | null;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly onRemove: (id: string, changes: { fadeInFrames?: number; fadeOutFrames?: number }) => void;
}

/** Both clip-menu parents expose the same two operations as the handles. */
export function ClipFadeMenuEntries({ clip, copy, disabled, onClose, onRemove }: Props) {
	const labels = clipInteractionCopy(copy);
	if (clip?.kind !== 'audio') return null;
	return <>{(['in', 'out'] as const).map(edge => {
		const field = edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames';
		return <ContextMenuItem key={edge} label={edge === 'in' ? copy.fadeIn : copy.fadeOut} disabled={disabled} hasSubmenu onClose={onClose}>
			<ContextMenuItem label={edge === 'in' ? labels.editFadeIn : labels.editFadeOut} onClick={() => {
				onClose();
				const element = [...document.querySelectorAll<HTMLElement>('[data-clip-id]')].find(item => item.dataset.clipId === clip.id);
				element?.dispatchEvent(new CustomEvent('scape-edit-fades', { bubbles: true }));
			}} />
			<ContextMenuItem label={edge === 'in' ? labels.removeFadeIn : labels.removeFadeOut} disabled={!(clip[field]! > 0)}
				onClick={() => { onClose(); onRemove(clip.id, { [field]: 0 }); }} />
		</ContextMenuItem>;
	})}</>;
}
