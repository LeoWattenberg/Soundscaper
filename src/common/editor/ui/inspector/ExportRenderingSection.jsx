import { Separator } from '@soundscaper/design-system/Separator';

import EditorHelpTooltip from '../EditorHelpTooltip.tsx';
import { DesignCheckbox, LabeledDropdown } from './inspector-controls.jsx';

/**
 * The Rendering section of the export dialog: what happens to the mix on its way out.
 *
 * Every field here changes the delivered signal rather than the container it is written
 * into, which is why they sit together and why an ADM passthrough — a delivery that must
 * be handed on byte-exact — disables all of them.
 */
export default function ExportRenderingSection({ copy, settings, exporting, admPassthrough, pcmFormat, binauralAvailable, onChange }) {
	return (
		<>
			<Separator />
			<section className="audio-editor-export-section">
				<h3>{copy.renderingSection}</h3>
				{/* A delivery normalizes only when a target is chosen: there is no
					default, and stems, chapters and ADM passthrough refuse it outright. */}
				{settings.mode === 'mix' && <LabeledDropdown label={copy.loudnessNormalization} hook="loudnessNormalization" value={settings.loudnessNormalization} onChange={(value) => onChange('loudnessNormalization', value)} disabled={exporting || admPassthrough} options={[{ value: '', label: copy.loudnessNormalizationNone }, { value: 'ebu-r128', label: copy.loudnessNormalizationR128 }, { value: 'atsc-a85', label: copy.loudnessNormalizationA85 }, { value: 'streaming-14', label: copy.loudnessNormalizationStreaming }]} />}
				{pcmFormat && settings.sampleFormat !== 'float32' && <LabeledDropdown label={copy.dither} hook="dither" value={settings.dither} onChange={(value) => onChange('dither', value)} disabled={exporting || admPassthrough} options={[{ value: 'none', label: copy.none }, { value: 'triangular', label: copy.triangularDither }, { value: 'triangular-highpass', label: copy.highpassDither }]} />}
				{/* A chapter delivers exactly the span its label names, so there
					is no tail to carry past it into the next chapter. */}
				{settings.mode !== 'chapters' && <div className="audio-editor-export-check" data-export-field="tails">
					<span aria-hidden="true" />
					<DesignCheckbox label={copy.includeTails} checked={settings.includeTail} disabled={exporting || admPassthrough} onChange={(checked) => onChange('includeTail', checked)} />
				</div>}
				{binauralAvailable && (
					<div className="audio-editor-export-check" data-export-field="binaural">
						<span aria-hidden="true" />
						<span className="audio-editor-help-label">
							<DesignCheckbox label={copy.binauralRender} checked={settings.binaural} disabled={exporting} onChange={(checked) => onChange('binaural', checked)} />
							<EditorHelpTooltip subject={copy.binauralRender} description={copy.binauralRenderHint} helpLabel={copy.helpMenu} hook="binaural" />
						</span>
					</div>
				)}
			</section>
		</>
	);
}
