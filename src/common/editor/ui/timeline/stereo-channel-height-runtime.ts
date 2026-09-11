/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_DEFAULT_STEREO_CHANNEL_HEIGHT_RATIO = 0.5;
export const AUDIO_EDITOR_MINIMUM_STEREO_CHANNEL_HEIGHT = 20;

interface AudioEditorStereoHeightPreferences {
	readonly asymmetricStereoHeights?: unknown;
	readonly asymmetricStereoHeightWorkspaces?: readonly unknown[];
}

export interface AudioEditorStereoChannelGeometry {
	readonly top: number;
	readonly height: number;
}

/** Whether Audacity's stereo divider is editable in the active workspace. */
export function audioEditorAsymmetricStereoHeightsAvailable(
	editing: AudioEditorStereoHeightPreferences | null | undefined,
	activeWorkspaceId: unknown,
): boolean {
	if (editing?.asymmetricStereoHeights === 'always') return true;
	if (editing?.asymmetricStereoHeights !== 'workspace-dependent'
		|| typeof activeWorkspaceId !== 'string') return false;
	return Array.isArray(editing.asymmetricStereoHeightWorkspaces)
		&& editing.asymmetricStereoHeightWorkspaces.includes(activeWorkspaceId);
}

/** Audacity fixes disabled dividers at 50/50 and shares an enabled ratio across every view. */
export function audioEditorStereoChannelHeightRatioForDisplay(
	value: unknown,
	asymmetricHeightsAvailable: boolean,
	_displayMode: unknown,
): number {
	if (!asymmetricHeightsAvailable) {
		return AUDIO_EDITOR_DEFAULT_STEREO_CHANNEL_HEIGHT_RATIO;
	}
	return normalizedRatio(value);
}

/** Locate the synchronized channel splitter inside each visible waveform/spectrogram view. */
export function audioEditorStereoChannelDividerRegions(
	bodyTop: unknown,
	bodyHeight: unknown,
	displayMode: unknown,
): readonly AudioEditorStereoChannelGeometry[] {
	const top = finiteNonNegative(bodyTop);
	const height = finiteNonNegative(bodyHeight);
	const viewCount = displayMode === 'multiview' ? 2 : 1;
	const viewHeight = height / viewCount;
	return Object.freeze(Array.from({ length: viewCount }, (_, index) => Object.freeze({
		top: top + index * viewHeight,
		height: viewHeight,
	})));
}

/** Resolve the two channel bands consumed by canvas, rulers, and hit testing. */
export function audioEditorStereoChannelGeometry(
	height: unknown,
	ratio: unknown,
): readonly [AudioEditorStereoChannelGeometry, AudioEditorStereoChannelGeometry] {
	const normalizedHeight = finiteNonNegative(height);
	const firstHeight = normalizedHeight * normalizedRatio(ratio);
	return Object.freeze([
		Object.freeze({ top: 0, height: firstHeight }),
		Object.freeze({ top: firstHeight, height: normalizedHeight - firstHeight }),
	]);
}

/** Convert a divider pointer position to Audacity's twenty-pixel-bounded ratio. */
export function audioEditorStereoChannelHeightRatioAtPointer(
	pointerY: unknown,
	bodyTop: unknown,
	bodyHeight: unknown,
): number {
	const height = finiteNonNegative(bodyHeight);
	if (height === 0) return AUDIO_EDITOR_DEFAULT_STEREO_CHANNEL_HEIGHT_RATIO;
	const minimumHeight = Math.min(height / 2, AUDIO_EDITOR_MINIMUM_STEREO_CHANNEL_HEIGHT);
	const minimumRatio = minimumHeight / height;
	const maximumRatio = 1 - minimumRatio;
	const position = finiteNumber(pointerY, 0) - finiteNumber(bodyTop, 0);
	return Math.max(minimumRatio, Math.min(maximumRatio, position / height));
}

function normalizedRatio(value: unknown): number {
	const ratio = Number(value);
	if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
		return AUDIO_EDITOR_DEFAULT_STEREO_CHANNEL_HEIGHT_RATIO;
	}
	return ratio;
}

function finiteNonNegative(value: unknown): number {
	return Math.max(0, finiteNumber(value, 0));
}

function finiteNumber(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}
