/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';

/** Extra processing options supported by Soundscaper but absent from the Qt view. */
export function audacityAdvancedParameters(effectType: string): readonly string[] {
	switch (effectType) {
	case 'noise-gate': return ['lookahead'];
	case 'multi-tap-delay': return ['mix'];
	case 'vocoder': return ['outputGain'];
	case 'audacity-filter-curve-eq': return ['filterLength'];
	case 'audacity-graphic-eq': return ['interpolation', 'filterLength'];
	case 'audacity-change-pitch':
	case 'audacity-sliding-stretch': return ['preserveFormants'];
	default: return [];
	}
}

/** Both effect surfaces use the preset options menu to opt into extra controls. */
export function useAudacityEffectOptions(effectType: string, subject: string) {
	const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
	const available = audacityAdvancedParameters(effectType).length > 0;
	return {
		advancedSettings: available && expandedSubject === subject,
		onAdvancedSettings: available ? () => setExpandedSubject(current => current === subject ? null : subject) : null,
	};
}
