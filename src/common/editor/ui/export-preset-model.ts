/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DELIVERY_PRESET_SETTINGS,
	type DeliveryPreset,
	type DeliveryPresetKind,
} from '../delivery-preset.ts';
import {
	videoExportPlanFormat,
	videoExportRequestFormat,
} from '../video-export-request-format.ts';
import { DEFAULT_VIDEO_DELIVERY_QUALITY } from '../video-delivery-quality.ts';
import { DEFAULT_VIDEO_DELIVERY_AUDIO_LAYOUT } from '../video-delivery-audio-layout.ts';
import {
	findPlatformDeliveryPreset,
	resolvePlatformDeliveryAvailability,
	resolvePlatformDeliveryPlanOptions,
} from '../platform-delivery-presets.ts';

/**
 * Translation between the export dialog's flat string settings and the typed
 * preset record.
 *
 * The dialog holds every control as a string because that is what the inputs
 * produce; a preset holds real values. Keeping the conversion here means the
 * dialog never hand-rolls it per control and a preset never carries a stray
 * dialog-only field such as the metadata editors' state.
 */

export const PRESET_SETTING_KEYS: Readonly<Record<DeliveryPresetKind, readonly string[]>> = Object.freeze({
	audio: Object.freeze([
		'sampleRate', 'channelMapping', 'sampleFormat', 'dither',
		'bitRate', 'quality', 'compressionLevel', 'mode', 'includeTail',
		'loudnessNormalization',
	]),
	// The video canvas is nested rather than flat, so it is translated below
	// rather than copied across; nothing else in the dialog is a video setting.
	video: Object.freeze([]),
});

/**
 * A key the dialog exports that a preset cannot hold makes saving throw at the
 * moment the user presses save, which is exactly what a video preset used to do
 * with `includeTail`. Checking the two lists against each other here turns that
 * into a startup failure the tests catch instead.
 */
for (const kind of Object.keys(PRESET_SETTING_KEYS) as DeliveryPresetKind[]) {
	for (const key of PRESET_SETTING_KEYS[kind]) {
		if (!DELIVERY_PRESET_SETTINGS[kind].includes(key)) {
			throw new RangeError(`The export dialog exports a ${kind} setting no preset admits: ${key}.`);
		}
	}
}

const NUMERIC_KEYS: readonly string[] = Object.freeze([
	'sampleRate', 'bitRate', 'quality', 'compressionLevel',
]);

const CANVAS_FIT_DEFAULT = 'contain';
const VIDEO_QUALITY_DEFAULT = DEFAULT_VIDEO_DELIVERY_QUALITY;
const AUDIO_LAYOUT_DEFAULT = DEFAULT_VIDEO_DELIVERY_AUDIO_LAYOUT;

/** The preset-worthy subset of the dialog's settings, with numbers as numbers. */
export function presetSettingsFromDialog(
	settings: Readonly<Record<string, unknown>>,
	kind: DeliveryPresetKind,
): Readonly<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	for (const key of PRESET_SETTING_KEYS[kind]) {
		const value = settings?.[key];
		if (value === undefined || value === '') continue;
		if (NUMERIC_KEYS.includes(key)) {
			const numeric = Number(value);
			if (Number.isFinite(numeric)) result[key] = numeric;
			continue;
		}
		result[key] = value;
	}
	if (kind === 'video') {
		Object.assign(result, statedVideoCanvas(settings));
		const quality = statedVideoQuality(settings);
		if (quality) result.quality = quality;
		const audioLayout = statedVideoAudioLayout(settings);
		if (audioLayout) result.audioLayout = audioLayout;
	}
	return Object.freeze(result);
}

/**
 * The delivery quality tier a video dialog is asking for, or nothing.
 *
 * `balanced` is the tier every delivery used before quality could be chosen, so
 * it is left unstated for the same reason `contain` is: a preset saved from an
 * untouched dialog must not start pinning a value it never asked for.
 *
 * The dialog holds this as `videoQuality` because `quality` is already the
 * Vorbis quality control; the preset spells it `quality` because a video preset
 * has only the one.
 */
export function statedVideoQuality(
	settings: Readonly<Record<string, unknown>> | undefined,
): string | null {
	const quality = settings?.videoQuality;
	if (typeof quality !== 'string' || !quality || quality === VIDEO_QUALITY_DEFAULT) return null;
	return quality;
}

/**
 * The delivery target the dialog picked, resolved through its own gates.
 *
 * A target that cannot be delivered is followed to its fallback rather than
 * refused, and says which target it stood in for, because a user who asked for
 * 4K HDR should get the delivery that works and be told what happened — not an
 * error, and not a file that quietly is not what they asked for.
 */
export function statedVideoDeliveryTarget(
	settings: Readonly<Record<string, unknown>> | undefined,
): Readonly<{
	presetId: string;
	options: Readonly<Record<string, unknown>>;
	degradedFrom: string | null;
}> | null {
	const requested = findPlatformDeliveryPreset(settings?.deliveryTarget);
	if (!requested) return null;
	let preset = requested;
	const seen = new Set<string>();
	while (!resolvePlatformDeliveryAvailability(preset).available) {
		if (seen.has(preset.id)) return null;
		seen.add(preset.id);
		const fallback = findPlatformDeliveryPreset(preset.fallbackPresetId);
		if (!fallback) return null;
		preset = fallback;
	}
	const options = resolvePlatformDeliveryPlanOptions(preset);
	if (!options) return null;
	return Object.freeze({
		presetId: preset.id,
		options,
		degradedFrom: preset.id === requested.id ? null : requested.id,
	});
}

/**
 * The dialog format a delivery target delivers in, or null when it delivers none.
 *
 * A blocked target is followed to its fallback here exactly as the request
 * builder follows it, so the control the operator sees and the file they get
 * name the same container.
 */
export function deliveryTargetDialogFormat(deliveryTarget: unknown): string | null {
	const target = statedVideoDeliveryTarget({ deliveryTarget });
	const format = target?.options.format;
	return typeof format === 'string' && format ? videoExportRequestFormat(format) : null;
}

/**
 * The caption delivery a video dialog is asking for, or nothing at all.
 *
 * A delivery needs a track to caption from, so an unnamed track means no
 * captions rather than an empty caption track. The single control spells the
 * mux and sidecar decision together because they are one choice to a reader —
 * where do the captions go — even though the plan states them separately.
 *
 * Deliberately not preset-worthy: a track ID names one project's track, and a
 * preset that carried one would silently caption from nothing in the next.
 */
export function statedVideoCaptions(
	settings: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | null {
	const trackId = settings?.captionTrackId;
	if (typeof trackId !== 'string' || !trackId) return null;
	const delivery = String(settings?.captionDelivery ?? 'mux');
	const mux = delivery === 'mux' || delivery.startsWith('mux+');
	const sidecar = delivery.startsWith('mux+') ? delivery.slice(4) : (mux ? null : delivery);
	return Object.freeze({
		trackId,
		mux,
		sidecar: sidecar || null,
		burnIn: settings?.captionBurnIn === true,
	});
}

/**
 * The audio layout a video dialog is asking for, or nothing.
 *
 * `preserve` delivers the project's own channels, which is what every video
 * export did before a layout could be chosen, so it stays unstated.
 */
export function statedVideoAudioLayout(
	settings: Readonly<Record<string, unknown>> | undefined,
): string | null {
	const layout = settings?.videoAudioLayout;
	if (typeof layout !== 'string' || !layout || layout === AUDIO_LAYOUT_DEFAULT) return null;
	return layout;
}

/**
 * The canvas a video dialog is asking for, or nothing at all.
 *
 * A canvas needs both extents to mean anything, and `contain` is what every
 * delivery did before a fit could be chosen, so neither is written down unless
 * it was actually asked for: an untouched dialog must leave existing deliveries
 * byte-identical rather than start stating their geometry.
 */
export function statedVideoCanvas(
	settings: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
	const width = Number(settings?.canvasWidth);
	const height = Number(settings?.canvasHeight);
	const fit = settings?.canvasFit;
	const frameRate = Number(settings?.canvasFrameRate);
	const backgroundColor = settings?.canvasBackgroundColor;
	const stated: Record<string, unknown> = {};
	if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
		stated.size = Object.freeze({ width, height });
	}
	if (typeof fit === 'string' && fit && fit !== CANVAS_FIT_DEFAULT) stated.fit = fit;
	if (settings?.canvasFrameRate !== '' && Number.isFinite(frameRate) && frameRate > 0) {
		stated.frameRate = frameRate;
	}
	if (typeof backgroundColor === 'string' && backgroundColor) stated.backgroundColor = backgroundColor;
	return Object.freeze(stated);
}

/**
 * Runs one preset control's work, reporting what it refused.
 *
 * A preset refuses deliberately and says why — an unrecognized setting means a
 * preset written against a build that understood something this one does not.
 * The controls used to drop those rejections on the floor, which turned every
 * designed refusal into a control that silently did nothing while the message
 * the validator composed was never shown. Owning the policy here rather than
 * inside the component is what lets it be tested without a browser.
 */
export async function runDeliveryPresetAction(
	work: () => unknown,
	handlers: Readonly<{
		onError?: (cause: unknown) => void;
		onBusy?: (busy: boolean) => void;
	}> = {},
): Promise<void> {
	handlers.onBusy?.(true);
	handlers.onError?.(null);
	try {
		await work();
	} catch (cause) {
		handlers.onError?.(cause);
	} finally {
		handlers.onBusy?.(false);
	}
}

/**
 * Translating between the format a dialog names and the format a preset names.
 *
 * The dialog distinguishes its video formats from its audio ones by prefix, so
 * a single list can hold both; a preset already says which kind it is, so it
 * carries the bare codec name the export plan uses. Neither side can consume the
 * other's spelling: the validator refuses `video-mp4` as an unknown video
 * format, and the dialog does not recognise `mp4` as a video format at all, so
 * a preset applied without this translation quietly switched the dialog to
 * audio. The export start path performs the same strip, which is why the plan
 * only ever sees the bare name.
 */
export function presetFormatFromDialog(format: unknown, kind: DeliveryPresetKind): string {
	const value = String(format ?? '');
	return kind === 'video' ? videoExportPlanFormat(value) : value;
}

export function dialogFormatFromPreset(preset: DeliveryPreset): string {
	return preset.kind === 'video' ? videoExportRequestFormat(preset.format) : preset.format;
}

/** The dialog patch a preset implies. Numbers become strings again for the inputs. */
export function dialogSettingsFromPreset(
	preset: DeliveryPreset,
): Readonly<Record<string, unknown>> {
	const patch: Record<string, unknown> = { format: dialogFormatFromPreset(preset) };
	for (const [key, value] of Object.entries(preset.settings ?? {})) {
		if (key === 'size') {
			const size = value as Readonly<{ width?: unknown; height?: unknown }> | null;
			patch.canvasWidth = size?.width == null ? '' : String(size.width);
			patch.canvasHeight = size?.height == null ? '' : String(size.height);
			continue;
		}
		if (key === 'fit') {
			patch.canvasFit = String(value);
			continue;
		}
		if (key === 'frameRate') {
			// A preset may state an exact rational; the dialog holds the decimal it
			// round-trips through, which is how every other rate reaches the plan.
			const rational = value as Readonly<{ num?: unknown; den?: unknown }> | null;
			patch.canvasFrameRate = rational && typeof rational === 'object'
				? String(Number(rational.num) / Number(rational.den))
				: String(value);
			continue;
		}
		if (key === 'backgroundColor') {
			patch.canvasBackgroundColor = String(value);
			continue;
		}
		if (key === 'quality' && preset.kind === 'video') {
			patch.videoQuality = String(value);
			continue;
		}
		if (key === 'audioLayout') {
			patch.videoAudioLayout = String(value);
			continue;
		}
		patch[key] = NUMERIC_KEYS.includes(key) ? String(value) : value;
	}
	return Object.freeze(patch);
}
