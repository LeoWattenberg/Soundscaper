/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';

import { prepareRawPcmWaveFile, type RawPcmByteOrder, type RawPcmSampleFormat } from '../../controller/raw-pcm-import.ts';
import type { RegularIntervalAnnotationOptions } from '../../controller/regular-interval-annotation-service.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface DialogController {
	readonly project: null | Readonly<{
		readonly primarySequenceId: string;
		readonly sampleRate: number;
		readonly clips: readonly Readonly<{ readonly timelineStartFrame: number; readonly durationFrames: number }>[];
	}>;
	readonly actions: Readonly<{
		readonly project: Readonly<{ importFiles(files: readonly File[]): unknown }>;
		readonly timelineAnnotations: Readonly<{ regularInterval(options: RegularIntervalAnnotationOptions): unknown }>;
	}>;
}

interface CommonProps {
	readonly controller: DialogController;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export function RawPcmImportDialog({ controller, copy, run, onClose }: CommonProps) {
	const [file, setFile] = useState<File | null>(null);
	const [sampleFormat, setSampleFormat] = useState<RawPcmSampleFormat>('int16');
	const [byteOrder, setByteOrder] = useState<RawPcmByteOrder>('little');
	const [sampleRate, setSampleRate] = useState(44_100);
	const [channelCount, setChannelCount] = useState(1);
	const [offsetBytes, setOffsetBytes] = useState(0);
	return <AudioEditorDialogShell
		title={copy.audacityParityLabelImportRawData}
		onClose={onClose}
		width={560}
		dataAttributes={{ 'data-import-surface': 'raw-pcm' }}
	>
		<form className="kw-audio-editor-dialog__form" onSubmit={(event) => {
			event.preventDefault();
			if (!file) return;
			run(async () => {
				const wav = await prepareRawPcmWaveFile(file, { sampleFormat, byteOrder, sampleRate, channelCount, offsetBytes });
				await controller.actions.project.importFiles([wav]);
				onClose();
			});
		}}>
			<label className="kw-audio-editor-dialog__field"><span>{copy.rawPcmFile}</span><input required type="file" accept=".raw,.pcm,application/octet-stream" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
			<label className="kw-audio-editor-dialog__field"><span>{copy.rawPcmSampleFormat}</span><select value={sampleFormat} onChange={(event) => setSampleFormat(event.currentTarget.value as RawPcmSampleFormat)}>
				<option value="uint8">{copy.rawPcmUint8}</option><option value="int16">{copy.rawPcmInt16}</option><option value="int24">{copy.rawPcmInt24}</option><option value="int32">{copy.rawPcmInt32}</option><option value="float32">{copy.rawPcmFloat32}</option>
			</select></label>
			<label className="kw-audio-editor-dialog__field"><span>{copy.rawPcmByteOrder}</span><select disabled={sampleFormat === 'uint8'} value={byteOrder} onChange={(event) => setByteOrder(event.currentTarget.value as RawPcmByteOrder)}>
				<option value="little">{copy.rawPcmLittleEndian}</option><option value="big">{copy.rawPcmBigEndian}</option>
			</select></label>
			<NumberField label={copy.sampleRate} value={sampleRate} minimum={1} maximum={384_000} onChange={setSampleRate} />
			<NumberField label={copy.rawPcmChannelCount} value={channelCount} minimum={1} maximum={32} onChange={setChannelCount} />
			<NumberField label={copy.rawPcmByteOffset} value={offsetBytes} minimum={0} maximum={Number.MAX_SAFE_INTEGER} onChange={setOffsetBytes} />
			<div className="kw-audio-editor-dialog__actions"><button type="button" onClick={onClose}>{copy.cancel}</button><button type="submit" disabled={!file}>{copy.importFile}</button></div>
		</form>
	</AudioEditorDialogShell>;
}

export function RegularIntervalAnnotationDialog({ controller, copy, run, onClose }: CommonProps) {
	const project = controller.project;
	const duration = Math.max(1, ...(project?.clips.map((clip) => clip.timelineStartFrame + clip.durationFrames) ?? [1]));
	const [kind, setKind] = useState<'marker' | 'region'>('marker');
	const [startFrame, setStartFrame] = useState(0);
	const [endFrame, setEndFrame] = useState(duration);
	const [intervalFrames, setIntervalFrames] = useState(Math.max(1, Math.round((project?.sampleRate ?? 48_000))));
	const [namePrefix, setNamePrefix] = useState('Cue');
	return <AudioEditorDialogShell title={copy.regularIntervalLabels} onClose={onClose} width={560} dataAttributes={{ 'data-annotation-surface': 'regular-interval' }}>
		<form className="kw-audio-editor-dialog__form" onSubmit={(event) => {
			event.preventDefault();
			if (!project) return;
			run(() => controller.actions.timelineAnnotations.regularInterval({
				kind, anchor: 'sample', sequenceId: project.primarySequenceId, startFrame, endFrame,
				intervalFrames, namePrefix, color: 'auto',
			}));
			onClose();
		}}>
			<label className="kw-audio-editor-dialog__field"><span>{copy.regularIntervalKind}</span><select value={kind} onChange={(event) => setKind(event.currentTarget.value as 'marker' | 'region')}><option value="marker">{copy.regularIntervalMarker}</option><option value="region">{copy.regularIntervalRegion}</option></select></label>
			<NumberField label={copy.regularIntervalStartFrame} value={startFrame} minimum={0} maximum={Number.MAX_SAFE_INTEGER} onChange={setStartFrame} />
			<NumberField label={copy.regularIntervalEndFrame} value={endFrame} minimum={1} maximum={Number.MAX_SAFE_INTEGER} onChange={setEndFrame} />
			<NumberField label={copy.regularIntervalFrames} value={intervalFrames} minimum={1} maximum={Number.MAX_SAFE_INTEGER} onChange={setIntervalFrames} />
			<label className="kw-audio-editor-dialog__field"><span>{copy.regularIntervalNamePrefix}</span><input value={namePrefix} onChange={(event) => setNamePrefix(event.currentTarget.value)} /></label>
			<div className="kw-audio-editor-dialog__actions"><button type="button" onClick={onClose}>{copy.cancel}</button><button type="submit" disabled={!project}>{copy.regularIntervalCreate}</button></div>
		</form>
	</AudioEditorDialogShell>;
}

function NumberField({ label, value, minimum, maximum, onChange }: Readonly<{
	label: string; value: number; minimum: number; maximum: number; onChange(value: number): void;
}>) {
	return <label className="kw-audio-editor-dialog__field"><span>{label}</span><input required type="number" min={minimum} max={maximum} step={1} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} /></label>;
}
