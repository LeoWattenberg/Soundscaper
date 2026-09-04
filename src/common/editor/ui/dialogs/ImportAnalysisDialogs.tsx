/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import { prepareRawPcmWaveFile, type RawPcmByteOrder, type RawPcmSampleFormat } from '../../controller/raw-pcm-import.ts';
import type { RegularIntervalAnnotationOptions } from '../../controller/regular-interval-annotation-service.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';

interface DialogController {
	readonly project: null | Readonly<{
		readonly id: string;
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
	const [importing, setImporting] = useState(false);
	const importingRef = useRef(false);
	// The import button sits in the shared footer, outside the form, so the
	// import path is a named handler the footer click and the form's Enter
	// submit both enter through.
	const importRawPcm = (): void => {
		if (!file || importingRef.current) return;
		const projectId = controller.project?.id ?? null;
		const projectIsCurrent = (): boolean => (controller.project?.id ?? null) === projectId;
		importingRef.current = true;
		setImporting(true);
		run(async () => {
			try {
				const wav = await prepareRawPcmWaveFile(file, { sampleFormat, byteOrder, sampleRate, channelCount, offsetBytes });
				if (!projectIsCurrent()) return;
				await controller.actions.project.importFiles([wav]);
				if (!projectIsCurrent()) return;
			} finally {
				importingRef.current = false;
				setImporting(false);
			}
			onClose();
		});
	};
	return <AudioEditorDialogShell
		title={copy.audacityParityLabelImportRawData}
		onClose={onClose}
		width={560}
		dataAttributes={{ 'data-import-surface': 'raw-pcm' }}
		footer={<DialogFooter
			className="audio-editor-dialog-footer"
			rightContent={<>
				<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
				<Button
					className="audio-editor-raw-pcm-import-confirm"
					variant="primary"
					disabled={!file || importing}
					onClick={importRawPcm}
				>{copy.importFile}</Button>
			</>}
		/>}
	>
		<form className="kw-audio-editor-dialog__form" onSubmit={(event) => {
			event.preventDefault();
			importRawPcm();
		}} aria-busy={importing}>
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
		</form>
	</AudioEditorDialogShell>;
}

export function RegularIntervalAnnotationDialog({ controller, copy, run, onClose }: CommonProps) {
	const project = controller.project;
	const projectIdentity = project?.id ?? null;
	const defaults = regularIntervalDialogDefaults(project);
	const stateProjectIdentity = useRef(projectIdentity);
	const [kind, setKind] = useState<'marker' | 'region'>(defaults.kind);
	const [startFrame, setStartFrame] = useState(defaults.startFrame);
	const [endFrame, setEndFrame] = useState(defaults.endFrame);
	const [intervalFrames, setIntervalFrames] = useState(defaults.intervalFrames);
	const [namePrefix, setNamePrefix] = useState(defaults.namePrefix);
	useEffect(() => {
		if (stateProjectIdentity.current === projectIdentity) return;
		stateProjectIdentity.current = projectIdentity;
		setKind(defaults.kind);
		setStartFrame(defaults.startFrame);
		setEndFrame(defaults.endFrame);
		setIntervalFrames(defaults.intervalFrames);
		setNamePrefix(defaults.namePrefix);
	}, [defaults.endFrame, defaults.intervalFrames, defaults.kind, defaults.namePrefix, defaults.startFrame, projectIdentity]);
	// The create button lives in the shared footer, outside the form, so both
	// it and the form's Enter submit enter through one named handler.
	const create = (): void => {
		if (!project
			|| stateProjectIdentity.current !== projectIdentity
			|| controller.project?.id !== project.id) return;
		const projectId = project.id;
		const request: RegularIntervalAnnotationOptions = {
			kind, anchor: 'sample', sequenceId: project.primarySequenceId, startFrame, endFrame,
			intervalFrames, namePrefix, color: 'auto',
		};
		void runAwaitedAudioEditorOperation(run, () => {
			if (controller.project?.id !== projectId) return undefined;
			return controller.actions.timelineAnnotations.regularInterval(request);
		}).then(() => {
			if (controller.project?.id === projectId) onClose();
		}).catch(() => undefined);
	};
	return <AudioEditorDialogShell title={copy.regularIntervalLabels} onClose={onClose} width={560}
		dataAttributes={{ 'data-annotation-surface': 'regular-interval' }}
		footer={<DialogFooter
			className="audio-editor-dialog-footer"
			rightContent={<>
				<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
				<Button variant="primary" disabled={!project} onClick={create}>{copy.regularIntervalCreate}</Button>
			</>}
		/>}
	>
		<form className="kw-audio-editor-dialog__form" onSubmit={(event) => {
			event.preventDefault();
			create();
		}}>
			<label className="kw-audio-editor-dialog__field"><span>{copy.regularIntervalKind}</span><select value={kind} onChange={(event) => setKind(event.currentTarget.value as 'marker' | 'region')}><option value="marker">{copy.regularIntervalMarker}</option><option value="region">{copy.regularIntervalRegion}</option></select></label>
			<TimeField name="startFrame" label={copy.regularIntervalStartFrame} value={startFrame} sampleRate={project?.sampleRate}
				minimum={0} maximum={Math.max(0, endFrame - 1)} onChange={setStartFrame} />
			<TimeField name="endFrame" label={copy.regularIntervalEndFrame} value={endFrame} sampleRate={project?.sampleRate}
				minimum={startFrame + 1} maximum={Number.MAX_SAFE_INTEGER} onChange={setEndFrame} />
			<TimeField name="intervalFrames" label={copy.regularIntervalFrames} value={intervalFrames} sampleRate={project?.sampleRate}
				minimum={1} maximum={Number.MAX_SAFE_INTEGER} onChange={setIntervalFrames} />
			<label className="kw-audio-editor-dialog__field"><span>{copy.regularIntervalNamePrefix}</span><input value={namePrefix} onChange={(event) => setNamePrefix(event.currentTarget.value)} /></label>
		</form>
	</AudioEditorDialogShell>;
}

function regularIntervalDialogDefaults(project: DialogController['project']) {
	return {
		kind: 'marker' as const,
		startFrame: 0,
		endFrame: Math.max(1, ...(project?.clips.map((clip) => clip.timelineStartFrame + clip.durationFrames) ?? [1])),
		intervalFrames: Math.max(1, Math.round(project?.sampleRate ?? 48_000)),
		namePrefix: 'Cue',
	};
}

function NumberField({ label, value, minimum, maximum, onChange }: Readonly<{
	label: string; value: number; minimum: number; maximum: number; onChange(value: number): void;
}>) {
	return <label className="kw-audio-editor-dialog__field"><span>{label}</span><input required type="number" min={minimum} max={maximum} step={1} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} /></label>;
}

function TimeField({ name, label, value, sampleRate = 48_000, minimum, maximum, onChange }: Readonly<{
	name: string; label: string; value: number; sampleRate?: number; minimum: number; maximum: number;
	onChange(value: number): void;
}>) {
	return <label className="kw-audio-editor-dialog__field"><span>{label}</span>
		<AudioEditorTimeCodeInput name={name} label={label} value={value} unit="samples" rate={sampleRate}
			format="hh:mm:ss+milliseconds" minimum={minimum} maximum={maximum}
			onChange={onChange} />
	</label>;
}
