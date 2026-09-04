/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Checkbox } from '@soundscaper/design-system/Checkbox';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import '../audio-editor-design-system/38-export-channel-mapping.css';
import {
	MAXIMUM_EXPORT_CHANNELS,
	boundedExportChannelCount,
	ensureExportChannelMatrixWidth,
	exportChannelMatrixOutputCount,
	parseExportChannelMatrix,
	serializeExportChannelMatrix,
	toggleExportChannelMatrix,
	type ExportChannelMatrix,
} from '../export-channel-matrix.ts';

type DialogCopy = Readonly<Record<string, string>>;

export interface ExportChannelMappingDialogProps {
	readonly isOpen?: boolean;
	readonly copy: DialogCopy;
	readonly inputChannelCount: number;
	/** The mapping the dialog currently holds, as the JSON the request parses. */
	readonly value: unknown;
	readonly onCommit: (channelMatrix: string) => void;
	readonly onClose: () => void;
}

/**
 * Audacity's custom channel mapping window: a grid of checkboxes with an input
 * per row and an output per column, and a stepper for how many outputs the
 * delivery has. Nothing is written back until the mapping is applied, so a
 * mapping the grid cannot express survives being looked at.
 */
export default function ExportChannelMappingDialog({
	isOpen = true,
	copy,
	inputChannelCount,
	value,
	onCommit,
	onClose,
}: ExportChannelMappingDialogProps) {
	const [matrix, setMatrix] = useState<ExportChannelMatrix>(
		() => parseExportChannelMatrix(value, inputChannelCount),
	);
	// Held apart from the grid so the count can be retyped a digit at a time
	// without the grid forgetting the columns the first digit excluded.
	const [outputCount, setOutputCount] = useState(() => exportChannelMatrixOutputCount(
		parseExportChannelMatrix(value, inputChannelCount),
	));
	const text = (key: string, fallback: string) => copy[key] || fallback;
	const numbered = (key: string, fallback: string, channel: number) => text(key, fallback)
		.replace('{channel}', String(channel));
	return (
		<AudioEditorDialogShell
			isOpen={isOpen}
			title={text('channelMappingTitle', 'Edit channel mapping')}
			onClose={onClose}
			width={520}
			className="audio-editor-channel-mapping-dialog"
			dataAttributes={{ 'data-export-channel-mapping': '' }}
			footer={(
				<DialogFooter
					className="audio-editor-dialog-footer"
					rightContent={(
						<>
							<Button variant="secondary" onClick={onClose}>{text('cancel', 'Cancel')}</Button>
							<span data-export-channel-mapping-action="apply">
								<Button
									variant="primary"
									onClick={() => {
										onCommit(serializeExportChannelMatrix(matrix, outputCount));
										onClose();
									}}
								>{text('channelMappingApply', 'Apply')}</Button>
							</span>
						</>
					)}
				/>
			)}
		>
			<div className="audio-editor-channel-mapping">
				<label className="audio-editor-field" data-export-channel-mapping-field="outputs">
					<span>{text('channelMappingOutputCount', 'Output channels')}</span>
					<NumberStepper
						value={String(outputCount)}
						min={1}
						max={MAXIMUM_EXPORT_CHANNELS}
						step={1}
						width={120}
						onChange={(next: string) => {
							const outputs = boundedExportChannelCount(next, outputCount);
							setOutputCount(outputs);
							setMatrix((current) => ensureExportChannelMatrixWidth(current, outputs));
						}}
					/>
				</label>
				<div className="audio-editor-channel-mapping__grid-scroll">
					<table className="audio-editor-channel-mapping__grid">
						<thead>
							<tr>
								<th scope="col"><span className="kw-audio-editor-sr-only">{text('channelMapping', 'Channel mapping')}</span></th>
								{Array.from({ length: outputCount }, (_, output) => (
									<th key={output} scope="col" abbr={String(output + 1)}>
										<span aria-hidden="true">{output + 1}</span>
										<span className="kw-audio-editor-sr-only">
											{numbered('channelMappingOutputChannel', 'Output {channel}', output + 1)}
										</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{matrix.map((row, input) => (
								<tr key={input}>
									<th scope="row">{numbered('channelMappingInputChannel', 'Input {channel}', input + 1)}</th>
									{row.slice(0, outputCount).map((checked, output) => (
										<td key={output} data-export-channel-mapping-cell={`${input}-${output}`}>
											<Checkbox
												checked={checked}
												aria-label={text('channelMappingCell', 'Route input {input} to output {output}')
													.replace('{input}', String(input + 1))
													.replace('{output}', String(output + 1))}
												onChange={(next: boolean) => setMatrix(
													(current) => toggleExportChannelMatrix(current, input, output, next),
												)}
											/>
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className="audio-editor-panel-hint">{text('channelMappingMatrixHint', '')}</p>
			</div>
		</AudioEditorDialogShell>
	);
}
