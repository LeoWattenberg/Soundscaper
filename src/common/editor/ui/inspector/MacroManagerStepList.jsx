/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, useState } from 'react';
import { EffectSlot } from '@soundscaper/design-system/EffectsPanel/EffectSlot';
import { Icon } from '@soundscaper/design-system/Icon';
import { useContainerTabGroup } from '@soundscaper/design-system/hooks/useContainerTabGroup';
import EffectPicker from './EffectPicker.jsx';
import { isMacroCommandStep } from '../../macro-command-steps.ts';
import { safeEffectLabel } from './effect-helpers.ts';

/**
 * The steps of the selected macro, in the order they run.
 *
 * "Add effect" sits after the last step rather than in a footer, so the list
 * reads as the chain it is and grows where the eye already is. It opens the
 * same flyout the realtime effect rack uses, over every effect a macro step
 * can hold rather than the rack's own shorter list; swapping an existing step
 * keeps the dialog picker, which stays anchored to the step it replaces.
 */
export default function MacroManagerStepList({
	copy,
	effects,
	effectTypes,
	replaceEffectOptions,
	onAddEffect,
	onChangeEffect,
	onRemoveEffect,
	onReorderEffect,
	onReplaceEffect,
	onSelectEffect,
}) {
	const [picker, setPicker] = useState(null);
	const [draggedIndex, setDraggedIndex] = useState(null);
	const stackRef = useRef(null);
	const stepTabGroup = useContainerTabGroup({
		containerRef: stackRef,
		groupId: 'effects-panel',
		selector: '.effect-slot',
		ariaLabel: copy.macroManager,
		startTabIndex: 0,
	});
	const initTabIndices = stepTabGroup.initTabIndices;

	useLayoutEffect(() => {
		if (!picker) initTabIndices();
	}, [effects, initTabIndices, picker]);

	const choose = (type) => {
		if (picker?.replaceId) onChangeEffect(picker.replaceId, type);
		else onAddEffect(type);
		setPicker(null);
	};

	return (
		<>
			<div className="audio-editor-macro-manager__steps" data-macro-steps>
				<div
					ref={stackRef}
					className="audio-editor-macro-manager__stack"
					{...stepTabGroup.containerProps}
					aria-label={copy.macroManager}
					onKeyDown={stepTabGroup.onKeyDown}
					onBlur={stepTabGroup.onBlur}
					onFocus={stepTabGroup.onFocus}
					onClickCapture={stepTabGroup.onClickCapture}
					data-macro-effect-stack
				>
					{effects.map((effect, index) => (
						<EffectSlot
							key={effect.id}
							className="audio-editor-macro-manager__effect"
							effectName={stepLabel(effect, copy)}
							enabled
							isDragging={draggedIndex === index}
							onSelectEffect={() => onSelectEffect(effect.id)}
							onRemoveEffect={() => onRemoveEffect(effect.id)}
							{...(isMacroCommandStep(effect) ? {} : {
								onReplaceEffect: (candidate) => onReplaceEffect(effect.id, candidate),
								replaceEffectOptions,
								onChangeEffect: () => setPicker({ replaceId: effect.id, anchor: null }),
							})}
							onDragStart={(event) => {
								setDraggedIndex(index);
								event.dataTransfer.effectAllowed = 'move';
							}}
							onDragOver={(event) => {
								event.preventDefault();
								if (draggedIndex === null || draggedIndex === index) return;
								onReorderEffect(draggedIndex, index);
								setDraggedIndex(index);
							}}
							onDragEnd={() => setDraggedIndex(null)}
							onReorder={(direction) => onReorderEffect(index, index + direction)}
						/>
					))}
				</div>
				{!effects.length && <p className="audio-editor-panel-hint" data-macro-empty>{copy.macroEmptyHint}</p>}
				<button
					type="button"
					className="audio-editor-macro-manager__add-effect"
					data-macro-add-effect
					onClick={(event) => setPicker({ replaceId: null, anchor: event.currentTarget })}
				>
					<Icon name="plus" size={14} />
					<span>{copy.addEffect}</span>
				</button>
			</div>

			{picker && (
				<EffectPicker
					copy={copy}
					disabled={false}
					effectTypes={effectTypes}
					flyout={!picker.replaceId}
					anchor={picker.anchor}
					onClose={() => setPicker(null)}
					onChoose={choose}
				/>
			)}
		</>
	);
}

/**
 * What a step is called in the list.
 *
 * A command step is named by the command it runs and the parameters it carries,
 * because those are the whole step — there is no effect behind it to look a
 * label up from, and a blank row would say nothing at all.
 */
function stepLabel(step, copy) {
	if (!isMacroCommandStep(step)) return safeEffectLabel(step, copy);
	const params = Object.entries(step.params)
		.map(([name, value]) => `${name} ${String(value)}`)
		.join(', ');
	return params ? `${step.command}: ${params}` : step.command;
}
