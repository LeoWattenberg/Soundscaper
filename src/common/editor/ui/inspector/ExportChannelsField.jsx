/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { LabeledRadio } from '@soundscaper/design-system/LabeledRadio';

const RADIO_GROUP_NAME = 'audio-editor-export-channels';

/**
 * Audacity's channel choice: radio buttons rather than a dropdown, with the
 * custom mapping edited in its own window instead of as JSON in the dialog.
 *
 * Preserve leads the group because it is what a multichannel project delivers
 * without being asked, and it is the only choice a BW64 programme has.
 */
export default function ExportChannelsField({ copy, value, disabled, onChange, onEditMapping }) {
	const options = [
		{ value: 'preserve', label: copy.preserveChannels },
		{ value: 'mono', label: copy.mono },
		{ value: 'stereo', label: copy.stereo },
		{ value: 'custom', label: copy.customChannelMapping },
	];
	return (
		<div
			className="audio-editor-field audio-editor-export-channels"
			role="radiogroup"
			aria-label={copy.channelMapping}
			data-export-field="channelMapping"
		>
			<span>{copy.channelMapping}</span>
			<div className="audio-editor-export-channels__options">
				{options.map((option) => (
					<span key={option.value} data-export-channel-option={option.value}>
						<LabeledRadio
							label={option.label}
							name={RADIO_GROUP_NAME}
							value={option.value}
							checked={value === option.value}
							disabled={disabled}
							onChange={() => onChange(option.value)}
						/>
					</span>
				))}
				<span data-export-channel-action="edit-mapping">
					<Button
						variant="secondary"
						disabled={disabled || value !== 'custom'}
						onClick={onEditMapping}
					>{copy.editChannelMapping}</Button>
				</span>
			</div>
		</div>
	);
}
