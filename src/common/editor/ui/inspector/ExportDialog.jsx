import { useEffect, useMemo, useState } from 'react';
import {
	Button,
	DialogFooter,
	ProgressBar,
	Separator,
	TextInput,
} from '@dilsonspickles/components';
import { MEDIA_EXPORT_FORMATS } from '../../media-export.js';
import AdmMetadataFields from '../AdmMetadataFields.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import BextMetadataFields from '../BextMetadataFields.tsx';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import MetadataEditorTabs from '../MetadataEditorTabs.tsx';
import VideoDeliveryFields from '../VideoDeliveryFields.jsx';
import { createProjectAdmEditorValue } from '../adm-metadata-editor-model.ts';
import {
	dialogSettingsFromDeliveryTarget,
	statedVideoCanvas,
	statedVideoDeliveryTarget,
} from '../export-preset-model.ts';
import { createBextMetadataEditorValue } from '../bext-metadata-editor-model.ts';
import {
	VIDEO_EXPORT_DIALOG_FORMATS,
	createExportDialogRequest,
	isVideoExportDialogFormat,
	projectHasTimelineVideo,
} from '../export-dialog-model.js';
import { framescaperV27CaptionDeliveryUnavailable } from '../video-caption-delivery-surface.ts';
import { DesignCheckbox, LabeledDropdown } from './inspector-controls.jsx';
import ExportPresetSection from './ExportPresetSection.jsx';
import {
	dialogSettingsFromPreset,
	presetFormatFromDialog,
	presetSettingsFromDialog,
} from '../export-preset-model.ts';
import {
	compactFields,
	parseJsonChannelMapping,
	parseJsonObject,
} from './inspector-helpers.ts';
import {
	createDesktopExportCodecQuery, desktopExportCodecCapabilities,
	desktopExportFlacSampleFormats, desktopExportFormatAvailable, desktopExportFormatReason,
	desktopExportSelectionReason,
	desktopExportWavPackCompressionLevels,
} from '../desktop-export-codec-model.ts';
import {
	constrainExportDialogSampleRate, exportDialogBitRateOptions,
	exportDialogBitRateSelectionReason,
	exportDialogMaximumAudioSampleRate, exportDialogSampleRateSuggestions,
	exportDialogVorbisQualityOptions,
} from '../export-dialog-audio-codec-options.ts';

export function ExportDialog({ isOpen, controller, snapshot, copy, productId, fileService, onClose }) {
	const exportProgress = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.exportProgress);
	const [metadataOpen, setMetadataOpen] = useState(false);
	const [metadataTab, setMetadataTab] = useState('general');
	const [settings, setSettings] = useState({
		mode: 'mix',
		range: 'project',
		format: 'wav',
		sampleFormat: 'int24',
		bitRate: '192',
		compressionLevel: '5',
		sampleRate: String(snapshot.project?.sampleRate || 48_000),
		channelMapping: 'preserve',
		channelMatrix: '',
		dither: 'triangular',
		loudnessNormalization: '',
		quality: '5',
		metadataTitle: snapshot.project?.metadata?.title || snapshot.project?.title || '',
		metadataArtist: snapshot.project?.metadata?.artist || '',
		metadataAlbum: snapshot.project?.metadata?.album || '',
		metadataTrack: snapshot.project?.metadata?.trackNumber || '',
		metadataYear: snapshot.project?.metadata?.year || '',
		metadataGenre: snapshot.project?.metadata?.genre || '',
		metadataComments: snapshot.project?.metadata?.comments || '',
		metadataCopyright: snapshot.project?.metadata?.copyright || '',
		metadataCustom: JSON.stringify(snapshot.project?.metadata?.tags || {}, null, 2),
		bext: createBextMetadataEditorValue(snapshot.project),
		adm: createProjectAdmEditorValue(snapshot.project),
		customExtension: '',
		customMimeType: 'application/octet-stream',
		customArguments: '',
		includeTail: true,
		binaural: false,
		masteringSequenceId: '',
		canvasWidth: '',
		canvasHeight: '',
		canvasFit: 'contain',
		canvasFrameRate: '',
		canvasBackgroundColor: '',
		videoQuality: 'balanced',
		videoAudioLayout: 'preserve',
		captionTrackId: '',
		captionDelivery: 'mux',
		captionBurnIn: false,
		deliveryTarget: '',
	});
	const [error, setError] = useState('');
	const [presetId, setPresetId] = useState('');
	const [presetName, setPresetName] = useState('');
	const [desktopCodecStatus, setDesktopCodecStatus] = useState(null);
	const desktop = fileService?.isDesktop === true;
	const desktopCodecQuery = useMemo(() => {
		if (!desktop) return null;
		try { return createDesktopExportCodecQuery({
			sampleRate: settings.sampleRate, channelMapping: settings.channelMapping,
			channelMatrix: settings.channelMatrix, binaural: settings.binaural,
		}, snapshot.project?.masterChannels || 2); }
		catch { return false; }
	}, [desktop, settings.binaural, settings.channelMapping, settings.channelMatrix,
		settings.sampleRate, snapshot.project?.masterChannels]);
	const desktopCodecCapabilities = useMemo(() => {
		if (!desktopCodecQuery) return null;
		return desktopCodecStatus?.query === desktopCodecQuery
			? desktopCodecStatus.capabilities
			: desktopExportCodecCapabilities(null, desktopCodecQuery);
	}, [desktopCodecQuery, desktopCodecStatus]);
	const presetKind = isVideoExportDialogFormat(settings.format) ? 'video' : 'audio';
	const presets = controller.actions.export.presets.list(presetKind);
	const presetActions = {
		onApply: (id) => {
			setPresetId(id);
			if (!id) return;
			const preset = controller.actions.export.presets.apply(id);
			setPresetName(preset.label);
			setSettings((current) => ({ ...current, ...dialogSettingsFromPreset(preset) }));
		},
		onNameChange: setPresetName,
		onSave: async () => {
			const preset = await controller.actions.export.presets.save({
				...(presetId ? { id: presetId } : {}),
				label: presetName.trim(),
				kind: presetKind,
				format: presetFormatFromDialog(settings.format, presetKind),
				settings: presetSettingsFromDialog(settings, presetKind),
			});
			setPresetId(preset.id);
			setPresetName(preset.label);
		},
		onDelete: async () => {
			await controller.actions.export.presets.delete(presetId);
			setPresetId('');
			setPresetName('');
		},
		onImport: async (file) => { await controller.actions.export.presets.import(await file.text()); },
		onExport: () => controller.actions.export.presets.saveToFile(presetId),
	};
	const hasSelection = Boolean(snapshot.selection);
	const hasLoop = Boolean(snapshot.project?.loop?.enabled);
	const exporting = Boolean(snapshot.exporting);
	const progress = Math.round(Math.max(0, Math.min(1, exportProgress ?? snapshot.export?.progress ?? 0)) * 100);
	const output = snapshot.export?.output;
	const blocked = !snapshot.ready || snapshot.importing || snapshot.recording || snapshot.processingEffect || snapshot.missingSourceIds?.length > 0 || !snapshot.project?.clips?.length;
	const hasTimelineVideo = projectHasTimelineVideo(snapshot.project);
	const videoFormat = isVideoExportDialogFormat(settings.format);
	const captionDeliveryUnavailable = framescaperV27CaptionDeliveryUnavailable(
		productId, snapshot.project,
	);
	// Generic video delivery captions from label tracks. Selected Framescaper owns its
	// explicit caption tracks and sidecar export through the gated menu surface.
	const labelTracks = (snapshot.project?.tracks || []).filter((track) => track?.type === 'label');
	const admRequired = settings.format === 'bw64' && settings.adm == null;
	const admPassthrough = settings.format === 'bw64' && settings.adm?.mode === 'passthrough';
	// Only an authored programme carries the positions a binaural render places
	// from, and only outside BW64, whose metadata would describe channels the
	// delivery no longer has.
	const binauralAvailable = settings.format !== 'bw64'
		&& !videoFormat
		&& settings.mode === 'mix'
		&& settings.adm?.mode === 'authored';
	// A sequence delivers one spliced artifact, so it cannot also be a stem set,
	// an ADM programme, or a sub-range of the project.
	const projectMasteringSequences = snapshot.masteringSequences?.sequences;
	const masteringSequences = useMemo(() => (
		settings.mode === 'stems' || settings.format === 'bw64'
			? []
			: projectMasteringSequences ?? []
	), [projectMasteringSequences, settings.format, settings.mode]);
	const rangeValue = settings.masteringSequenceId
		? `mastering-sequence:${settings.masteringSequenceId}`
		: settings.range;
	const chooseRange = (value) => setSettings((current) => (
		value.startsWith('mastering-sequence:')
			? { ...current, range: 'project', masteringSequenceId: value.slice('mastering-sequence:'.length) }
			: { ...current, range: value, masteringSequenceId: '' }
	));

	useEffect(() => {
		if (!isOpen || !desktopCodecQuery) { setDesktopCodecStatus(null); return undefined; }
		let current = true;
		setDesktopCodecStatus(null);
		Promise.resolve().then(() => fileService.getDesktopAudioCodecCapabilities(desktopCodecQuery))
			.then((result) => desktopExportCodecCapabilities(result ?? null, desktopCodecQuery))
			.then((capabilities) => { if (current) setDesktopCodecStatus({ query: desktopCodecQuery, capabilities }); })
			.catch(() => { if (current) setDesktopCodecStatus(null); });
		return () => { current = false; };
	}, [desktopCodecQuery, fileService, isOpen]);

	useEffect(() => {
		if (!hasSelection && settings.range === 'selection') setSettings((current) => ({ ...current, range: 'project' }));
	}, [hasSelection, settings.range]);

	useEffect(() => {
		// A sequence chosen and then made undeliverable — a stem mode, an ADM
		// format, a deleted region — falls back to the ordinary range rather than
		// starting a delivery that would refuse.
		if (!settings.masteringSequenceId) return;
		const chosen = masteringSequences.find(({ id }) => id === settings.masteringSequenceId);
		if (!chosen?.deliverable) setSettings((current) => ({ ...current, masteringSequenceId: '' }));
	}, [masteringSequences, settings.masteringSequenceId]);

	useEffect(() => {
		if (!isOpen) {
			setMetadataOpen(false);
			setMetadataTab('general');
		}
	}, [isOpen]);

	useEffect(() => {
		if (!['bwf', 'bw64'].includes(settings.format) && metadataTab === 'bext') setMetadataTab('general');
		if (settings.format !== 'bw64' && metadataTab === 'adm') setMetadataTab('general');
	}, [metadataTab, settings.format]);

	useEffect(() => {
		if (!hasTimelineVideo && isVideoExportDialogFormat(settings.format)) {
			setSettings((current) => ({ ...current, format: 'wav' }));
			return;
		}
		const descriptor = MEDIA_EXPORT_FORMATS[settings.format];
		const sampleFormats = desktop && settings.format === 'flac'
			? desktopExportFlacSampleFormats(desktopCodecCapabilities)
			: descriptor?.sampleFormats;
		if (sampleFormats?.length && !sampleFormats.includes(settings.sampleFormat)) {
			setSettings((current) => ({ ...current, sampleFormat: sampleFormats[0] }));
		} else if (settings.sampleFormat === 'float32' && settings.dither !== 'none') {
			setSettings((current) => ({ ...current, dither: 'none' }));
		}
	}, [desktop, desktopCodecCapabilities, hasTimelineVideo, settings.dither, settings.format, settings.sampleFormat]);

	const set = (name, value) => setSettings((current) => ({ ...current, [name]: value }));
	// A delivery target states the container it delivers, so the format control
	// has to follow it: the request already does, and a dropdown still reading
	// MP4 while a WebM lands is the dialog telling the operator something untrue.
	// The preview follows the delivery while this dialog is open, so a 9:16
	// reframing can be judged before the render rather than after it.
	useEffect(() => {
		if (!videoFormat) {
			controller.actions.export.previewDeliveryCanvas(null);
			return undefined;
		}
		const canvas = statedVideoCanvas(settings);
		const target = statedVideoDeliveryTarget(settings);
		const targetCanvas = target?.options.canvas;
		const merged = targetCanvas && typeof targetCanvas === 'object'
			? { ...targetCanvas, ...canvas }
			: canvas;
		controller.actions.export.previewDeliveryCanvas(Object.keys(merged).length > 0 ? merged : null);
		return () => controller.actions.export.previewDeliveryCanvas(null);
	}, [controller, settings, videoFormat]);

	const setVideoDeliverySetting = (name, value) => {
		if (name !== 'deliveryTarget') return set(name, value);
		const patch = dialogSettingsFromDeliveryTarget(value);
		return setSettings((current) => ({ ...current, ...patch, deliveryTarget: value }));
	};
	const setFormat = (format) => setSettings((current) => {
		const passthrough = format === 'bw64' && current.adm?.mode === 'passthrough';
		return {
			...current,
			format,
			mode: format === 'bw64' ? 'mix' : current.mode,
			range: passthrough ? 'project' : current.range,
			sampleFormat: passthrough
				? `int${current.adm.geometry.bitDepth}`
				: MEDIA_EXPORT_FORMATS[format]?.defaults?.sampleFormat || current.sampleFormat,
			sampleRate: passthrough
				? String(current.adm.geometry.sampleRate)
				: constrainExportDialogSampleRate(current.sampleRate, format, desktop),
			bitRate: format === 'opus' ? '160' : format === 'mp2' ? '256' : ['mp3', 'aac-m4a'].includes(format) ? '192' : current.bitRate,
			compressionLevel: format === 'flac' ? '5' : format === 'wavpack' ? '2' : current.compressionLevel,
			channelMapping: format === 'bw64'
				? 'preserve'
				: format === 'bwf' ? 'stereo' : current.channelMapping,
			dither: passthrough ? 'none' : current.dither,
			includeTail: passthrough ? false : current.includeTail,
			// A binaural delivery is two channels, so a BW64 container would keep
			// describing a programme the file no longer carries.
			binaural: format === 'bw64' ? false : current.binaural,
		};
	});
	const start = () => {
		try {
			setError('');
			if (desktopFormatRefusal) throw new Error(desktopFormatRefusal);
			const customMetadata = parseJsonObject(settings.metadataCustom, copy.customMetadata, copy);
			const metadata = compactFields({
				...customMetadata,
				title: settings.metadataTitle,
				artist: settings.metadataArtist,
				album: settings.metadataAlbum,
				trackNumber: settings.metadataTrack,
				year: settings.metadataYear,
				genre: settings.metadataGenre,
				comments: settings.metadataComments,
				copyright: settings.metadataCopyright,
			});
			const request = createExportDialogRequest(settings, {
				metadata,
				bext: settings.bext,
				adm: settings.adm,
				channelMapping: videoFormat
					? undefined
					: settings.channelMapping === 'custom'
						? parseJsonChannelMapping(settings.channelMatrix, copy.customChannelMapping, copy)
						: settings.channelMapping,
			});
			Promise.resolve(controller.actions.export.start(request)).catch((cause) => {
				setError(cause instanceof Error ? cause.message : String(cause));
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const formatQualityOptions = exportDialogBitRateOptions(settings.format, desktop, settings.sampleRate, desktopCodecQuery?.operations?.[0]?.channelCount);
	const maximumAudioSampleRate = exportDialogMaximumAudioSampleRate(settings.format, desktop);
	const formatDescriptor = MEDIA_EXPORT_FORMATS[settings.format];
	const sampleFormatOptions = desktop && settings.format === 'flac'
		? desktopExportFlacSampleFormats(desktopCodecCapabilities)
		: formatDescriptor?.sampleFormats || [];
	const desktopFormatRefusal = desktop
		? desktopExportSelectionReason(settings, desktopCodecCapabilities, desktopCodecQuery === false)
			|| exportDialogBitRateSelectionReason(settings.format, settings.bitRate, formatQualityOptions, desktop)
		: null;
	const desktopCodecNotice = desktopFormatRefusal || (desktopCodecQuery === false
		? desktopExportFormatReason('opus', null, true)
		: Object.values(desktopCodecCapabilities?.formats || {}).find((capability) => (
			!capability.available && capability.reason?.includes('Preferences > General')
		))?.reason || null);
	const audioFormatDescriptors = Object.values(MEDIA_EXPORT_FORMATS).filter((descriptor) => (
		!desktop || desktopExportFormatAvailable(descriptor.id, desktopCodecCapabilities)
	));
	const pcmFormat = Boolean(formatDescriptor?.sampleFormats?.length);
	const bitrateFormat = ['mp3', 'opus', 'mp2', 'aac-m4a'].includes(settings.format);
	const requestClose = () => {
		if (metadataOpen) {
			setMetadataOpen(false);
			return;
		}
		if (!exporting) onClose?.();
	};
	const metadataFields = [
		['metadataTitle', copy.metadataTitle],
		['metadataArtist', copy.metadataArtist],
		['metadataAlbum', copy.metadataAlbum],
		['metadataTrack', copy.metadataTrack],
		['metadataYear', copy.metadataYear],
		['metadataGenre', copy.metadataGenre],
		['metadataComments', copy.metadataComments],
		['metadataCopyright', copy.metadataCopyright],
	];

	if (metadataOpen) {
		return (
			<AudioEditorDialogShell
				isOpen={isOpen}
				title={copy.metadata}
				onClose={() => setMetadataOpen(false)}
				width={760}
				className="audio-editor-metadata-dialog"
				dataAttributes={{ 'data-export-metadata-dialog': '' }}
				footer={(
					<DialogFooter
						className="audio-editor-dialog-footer"
						rightContent={<Button variant="primary" onClick={() => setMetadataOpen(false)}>{copy.done}</Button>}
					/>
				)}
			>
				<section className="audio-editor-metadata-editor">
					<MetadataEditorTabs
						activeTab={metadataTab}
						showBext={['bwf', 'bw64'].includes(settings.format)}
						showAdm={settings.format === 'bw64'}
						copy={copy}
						onChange={setMetadataTab}
					/>
					<div
						role="tabpanel"
						aria-label={metadataTab === 'bext'
							? copy.metadataBextTab
							: metadataTab === 'adm' ? copy.metadataAdmTab : copy.metadataGeneralTab}
						data-export-metadata-tab={metadataTab}
					>
						{metadataTab === 'bext' ? (
							<>
								<p className="audio-editor-panel-hint">{copy.bextExportHint}</p>
								<BextMetadataFields
									value={settings.bext}
									copy={copy}
									onCommit={(value) => set('bext', value)}
								/>
							</>
						) : metadataTab === 'adm' ? (
							<>
								<p className="audio-editor-panel-hint">{copy.admExportHint}</p>
								<AdmMetadataFields
									value={settings.adm}
									project={snapshot.project}
									copy={copy}
									onCommit={(value) => set('adm', value)}
								/>
							</>
						) : (
							<>
								<p className="audio-editor-panel-hint">{copy.metadataFormatHint}</p>
								<div className="audio-editor-metadata-table" role="table" aria-label={copy.metadata}>
									<div className="audio-editor-metadata-table__header" role="row">
										<span role="columnheader">{copy.metadataTagColumn}</span>
										<span role="columnheader">{copy.metadataValueColumn}</span>
									</div>
									{metadataFields.map(([name, label]) => (
										<label className="audio-editor-metadata-table__row" role="row" key={name}>
											<span role="cell">{label}</span>
											<span role="cell"><TextInput multiline={name === 'metadataComments'} value={settings[name]} onChange={(value) => set(name, value)} width="100%" /></span>
										</label>
									))}
								</div>
								<details className="audio-editor-export-details">
									<summary>{copy.customMetadata}</summary>
									<label className="audio-editor-field">
										<span>{copy.customMetadata}</span>
										<TextInput multiline value={settings.metadataCustom} onChange={(value) => set('metadataCustom', value)} width="100%" />
									</label>
								</details>
							</>
						)}
					</div>
				</section>
			</AudioEditorDialogShell>
		);
	}

	return (
		<AudioEditorDialogShell
			isOpen={isOpen}
			title={copy.exportDialog || copy.export}
			onClose={requestClose}
			closeOnEscape={!exporting}
			closeOnOutside={!exporting}
			width={640}
			className="audio-editor-export-dialog"
			dataAttributes={{ 'data-export-dialog': '' }}
			footer={(
				<DialogFooter
					className="audio-editor-dialog-footer"
					leftContent={<Button variant="secondary" disabled={exporting} onClick={() => setMetadataOpen(true)}>{copy.metadata}</Button>}
					rightContent={exporting ? (
						<span data-export-action="cancel"><Button disabled={!exporting} onClick={() => controller.actions.export.cancel()}>{copy.cancelExport}</Button></span>
					) : (
						<>
							<Button variant="secondary" onClick={requestClose}>{copy.cancel}</Button>
							<span data-export-action="start"><Button variant="primary" disabled={blocked || admRequired || Boolean(desktopFormatRefusal)} onClick={start}>{copy.startExport}</Button></span>
						</>
					)}
				/>
			)}
		>
			<div className="audio-editor-export-dialog__body">
				<ExportPresetSection
					copy={copy}
					presets={presets}
					selectedId={presetId}
					presetName={presetName}
					disabled={exporting || blocked}
					onError={(cause) => setError(
						cause == null ? '' : (cause instanceof Error ? cause.message : String(cause)),
					)}
					{...presetActions}
				/>
				<Separator />
				<section className="audio-editor-export-section">
					<h3>{copy.exportSection}</h3>
					<LabeledDropdown label={copy.exportMode} hook="mode" value={videoFormat ? 'mix' : settings.mode} onChange={(value) => set('mode', value)} disabled={exporting || videoFormat || settings.format === 'bw64'} options={[{ value: 'mix', label: copy.mix }, { value: 'stems', label: copy.stems }]} />
					<LabeledDropdown label={copy.exportRange} hook="range" value={rangeValue} onChange={chooseRange} disabled={exporting || admPassthrough} options={[
						{ value: 'project', label: copy.entireProject },
						{ value: 'selection', label: copy.currentSelection, disabled: !hasSelection },
						{ value: 'loop', label: copy.loopRegion, disabled: !hasLoop },
						...masteringSequences.map((sequence) => ({
							value: `mastering-sequence:${sequence.id}`,
							label: sequence.name,
							disabled: !sequence.deliverable,
						})),
					]} />
				</section>
				<Separator />
				<section className="audio-editor-export-section">
					<h3>{videoFormat ? (copy.videoOptionsSection || copy.videoTrack) : copy.audioOptionsSection}</h3>
					<LabeledDropdown label={copy.format} hook="format" value={settings.format} onChange={setFormat} disabled={exporting} options={[
						...audioFormatDescriptors.map((descriptor) => ({
							value: descriptor.id,
							label: descriptor.id === 'custom-ffmpeg'
								? copy.customFfmpeg
								: descriptor.id === 'bwf' ? copy.broadcastWav : descriptor.label,
						})),
						...(hasTimelineVideo ? VIDEO_EXPORT_DIALOG_FORMATS.map((descriptor) => ({
							value: descriptor.id,
							label: copy[descriptor.labelKey],
						})) : []),
					]} />
					{!videoFormat && (pcmFormat ? (
						<LabeledDropdown label={copy.sampleFormat || copy.bitDepth} hook="bitDepth" value={settings.sampleFormat} onChange={(value) => set('sampleFormat', value)} disabled={exporting || admPassthrough} options={sampleFormatOptions.map((sampleFormat) => ({
							value: sampleFormat,
							label: sampleFormat === 'float32'
								? copy.sampleFormatFloat32
								: copy.sampleFormatPcm.replace('{bits}', sampleFormat.slice(3)),
						}))} />
					) : bitrateFormat ? (
						<LabeledDropdown label={copy.quality} hook="quality" value={settings.bitRate} onChange={(value) => set('bitRate', value)} disabled={exporting} options={formatQualityOptions} />
					) : settings.format === 'ogg-vorbis' ? (
						<LabeledDropdown label={copy.quality} hook="quality" value={settings.quality} onChange={(value) => set('quality', value)} disabled={exporting} options={exportDialogVorbisQualityOptions(desktop)} />
					) : null)}
					{!videoFormat && ['flac', 'wavpack'].includes(settings.format) && (
						<LabeledDropdown label={copy.quality} hook="quality" value={settings.compressionLevel} onChange={(value) => set('compressionLevel', value)} disabled={exporting} options={(settings.format === 'wavpack' && desktop ? desktopExportWavPackCompressionLevels(desktopCodecCapabilities) : Array.from({ length: settings.format === 'flac' ? 9 : 6 }, (_, level) => level)).map((level) => ({ value: String(level), label: `${copy.level} ${level}` }))} />
					)}
					{!videoFormat && <label className="audio-editor-field" data-export-field="sampleRate"><span>{copy.sampleRate}</span><input type="number" min="8000" max={maximumAudioSampleRate} step="1" list="audio-editor-export-rates" value={settings.sampleRate} disabled={exporting || admPassthrough} onChange={(event) => set('sampleRate', event.currentTarget.value)} /><datalist id="audio-editor-export-rates">{exportDialogSampleRateSuggestions(maximumAudioSampleRate, snapshot.project?.sampleRate, settings.format, desktop).map((value) => <option key={value} value={value} />)}</datalist></label>}
					{!videoFormat && <LabeledDropdown label={copy.channelMapping} hook="channelMapping" value={settings.channelMapping} onChange={(value) => set('channelMapping', value)} disabled={exporting || settings.format === 'bw64'} options={[{ value: 'preserve', label: copy.preserveChannels }, { value: 'mono', label: copy.mono }, { value: 'stereo', label: copy.stereo }, { value: 'custom', label: copy.customChannelMapping }]} />}
					{!videoFormat && pcmFormat && settings.sampleFormat !== 'float32' && <LabeledDropdown label={copy.dither} hook="dither" value={settings.dither} onChange={(value) => set('dither', value)} disabled={exporting || admPassthrough} options={[{ value: 'none', label: copy.none }, { value: 'triangular', label: copy.triangularDither }, { value: 'triangular-highpass', label: copy.highpassDither }]} />}
					{/* A delivery normalizes only when a target is chosen: there is no
						default, and stems and ADM passthrough refuse it outright. */}
					{!videoFormat && settings.mode !== 'stems' && <LabeledDropdown label={copy.loudnessNormalization} hook="loudnessNormalization" value={settings.loudnessNormalization} onChange={(value) => set('loudnessNormalization', value)} disabled={exporting || admPassthrough} options={[{ value: '', label: copy.loudnessNormalizationNone }, { value: 'ebu-r128', label: copy.loudnessNormalizationR128 }, { value: 'atsc-a85', label: copy.loudnessNormalizationA85 }, { value: 'streaming-14', label: copy.loudnessNormalizationStreaming }]} />}
					{!videoFormat && settings.channelMapping === 'custom' && <label className="audio-editor-field"><span>{copy.customChannelMapping}</span><span><TextInput multiline value={settings.channelMatrix} disabled={exporting} onChange={(value) => set('channelMatrix', value)} width="100%" /><small>{copy.customChannelMappingHint}</small></span></label>}
					{videoFormat && (
						<VideoDeliveryFields
							copy={copy}
							disabled={exporting}
							labelTracks={labelTracks}
							settings={settings}
							onChange={setVideoDeliverySetting}
							captionDeliveryUnavailable={captionDeliveryUnavailable}
						/>
					)}
				</section>
				{!videoFormat && (
					<>
						<Separator />
						<section className="audio-editor-export-section">
							<h3>{copy.renderingSection}</h3>
							<div className="audio-editor-export-check" data-export-field="tails">
								<span aria-hidden="true" />
								<DesignCheckbox label={copy.includeTails} checked={settings.includeTail} disabled={exporting || admPassthrough} onChange={(checked) => set('includeTail', checked)} />
							</div>
							{binauralAvailable && (
								<div className="audio-editor-export-check" data-export-field="binaural">
									<span aria-hidden="true" />
									<DesignCheckbox label={copy.binauralRender} checked={settings.binaural} disabled={exporting} onChange={(checked) => set('binaural', checked)} />
								</div>
							)}
							{binauralAvailable && settings.binaural && <p className="audio-editor-panel-hint">{copy.binauralRenderHint}</p>}
						</section>
					</>
				)}
				{settings.format === 'custom-ffmpeg' && (
					<>
						<Separator />
						<details className="audio-editor-export-details" open>
							<summary>{copy.advancedOptions}</summary>
							<div className="audio-editor-export-section">
								<label className="audio-editor-field"><span>{copy.customExtension}</span><TextInput value={settings.customExtension} disabled={exporting} onChange={(value) => set('customExtension', value)} width="100%" /></label>
								<label className="audio-editor-field"><span>{copy.customMimeType}</span><TextInput value={settings.customMimeType} disabled={exporting} onChange={(value) => set('customMimeType', value)} width="100%" /></label>
								<label className="audio-editor-field"><span>{copy.customArguments}</span><TextInput multiline value={settings.customArguments} disabled={exporting} onChange={(value) => set('customArguments', value)} width="100%" /></label>
							</div>
						</details>
					</>
				)}
				<p className="audio-editor-panel-hint">{copy.exportHint}</p>
				{desktopCodecNotice && <p className="audio-editor-panel-hint" data-desktop-codec-status>{desktopCodecNotice}</p>}
				{admRequired && <p className="audio-editor-field-error" role="alert">{copy.bw64AdmRequired}</p>}
				<div className="audio-editor-export-progress" data-export-progress aria-live="polite" hidden={!exporting}>
					<ProgressBar value={progress} width="100%" />
					<output>{progress}%</output>
				</div>
				{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
				<a
					className="audio-editor-export-download"
					data-export-download
					href={output?.url || '#'}
					download={output?.fileName || ''}
					hidden={!output?.url}
				>{output?.fileName || copy.done}</a>
			</div>
		</AudioEditorDialogShell>
	);
}

export default ExportDialog;
