import { useEffect, useRef, useState } from 'react';
import { Button, ContextMenu, ContextMenuItem, DialogHeader } from '@dilsonspickles/components';

import { AUDIO_EDITOR_TRACK_COLORS } from '../../project-v2.js';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import ProjectBinCard from './ProjectBinCard.jsx';
import { handoffLinkedAudioChoice } from './linked-audio-choice-handoff.ts';
import { projectBinColorName, projectBinItems } from './project-bin-model.ts';

const AUDIO_EDITOR_AUDIO_FILE_ACCEPT = 'audio/*,video/mp4,video/webm,.aac,.aif,.aiff,.flac,.m4a,.m4v,.mp2,.mp3,.mp4,.oga,.ogg,.opus,.rf64,.wav,.webm,.wv';

export default function ProjectBinPanel({ controller, snapshot, copy, locale, fileService, run, blocked }) {
	const inputRef = useRef(null);
	const replacementInputRef = useRef(null);
	const dragDepthRef = useRef(0);
	const linkedAudioRelinkRequestRef = useRef(0);
	const linkedAudioRelinkProjectRef = useRef(null);
	const [dropActive, setDropActive] = useState(false);
	const [itemMenu, setItemMenu] = useState(null);
	const [replacementClipId, setReplacementClipId] = useState(null);
	const [replacementChoice, setReplacementChoice] = useState(null);
	const [removeConfirmation, setRemoveConfirmation] = useState(null);
	const project = snapshot.project;
	const projectId = project?.id;
	const projectRevision = project?.revision;
	useEffect(() => {
		linkedAudioRelinkRequestRef.current += 1;
		setItemMenu(null);
		const relinkScope = Object.freeze({ projectId, projectRevision });
		linkedAudioRelinkProjectRef.current = relinkScope;
		return () => {
			linkedAudioRelinkRequestRef.current += 1;
			if (linkedAudioRelinkProjectRef.current === relinkScope) {
				linkedAudioRelinkProjectRef.current = null;
			}
		};
	}, [projectId, projectRevision]);
	const clips = project?.projectBin?.clips || [];
	const items = projectBinItems(clips);
	const sourceById = new Map((project?.sources || []).map((source) => [source.id, source]));
	const missingSourceIds = new Set(snapshot.missingSourceIds || []);
	const mutationBlocked = selectAudioEditorEditBlock(snapshot).blocked;
	const positionFrame = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => Math.max(0, Number(telemetry.positionFrame) || 0),
	);
	const selectedMediaTrack = project?.tracks.find((track) => (
		track.id === snapshot.selectedTrackId && ['audio', 'video'].includes(track.type)
	)) || null;
	const menuProjectCurrent = Boolean(itemMenu
		&& itemMenu.projectId === projectId
		&& itemMenu.projectRevision === projectRevision);
	const menuItem = menuProjectCurrent
		? items.find((item) => item.id === itemMenu.itemId) || null
		: null;
	const menuAudioClip = menuItem?.clips.find((clip) => clip.kind !== 'video') || null;
	const menuAudioRelinkEligible = Boolean(menuAudioClip
		&& itemMenu?.audioClipId === menuAudioClip.id
		&& itemMenu.linkedAudioRelinkEligible);
	const menuVideoClip = menuItem?.clips.find((clip) => clip.kind === 'video') || null;
	const menuVideoRelinkEligible = Boolean(menuVideoClip
		&& itemMenu?.videoClipId === menuVideoClip.id
		&& itemMenu.linkedVideoRelinkEligible);

	const importFiles = async (files) => {
		if (mutationBlocked || !files.length) return undefined;
		const projects = files.filter((file) => /\.aup[34]$/iu.test(file?.name || ''));
		const media = files.filter((file) => !/\.aup[34]$/iu.test(file?.name || ''));
		for (const projectFile of projects) await controller.actions.project.openAudacityProject(projectFile);
		if (media.length) return controller.actions.project.importFiles(media, { destination: 'project-bin' });
		return projects.length;
	};
	const chooseFiles = () => run(async () => {
		if (mutationBlocked) return;
		if (!fileService.isDesktop) {
			inputRef.current?.click();
			return;
		}
		const descriptors = await fileService.chooseFiles({ purpose: 'media', multiple: true });
		await fileService.withReadDescriptors(descriptors, {}, async (files) => {
			if (files.length) await importFiles(files);
		});
	});
	const chooseLinkedAudio = () => run(async () => {
		if (mutationBlocked) return;
		const choice = await fileService.chooseLinkedAudioOriginal();
		if (!choice) return;
		await controller.actions.project.importFiles([choice.file], {
			destination: 'project-bin',
			linkedAudioLocatorId: choice.locatorId,
			linkedAudioLocatorRevision: choice.locatorRevision,
		});
	});
	const chooseLinkedVideo = () => run(async () => {
		if (mutationBlocked) return;
		const choice = await fileService.chooseLinkedVideoOriginal();
		if (!choice) return;
		await controller.actions.project.importFiles([choice.file], {
			destination: 'project-bin',
			linkedVideoLocatorId: choice.locatorId,
			linkedVideoLocatorRevision: choice.locatorRevision,
		});
	});
	const relinkLinkedAudio = (clipId) => run(async () => {
		if (mutationBlocked) return;
		const relinkScope = linkedAudioRelinkProjectRef.current;
		if (!relinkScope) return;
		await handoffLinkedAudioChoice({
			choose: () => fileService.chooseLinkedAudioOriginal(),
			isCurrent: (scope) => linkedAudioRelinkProjectRef.current === scope,
			release: (reference) => fileService.releaseLinkedAudioOriginal(reference),
			accept: (file, reference) => controller.actions.projectBin.relinkLinkedAudio(clipId, file, reference, relinkScope),
		}, relinkScope);
	});
	const relinkLinkedVideo = (clipId) => run(async () => {
		if (mutationBlocked) return;
		const choice = await fileService.chooseLinkedVideoOriginal();
		if (!choice) return;
		await controller.actions.projectBin.relinkLinkedVideo(clipId, choice.file, {
			locatorId: choice.locatorId,
			locatorRevision: choice.locatorRevision,
		});
	});
	const isFileDrag = (dataTransfer) => {
		const types = [...(dataTransfer?.types || [])];
		return types.includes('Files') || [...(dataTransfer?.items || [])].some((item) => item.kind === 'file');
	};
	const resetDropState = (element = null) => {
		dragDepthRef.current = 0;
		setDropActive(false);
		element?.removeAttribute('data-drop-active');
	};
	const closeItemMenu = () => {
		linkedAudioRelinkRequestRef.current += 1;
		setItemMenu(null);
	};
	const openItemMenu = (event, item) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const audioClip = item.clips.find((clip) => clip.kind !== 'video') || null;
		const videoClip = item.clips.find((clip) => clip.kind === 'video') || null;
		const requestId = ++linkedAudioRelinkRequestRef.current;
		const requestedProjectId = projectId;
		const requestedProjectRevision = projectRevision;
		setItemMenu({
			itemId: item.id,
			audioClipId: audioClip?.id || null,
			videoClipId: videoClip?.id || null,
			linkedAudioRelinkEligible: false,
			linkedVideoRelinkEligible: false,
			projectId: requestedProjectId,
			projectRevision: requestedProjectRevision,
			requestId,
			x: rect.left,
			y: rect.bottom + 4,
		});
		const currentMenuRequest = (current) => Boolean(current
			&& current.requestId === requestId
			&& current.itemId === item.id
			&& current.projectId === requestedProjectId
			&& current.projectRevision === requestedProjectRevision);
		if (fileService.linkedAudioOriginalsAvailable && audioClip) {
			run(async () => {
				const eligible = await controller.actions.projectBin.canRelinkLinkedAudio(audioClip.id);
				if (requestId !== linkedAudioRelinkRequestRef.current) return;
				setItemMenu((current) => {
					if (!currentMenuRequest(current) || current.audioClipId !== audioClip.id) return current;
					return { ...current, linkedAudioRelinkEligible: eligible === true };
				});
			});
		}
		if (fileService.linkedVideoOriginalsAvailable && videoClip) {
			run(async () => {
				const eligible = await controller.actions.projectBin.canRelinkLinkedVideo(videoClip.id);
				if (requestId !== linkedAudioRelinkRequestRef.current) return;
				setItemMenu((current) => {
					if (!currentMenuRequest(current) || current.videoClipId !== videoClip.id) return current;
					return { ...current, linkedVideoRelinkEligible: eligible === true };
				});
			});
		}
	};
	const openReplacementPicker = (clipId) => {
		closeItemMenu();
		setReplacementClipId(clipId);
		replacementInputRef.current?.click();
	};
	const stageReplacement = async (clipId, file) => {
		const prepared = await controller.actions.projectBin.prepareReplacement(clipId, file);
		if (!prepared) return;
		if (prepared.requiresChoice) {
			setReplacementChoice(prepared);
			return;
		}
		controller.actions.projectBin.applyReplacement(prepared.token, 'keep-spacing');
	};
	const cancelReplacementChoice = () => {
		const token = replacementChoice?.token;
		setReplacementChoice(null);
		if (token) run(() => controller.actions.projectBin.cancelReplacement(token));
	};
	const applyReplacementChoice = (shortfallMode) => {
		const token = replacementChoice?.token;
		setReplacementChoice(null);
		if (token) run(() => controller.actions.projectBin.applyReplacement(token, shortfallMode));
	};

	return (
		<>
		<div
			className="kw-audio-editor__project-bin"
			data-project-bin-drop-target
			data-drop-active={dropActive ? 'true' : 'false'}
			data-project-bin-disabled={mutationBlocked ? 'true' : 'false'}
			aria-disabled={mutationBlocked ? 'true' : undefined}
			onDragEnter={(event) => {
				if (mutationBlocked || !isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				dragDepthRef.current += 1;
				setDropActive(true);
			}}
			onDragOver={(event) => {
				if (mutationBlocked || !isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = 'copy';
				setDropActive(true);
			}}
			onDragLeave={(event) => {
				if (!isFileDrag(event.dataTransfer)) return;
				event.stopPropagation();
				dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
				if (!dragDepthRef.current) setDropActive(false);
			}}
			onDrop={(event) => {
				if (!isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				resetDropState(event.currentTarget);
				if (mutationBlocked) return;
				const files = [...(event.dataTransfer.files || [])];
				if (files.length) run(() => importFiles(files));
			}}
		>
			<input
				ref={inputRef}
				className="kw-audio-editor__file-input"
				data-project-bin-input
				aria-label={copy.projectBinImport}
				type="file"
				tabIndex={-1}
				accept={AUDIO_EDITOR_AUDIO_FILE_ACCEPT}
				multiple
				onChange={(event) => {
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					if (files.length) run(() => importFiles(files));
				}}
			/>
			<input
				ref={replacementInputRef}
				className="kw-audio-editor__file-input"
				data-project-bin-replacement-input
				aria-label={copy.projectBinReplace}
				type="file"
				tabIndex={-1}
				accept={AUDIO_EDITOR_AUDIO_FILE_ACCEPT}
				onChange={(event) => {
					const file = event.currentTarget.files?.[0] || null;
					event.currentTarget.value = '';
					const clipId = replacementClipId;
					setReplacementClipId(null);
					if (file && clipId) run(() => stageReplacement(clipId, file));
				}}
			/>
			<div className="kw-audio-editor__project-bin-import" data-project-bin-import>
				<div aria-hidden="true" className="kw-audio-editor__project-bin-import-icon">+</div>
				<p>
					<strong>{copy.projectBinDropTitle}</strong>
					<span>{copy.projectBinDropHint}</span>
				</p>
				<Button variant="secondary" disabled={mutationBlocked} onClick={chooseFiles}>
					{copy.projectBinImport}
				</Button>
				{fileService.linkedAudioOriginalsAvailable && (
					<Button variant="secondary" disabled={mutationBlocked} onClick={chooseLinkedAudio}>
						{copy.projectBinLinkAudio}
					</Button>
				)}
				{fileService.linkedVideoOriginalsAvailable && (
					<Button variant="secondary" disabled={mutationBlocked} onClick={chooseLinkedVideo}>
						{copy.projectBinLinkVideo}
					</Button>
				)}
			</div>
			{snapshot.readOnly && (
				<p className="kw-audio-editor__project-bin-notice" role="status">{copy.projectBinReadOnly}</p>
			)}
			{!snapshot.readOnly && blocked && (
				<p className="kw-audio-editor__project-bin-notice" role="status">{copy.projectBinBusy}</p>
			)}
			{items.length ? (
				<ul className="kw-audio-editor__project-bin-list" data-project-bin-list>
					{items.map((item) => (
						<ProjectBinCard
							key={item.id}
							clip={item.primaryClip}
							itemClips={item.clips}
							source={sourceById.get(item.primaryClip.sourceId) || null}
							sources={item.clips.map((clip) => sourceById.get(clip.sourceId) || null)}
							project={project}
							controller={controller}
							copy={copy}
							locale={locale}
							mutationBlocked={mutationBlocked}
							missing={item.clips.some((clip) => missingSourceIds.has(clip.sourceId))}
							selectedMediaTrack={selectedMediaTrack}
							positionFrame={positionFrame}
							preview={snapshot.projectBinPreview}
							run={run}
							onOpenMenu={(event) => openItemMenu(event, item)}
							onDragEnd={(element) => resetDropState(element)}
						/>
					))}
				</ul>
			) : (
				<p className="kw-audio-editor__panel-empty kw-audio-editor__project-bin-empty">
					{copy.projectBinEmpty}
				</p>
			)}
		</div>
		<ContextMenu
			isOpen={Boolean(itemMenu && menuItem)}
			x={itemMenu?.x || 0}
			y={itemMenu?.y || 0}
			autoFocus
			onClose={closeItemMenu}
			className="kw-audio-editor__project-bin-menu"
		>
			<ContextMenuItem label={copy.clipColor} hasSubmenu onClose={closeItemMenu}>
				{AUDIO_EDITOR_TRACK_COLORS.map((color) => (
					<ContextMenuItem
						key={color}
						label={projectBinColorName(copy, color)}
						checked={menuItem?.primaryClip.color === color}
						disabled={mutationBlocked}
						onClick={() => {
							if (menuItem) run(() => controller.actions.projectBin.setColor(menuItem.primaryClip.id, color));
						}}
						onClose={closeItemMenu}
					/>
				))}
			</ContextMenuItem>
			<ContextMenuItem isDivider />
			<ContextMenuItem
				label={copy.projectBinRemoveFromBin}
				disabled={mutationBlocked}
				onClick={() => menuItem && run(() => controller.actions.projectBin.removeFromBin(menuItem.primaryClip.id))}
				onClose={closeItemMenu}
			/>
			<ContextMenuItem
				label={copy.projectBinRemoveFromProject}
				disabled={mutationBlocked}
				onClick={() => {
					if (menuItem) setRemoveConfirmation({
						clipId: menuItem.primaryClip.id,
						name: menuItem.primaryClip.title || copy.clip,
						count: controller.actions.projectBin.instanceCount(menuItem.primaryClip.id),
					});
				}}
				onClose={closeItemMenu}
			/>
			<ContextMenuItem
				label={copy.projectBinReplace}
				disabled={mutationBlocked || !menuItem || menuItem.clips.some((clip) => missingSourceIds.has(clip.sourceId))}
				onClick={() => menuItem && openReplacementPicker(menuItem.primaryClip.id)}
				onClose={closeItemMenu}
			/>
			{fileService.linkedAudioOriginalsAvailable && menuAudioRelinkEligible && (
				<ContextMenuItem
					label={copy.projectBinRelink}
					disabled={mutationBlocked}
					onClick={() => menuAudioClip && relinkLinkedAudio(menuAudioClip.id)}
					onClose={closeItemMenu}
				/>
			)}
			{fileService.linkedVideoOriginalsAvailable && menuVideoRelinkEligible && (
				<ContextMenuItem
					label={copy.projectBinRelink}
					disabled={mutationBlocked}
					onClick={() => menuVideoClip && relinkLinkedVideo(menuVideoClip.id)}
					onClose={closeItemMenu}
				/>
			)}
		</ContextMenu>
		{removeConfirmation && (
			<div className="kw-audio-editor-dialog-backdrop" data-project-bin-remove-dialog>
				<div className="kw-audio-editor-dialog kw-audio-editor__project-bin-confirm" role="alertdialog" aria-modal="true" aria-labelledby="project-bin-remove-title">
					<DialogHeader title={copy.projectBinRemoveFromProject} onClose={() => setRemoveConfirmation(null)} />
					<div className="kw-audio-editor-dialog__body">
						<p id="project-bin-remove-title">
							{copy.projectBinRemoveConfirm
								.replace('{name}', removeConfirmation.name)
								.replace('{count}', String(removeConfirmation.count))}
						</p>
						<div className="kw-audio-editor-dialog__actions">
							<Button variant="secondary" onClick={() => setRemoveConfirmation(null)}>{copy.cancel}</Button>
							<Button variant="primary" onClick={() => {
								const clipId = removeConfirmation.clipId;
								setRemoveConfirmation(null);
								run(() => controller.actions.projectBin.removeFromProject(clipId));
							}}>{copy.projectBinRemoveFromProject}</Button>
						</div>
					</div>
				</div>
			</div>
		)}
		{replacementChoice && (
			<div className="kw-audio-editor-dialog-backdrop" data-project-bin-replacement-dialog>
				<div className="kw-audio-editor-dialog kw-audio-editor__project-bin-confirm" role="alertdialog" aria-modal="true" aria-labelledby="project-bin-replacement-title">
					<DialogHeader title={copy.projectBinReplacementShortTitle} onClose={cancelReplacementChoice} />
					<div className="kw-audio-editor-dialog__body">
						<p id="project-bin-replacement-title">{copy.projectBinReplacementShortMessage}</p>
						<div className="kw-audio-editor-dialog__actions">
							<Button variant="secondary" onClick={cancelReplacementChoice}>{copy.cancel}</Button>
							<Button variant="secondary" onClick={() => applyReplacementChoice('keep-spacing')}>{copy.projectBinKeepSpacing}</Button>
							<Button variant="primary" onClick={() => applyReplacementChoice('contract-gaps')}>{copy.projectBinContractGaps}</Button>
						</div>
					</div>
				</div>
			</div>
		)}
		</>
	);
}
