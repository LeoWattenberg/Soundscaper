import { useEffect, useRef } from 'react';
import { EffectHeader } from '@soundscaper/design-system/EffectDialog/EffectHeader';

export default function AudacityEffectHeader({ copy, automationEnabled, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		const root = wrapperRef.current;
		if (!root) return;
		const automation = root.querySelector('.effect-header__left button');
		if (automation && !props.isDestructive) {
			const label = automationEnabled
				? copy.disableEffect
				: copy.enableEffect;
			automation.setAttribute('aria-label', label);
			automation.setAttribute('title', label);
		}
		const preset = root.querySelector('.effect-header__preset .dropdown__trigger');
		preset?.setAttribute('aria-label', copy.effectPreset);
		const actionLabels = [copy.saveEffectPreset, copy.resetEffectPreset, copy.deleteEffectPreset, copy.moreOptions];
		root.querySelectorAll('.effect-header__right .effect-header__icon-button').forEach((button, index) => {
			const label = actionLabels[index];
			if (!label) return;
			button.setAttribute('aria-label', label);
			button.setAttribute('title', label);
		});
	}, [automationEnabled, copy, props.isDestructive]);
	return <div ref={wrapperRef}><EffectHeader automationEnabled={automationEnabled} {...props} /></div>;
}
