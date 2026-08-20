/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useState } from 'react';

import { trackSourceRate } from '../application-menu-model.js';

export function useTrackRateDialog(project, setDialog, setDialogValue) {
	const [dialogTrackId, setDialogTrackId] = useState(null);
	const openTrackRate = useCallback((track) => {
		setDialogTrackId(track?.id || null);
		setDialogValue(String(trackSourceRate(project, track, project?.sampleRate || 48_000)));
		setDialog('track-rate');
	}, [project, setDialog, setDialogValue]);
	return { dialogTrackId, openTrackRate };
}
