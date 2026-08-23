/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_CANVAS_FIT_MODES } from '../video-canvas-fit.ts';
import { VIDEO_DELIVERY_FRAME_RATE_CHOICES } from '../video-delivery-frame-rate.ts';
import { VIDEO_DELIVERY_QUALITY_TIERS } from '../video-delivery-quality.ts';
import { VIDEO_DELIVERY_AUDIO_LAYOUTS } from '../video-delivery-audio-layout.ts';
import {
	findPlatformDeliveryPreset,
	PLATFORM_DELIVERY_PRESETS,
	resolvePlatformDeliveryAvailability,
} from '../platform-delivery-presets.ts';
import { statedVideoDeliveryTarget } from './export-preset-model.ts';
import { DesignCheckbox, LabeledDropdown } from './inspector/inspector-controls.jsx';

/**
 * The rates a delivery usually asks for; the field accepts any of them or another.
 *
 * Read from the same table that resolves them, so a spelling this list offers is
 * one the request knows the exact rational for.
 */
const DELIVERY_FRAME_RATES = Object.freeze(
	VIDEO_DELIVERY_FRAME_RATE_CHOICES.map(({ label }) => label),
);

const FIT_LABEL_KEYS = Object.freeze({
	contain: 'videoCanvasFitContain',
	cover: 'videoCanvasFitCover',
	stretch: 'videoCanvasFitStretch',
});

const QUALITY_LABEL_KEYS = Object.freeze({
	draft: 'videoQualityDraft',
	balanced: 'videoQualityBalanced',
	high: 'videoQualityHigh',
});

// The audio exporter's own words for the same three layouts, so a delivery
// reads the same whichever exporter the user reached it through.
const AUDIO_LAYOUT_LABEL_KEYS = Object.freeze({
	preserve: 'preserveChannels',
	mono: 'mono',
	stereo: 'stereo',
});

// Muxing and a sidecar are two plan fields but one question to a reader, so the
// dialog asks it once: where do the captions go.
const CAPTION_DELIVERIES = Object.freeze([
	{ value: 'mux', labelKey: 'videoCaptionDeliveryMux' },
	{ value: 'srt', labelKey: 'videoCaptionDeliverySrt' },
	{ value: 'vtt', labelKey: 'videoCaptionDeliveryVtt' },
	{ value: 'mux+srt', labelKey: 'videoCaptionDeliveryMuxSrt' },
	{ value: 'mux+vtt', labelKey: 'videoCaptionDeliveryMuxVtt' },
]);

/**
 * The delivery itself, as the export dialog asks for it: canvas and quality.
 *
 * Both extents empty means the automatic canvas: derived from the first visible
 * video and capped at 1280x720, which is what every export did before a size
 * could be stated. Stating both delivers them exactly at any aspect, and the
 * fit decides what happens to a source that does not share that aspect. The
 * plan builder validates the numbers — an odd extent is refused there, not
 * silently rounded here — so this surface only has to carry the request.
 *
 * Quality is a tier rather than an encoder number for the same reason the plan
 * states one: the dialog cannot know which encoder will serve this delivery.
 *
 * The audio layout borrows the audio exporter's control and its words. A video
 * delivery cannot state a custom matrix, because the per-channel editor that
 * makes one legible belongs to the audio dialog.
 */
export default function VideoDeliveryFields({
	copy, disabled, labelTracks = [], settings, onChange, captionDeliveryUnavailable = false,
}) {
	const target = findPlatformDeliveryPreset(settings.deliveryTarget);
	const availability = target ? resolvePlatformDeliveryAvailability(target) : null;
	// The fallback named here has to be the one the delivery actually reaches,
	// not the next link in the chain: a blocked target whose fallback is itself
	// blocked is followed further, and naming the middle link promised a
	// mezzanine while 1080p was what landed.
	const delivered = availability && !availability.available
		? statedVideoDeliveryTarget({ deliveryTarget: settings.deliveryTarget })
		: null;
	const blockedTarget = availability && !availability.available
		? {
			availability,
			fallbackLabel: findPlatformDeliveryPreset(delivered?.presetId)?.label
				?? copy.videoDeliveryTargetCustom,
		}
		: null;
	return (
		<>
			<LabeledDropdown
				label={copy.videoDeliveryTarget}
				hook="deliveryTarget"
				value={settings.deliveryTarget}
				onChange={(value) => onChange('deliveryTarget', value)}
				disabled={disabled}
				options={[
					{ value: '', label: copy.videoDeliveryTargetCustom },
					...PLATFORM_DELIVERY_PRESETS.map((preset) => ({
						value: preset.id,
						label: resolvePlatformDeliveryAvailability(preset).available
							? preset.label
							: `${preset.label} — ${copy.videoDeliveryUnavailable}`,
					})),
				]}
			/>
			{blockedTarget && (
				<p className="audio-editor-panel-hint" data-export-field="deliveryTargetBlocked">
					{copy.videoDeliveryBlockedHint
						.replace('{blocker}', blockedTarget.availability.blocker)
						.replace('{fallback}', blockedTarget.fallbackLabel)}
				</p>
			)}
			<label className="audio-editor-field" data-export-field="canvasSize">
				<span>{copy.videoCanvasSize}</span>
				<span className="audio-editor-export-canvas-size">
					<input
						type="number"
						min="2"
						max="16384"
						step="2"
						aria-label={copy.videoCanvasWidth}
						placeholder={copy.videoCanvasAutomatic}
						value={settings.canvasWidth}
						disabled={disabled}
						onChange={(event) => onChange('canvasWidth', event.currentTarget.value)}
					/>
					<input
						type="number"
						min="2"
						max="16384"
						step="2"
						aria-label={copy.videoCanvasHeight}
						placeholder={copy.videoCanvasAutomatic}
						value={settings.canvasHeight}
						disabled={disabled}
						onChange={(event) => onChange('canvasHeight', event.currentTarget.value)}
					/>
				</span>
			</label>
			<LabeledDropdown
				label={copy.videoCanvasFit}
				hook="canvasFit"
				value={settings.canvasFit}
				onChange={(value) => onChange('canvasFit', value)}
				disabled={disabled}
				options={VIDEO_CANVAS_FIT_MODES.map((fit) => ({
					value: fit,
					label: copy[FIT_LABEL_KEYS[fit]],
				}))}
			/>
			<label className="audio-editor-field" data-export-field="canvasFrameRate">
				<span>{copy.videoCanvasFrameRate}</span>
				<input
					type="number"
					min="0"
					max="1000"
					step="0.001"
					list="audio-editor-export-frame-rates"
					placeholder={copy.videoCanvasAutomatic}
					value={settings.canvasFrameRate}
					disabled={disabled}
					onChange={(event) => onChange('canvasFrameRate', event.currentTarget.value)}
				/>
				<datalist id="audio-editor-export-frame-rates">
					{DELIVERY_FRAME_RATES.map((rate) => <option key={rate} value={rate} />)}
				</datalist>
			</label>
			<label className="audio-editor-field" data-export-field="canvasBackground">
				<span>{copy.videoCanvasBackground}</span>
				<input
					type="text"
					spellCheck={false}
					placeholder="#000000"
					value={settings.canvasBackgroundColor}
					disabled={disabled}
					onChange={(event) => onChange('canvasBackgroundColor', event.currentTarget.value)}
				/>
			</label>
			<LabeledDropdown
				label={copy.videoQuality}
				hook="videoQuality"
				value={settings.videoQuality}
				onChange={(value) => onChange('videoQuality', value)}
				disabled={disabled}
				options={VIDEO_DELIVERY_QUALITY_TIERS.map((tier) => ({
					value: tier,
					label: copy[QUALITY_LABEL_KEYS[tier]],
				}))}
			/>
			<LabeledDropdown
				label={copy.channelMapping}
				hook="videoAudioLayout"
				value={settings.videoAudioLayout}
				onChange={(value) => onChange('videoAudioLayout', value)}
				disabled={disabled}
				options={VIDEO_DELIVERY_AUDIO_LAYOUTS.map((layout) => ({
					value: layout,
					label: copy[AUDIO_LAYOUT_LABEL_KEYS[layout]],
				}))}
			/>
			{captionDeliveryUnavailable ? (
				<p className="audio-editor-panel-hint" data-export-field="captionDeliveryUnavailable">
					{copy.videoCaptionV27DeliveryUnavailable || 'Caption burn-in and mux are unavailable for selected Framescaper V27. Export SRT, WebVTT, or IMSC 1.1 sidecars from Tracks > Caption Tracks.'}
				</p>
			) : (
				<>
					<LabeledDropdown
						label={copy.videoCaptionTrack}
						hook="captionTrack"
						value={settings.captionTrackId}
						onChange={(value) => onChange('captionTrackId', value)}
						disabled={disabled || labelTracks.length === 0}
						options={[
							{ value: '', label: copy.videoCaptionNone },
							...labelTracks.map((track) => ({ value: track.id, label: track.name || track.id })),
						]}
					/>
					{settings.captionTrackId && (
						<>
							<LabeledDropdown
								label={copy.videoCaptionDelivery}
								hook="captionDelivery"
								value={settings.captionDelivery}
								onChange={(value) => onChange('captionDelivery', value)}
								disabled={disabled}
								options={CAPTION_DELIVERIES.map(({ value, labelKey }) => ({ value, label: copy[labelKey] }))}
							/>
							<label className="audio-editor-field" data-export-field="captionBurnIn">
								<span>{copy.videoCaptionBurnIn}</span>
								<span>
									<DesignCheckbox
										label={copy.videoCaptionBurnInHint}
										checked={settings.captionBurnIn}
										disabled={disabled}
										onChange={(checked) => onChange('captionBurnIn', checked)}
									/>
								</span>
							</label>
						</>
					)}
				</>
			)}
			<p className="audio-editor-panel-hint">{copy.videoCanvasHint}</p>
		</>
	);
}
