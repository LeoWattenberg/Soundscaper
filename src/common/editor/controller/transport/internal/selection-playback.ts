/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import type { TransportCopy, TransportEngine, TransportSelection } from './transport-service-types.ts';

/** A bounded run resumes inside its selection and otherwise starts at the left edge. */
export function bindPlaybackToTimeSelection(engine: TransportEngine, selection: TransportSelection | null) {
	const range = engine.setPlayRange?.(selection && {
		startFrame: selection.startFrame,
		endFrame: selection.endFrame,
	});
	if (!range) return null;
	const position = engine.getPositionFrames();
	if (position < range.startFrame || position >= range.endFrame) engine.seek(range.startFrame);
	return range;
}

/** Read the explicit spectral rectangle, rather than falling back to selected clips. */
export function requireSpectralPlaybackSelection(selection: TransportSelection | null | undefined, copy: TransportCopy) {
	if (!selection || !Number.isFinite(selection.startFrame) || !Number.isFinite(selection.endFrame)
		|| selection.startFrame < 0 || selection.endFrame <= selection.startFrame) throw createLocalizedError(Error, copy, 'timeSelectionRequired');
	const range = selection.frequencyRange;
	if (!range || typeof range !== 'object' || !('minimumFrequency' in range) || !('maximumFrequency' in range)
		|| typeof range.minimumFrequency !== 'number' || typeof range.maximumFrequency !== 'number'
		|| !Number.isFinite(range.minimumFrequency) || !Number.isFinite(range.maximumFrequency)
		|| range.minimumFrequency < 0 || range.maximumFrequency <= range.minimumFrequency) {
		throw createLocalizedError(Error, copy, 'spectralSelectionRequired');
	}
	return { selection, frequencyRange: { minimumFrequency: range.minimumFrequency, maximumFrequency: range.maximumFrequency } };
}

export async function playSpectralSelection(
	engine: TransportEngine,
	spectral: ReturnType<typeof requireSpectralPlaybackSelection>,
	current: () => boolean,
) {
	if (engine.getState().cutPreview) engine.stop();
	bindPlaybackToTimeSelection(engine, spectral.selection);
	engine.setPlaybackFrequencyRange(spectral.frequencyRange);
	try {
		return await engine.play();
	} catch (error) {
		if (current()) engine.setPlaybackFrequencyRange(null);
		throw error;
	}
}
