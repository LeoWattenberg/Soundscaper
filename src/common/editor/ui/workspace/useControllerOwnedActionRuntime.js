/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useRef } from 'react';
import { createAudacityActionRuntime } from '../../audacity-action-runtime.js';
import { focusedOrSelectedTimelineLabel } from '../timeline/label-inline-edit.ts';
import { prepareTimelineTrackRemovalFocus } from '../timeline/track-removal-focus.ts';

/** A presentation preview must retain the action runtime which owns controller cleanup. */
export function useControllerOwnedActionRuntime(controller, productId, locale) {
	const route = useRef({ controller, locale });
	if (route.current.controller !== controller) route.current = { controller, locale };
	const routeLocale = route.current.locale;
	return useMemo(() => createAudacityActionRuntime(controller, {
		productId,
		locale: routeLocale,
		getFocusedLabel: () => focusedOrSelectedTimelineLabel(document, controller.getSnapshot().selectedTrackId),
		prepareTrackRemovalFocus: () => prepareTimelineTrackRemovalFocus(document, controller.actions.timeline.selectTrack),
	}), [controller, productId, routeLocale]);
}
