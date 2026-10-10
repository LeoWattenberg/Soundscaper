/* SPDX-License-Identifier: AGPL-3.0-only */

import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { isEffectMacroStepType } from '../../effect-macro-steps.ts';

interface StackEffect { readonly type: string; readonly enabled: boolean }
interface Props {
	readonly isOpen: boolean;
	readonly x: number;
	readonly y: number;
	readonly copy: Readonly<Record<string, string>>;
	readonly effects: readonly StackEffect[];
	readonly blocked: boolean;
	readonly hasClipboard: boolean;
	onClose(): void;
	onCopy(): void;
	onPaste(): void | Promise<unknown>;
	onExport(): void | Promise<unknown>;
}

/** Hosted instances have no portable duplication or macro representation. */
export default function EffectStackMenu({
	isOpen, x, y, copy, effects, blocked, hasClipboard, onClose, onCopy, onPaste, onExport,
}: Props) {
	const copyAvailable = effects.every(effect => effect.type !== 'native-plugin');
	const macroEffects = effects.filter(effect => effect.enabled && effect.type !== 'missing');
	const macroAvailable = macroEffects.length > 0 && macroEffects.every(effect => isEffectMacroStepType(effect.type));
	return <ContextMenu isOpen={isOpen} x={x} y={y} onClose={onClose} className="audio-editor-effect-stack-menu">
		<ContextMenuItem label={copy.copyEffects} disabled={!copyAvailable} onClick={onCopy} />
		<ContextMenuItem label={copy.pasteEffects} disabled={blocked || !hasClipboard} onClick={() => { void onPaste(); }} />
		<ContextMenuItem isDivider />
		<ContextMenuItem label={copy.exportAsMacro} disabled={!macroAvailable} onClick={() => { void onExport(); }} />
	</ContextMenu>;
}
