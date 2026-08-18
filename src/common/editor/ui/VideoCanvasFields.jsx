/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_CANVAS_FIT_MODES } from '../video-canvas-fit.ts';
import { LabeledDropdown } from './inspector/inspector-controls.jsx';

const FIT_LABEL_KEYS = Object.freeze({
	contain: 'videoCanvasFitContain',
	cover: 'videoCanvasFitCover',
	stretch: 'videoCanvasFitStretch',
});

/**
 * The delivery canvas, as the export dialog asks for it.
 *
 * Both extents empty means the automatic canvas: derived from the first visible
 * video and capped at 1280x720, which is what every export did before a size
 * could be stated. Stating both delivers them exactly at any aspect, and the
 * fit decides what happens to a source that does not share that aspect. The
 * plan builder validates the numbers — an odd extent is refused there, not
 * silently rounded here — so this surface only has to carry the request.
 */
export default function VideoCanvasFields({ copy, disabled, settings, onChange }) {
	return (
		<>
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
			<p className="audio-editor-panel-hint">{copy.videoCanvasHint}</p>
		</>
	);
}
