/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperCaptureAppBinding } from
	'../common/editor/controller/framescaper-capture-app-binding.ts';
import { createFramescaperCaptureDerivativeScheduler } from
	'../common/editor/controller/framescaper-capture-derivative-scheduler.ts';

/**
 * The capture implementation the deferred runtime loads.
 *
 * Only the two members that carry the capture stack live here: the app binding,
 * which composes the session, recorders, durable storage and Web VCR, and the
 * derivative scheduler behind it. Everything the editor composes synchronously
 * stays in `editor-capture-runtime.ts` and is never behind this import.
 */
export const FRAMESCAPER_EDITOR_CAPTURE_IMPLEMENTATION = Object.freeze({
	createAppBinding: createFramescaperCaptureAppBinding,
	createDerivativeScheduler: createFramescaperCaptureDerivativeScheduler,
});

export type FramescaperEditorCaptureImplementation = typeof FRAMESCAPER_EDITOR_CAPTURE_IMPLEMENTATION;
