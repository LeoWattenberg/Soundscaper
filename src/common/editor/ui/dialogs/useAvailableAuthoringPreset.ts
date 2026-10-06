/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';

export function useAvailableAuthoringPreset(presets: readonly Readonly<{ id: string }>[]) {
	const [selectedId, setSelectedId] = useState(presets[0]?.id ?? '');
	useEffect(() => {
		setSelectedId((current) => presets.some(({ id }) => id === current) ? current : presets[0]?.id ?? '');
	}, [presets]);
	return [selectedId, setSelectedId] as const;
}
