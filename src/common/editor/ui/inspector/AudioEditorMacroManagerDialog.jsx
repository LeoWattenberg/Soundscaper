import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { EffectSlot } from '@soundscaper/design-system/EffectsPanel/EffectSlot';
import { Icon } from '@soundscaper/design-system/Icon';
import { TextInput } from '@soundscaper/design-system/TextInput';
import { useContainerTabGroup } from '@soundscaper/design-system/hooks/useContainerTabGroup';
import { audioEffectTypes, createEffect } from '../../effects.js';
import { parseAudacityEffectMacro, serializeAudacityEffectMacro } from '../../effect-macros.js';
import {
	createEffectMacroTemplateDraft,
	effectMacroMissingEmbeddedNoiseProfile,
} from '../../effect-macro-templates.ts';
import { AUDIO_EDITOR_SAMPLE_RATE } from '../../project.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { takeSelectedFile } from '../file-input-selection.ts';
import EffectParameterEditor from './EffectParameterEditor.jsx';
import EffectPicker from './EffectPicker.jsx';
import { resolveEffectMacroTemplateCopy } from './effect-macro-template-copy.ts';
import { resolveSupportedEffectType, safeEffectLabel } from './effect-helpers.ts';
import { downloadTextFile, macroFileName } from './inspector-helpers.ts';

const MAX_MACRO_IMPORT_BYTES = 1024 * 1024;
const EMPTY_EFFECTS = Object.freeze([]);

export function AudioEditorMacroManagerDialog({
	isOpen,
	productId,
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	draft,
	onDraftChange,
	onClose,
}) {
	const project = snapshot.project;
	const projectIdentity = project?.id ?? null;
	const effects = draft?.effects || EMPTY_EFFECTS;
	// The caret menu swaps through Soundscaper's registry, not the sample set
	// the design-system package ships with.
	const replaceEffectOptions = useMemo(
		() => audioEffectTypes().map((type) => ({ id: type, name: safeEffectLabel(type, copy) })),
		[copy],
	);
	const templateCopy = resolveEffectMacroTemplateCopy(locale);
	const blocked = selectAudioEditorEditBlock(snapshot).blocked;
	const hasRunTarget = Boolean(snapshot.selection || snapshot.selectedClipId);
	const restorationAvailable = productId === 'soundscaper';
	const missingEmbeddedNoiseProfile = restorationAvailable
		&& effectMacroMissingEmbeddedNoiseProfile(effects);
	const [picker, setPicker] = useState(null);
	const [selectedEffectId, setSelectedEffectId] = useState(null);
	const [pendingTemplateId, setPendingTemplateId] = useState(null);
	const [draggedIndex, setDraggedIndex] = useState(null);
	const [message, setMessage] = useState('');
	const [messageState, setMessageState] = useState('info');
	const [isRunning, setIsRunning] = useState(false);
	const [isCapturingProfile, setIsCapturingProfile] = useState(false);
	const fileInputRef = useRef(null);
	const macroStackRef = useRef(null);
	const mountedRef = useRef(false);
	const operationSessionRef = useRef(null);
	const activeImportRef = useRef(null);
	const activeExportRef = useRef(null);
	const activeProfileRef = useRef(null);
	const runningRef = useRef(null);
	const stateProjectIdentityRef = useRef(projectIdentity);
	if (operationSessionRef.current?.projectIdentity !== projectIdentity
		|| operationSessionRef.current?.isOpen !== isOpen) {
		operationSessionRef.current = { projectIdentity, isOpen };
	}
	const selectedEffect = effects.find((effect) => effect.id === selectedEffectId) || null;
	const macroTabGroup = useContainerTabGroup({
		containerRef: macroStackRef,
		groupId: 'effects-panel',
		selector: '.effect-slot',
		ariaLabel: copy.macroManager,
		startTabIndex: 0,
	});
	const initMacroTabIndices = macroTabGroup.initTabIndices;

	useEffect(() => {
		if (selectedEffectId && !selectedEffect) setSelectedEffectId(null);
	}, [selectedEffect, selectedEffectId]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			activeImportRef.current = null;
			activeExportRef.current = null;
			activeProfileRef.current = null;
			runningRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!isOpen) {
			activeImportRef.current = null;
			activeExportRef.current = null;
			activeProfileRef.current = null;
			runningRef.current = null;
			setPicker(null);
			setSelectedEffectId(null);
			setPendingTemplateId(null);
			setMessage('');
			setIsRunning(false);
			setIsCapturingProfile(false);
		}
	}, [isOpen]);

	useLayoutEffect(() => {
		if (stateProjectIdentityRef.current === projectIdentity) return;
		stateProjectIdentityRef.current = projectIdentity;
		activeImportRef.current = null;
		activeExportRef.current = null;
		activeProfileRef.current = null;
		runningRef.current = null;
		setMessage('');
		setMessageState('info');
		setIsRunning(false);
		setIsCapturingProfile(false);
	}, [projectIdentity]);

	useLayoutEffect(() => {
		if (isOpen && !selectedEffect && !picker) initMacroTabIndices();
	}, [effects, initMacroTabIndices, isOpen, picker, selectedEffect]);

	const setDraft = (updater) => onDraftChange?.((current) => {
		const base = current || { name: copy.untitledMacro, effects: [] };
		return typeof updater === 'function' ? updater(base) : updater;
	});
	const setEffects = (nextEffects) => setDraft((current) => ({
		...current,
		effects: typeof nextEffects === 'function' ? nextEffects(current.effects || []) : nextEffects,
	}));
	const showMessage = (value, state = 'info') => {
		setMessage(value);
		setMessageState(state);
	};
	const startOperation = (activeRef) => {
		const operation = { session: operationSessionRef.current };
		activeRef.current = operation;
		return operation;
	};
	const ownsOperation = (activeRef, operation) => mountedRef.current
		&& activeRef.current === operation
		&& operationSessionRef.current === operation.session
		&& operation.session?.isOpen === true
		&& (controller.project?.id ?? null) === operation.session.projectIdentity;
	const updateEffect = (effectId, changes) => setEffects((current) => current.map((effect) => {
		if (effect.id !== effectId) return effect;
		const type = changes.type || effect.type;
		const preservedMetadata = changes.type ? {} : {
			...(effect.context !== undefined ? { context: effect.context } : {}),
			...(effect.state !== undefined ? { state: effect.state } : {}),
		};
		return createEffect(type, {
			id: effect.id,
			enabled: true,
			...preservedMetadata,
			...(changes.context !== undefined ? { context: changes.context } : {}),
			params: changes.type
				? changes.params
				: { ...effect.params, ...(changes.params || {}) },
		});
	}));
	const loadRestorationTemplate = () => {
		setDraft(createEffectMacroTemplateDraft('restoration'));
		setSelectedEffectId(null);
		setMessage('');
		setPendingTemplateId(null);
	};
	const requestRestorationTemplate = () => {
		const name = typeof draft?.name === 'string' ? draft.name.trim() : '';
		if (!effects.length && (!name || name === copy.untitledMacro)) {
			loadRestorationTemplate();
			return;
		}
		setPendingTemplateId('restoration');
	};
	const captureMacroNoiseProfile = async (effectId) => {
		if (activeProfileRef.current) return;
		const operation = startOperation(activeProfileRef);
		setIsCapturingProfile(true);
		try {
			const effect = effects.find((candidate) => candidate.id === effectId);
			if (!effect || effect.type !== 'audacity-noise-reduction') return;
			const profile = await controller.actions.effects.captureNoiseProfile(effect.params);
			if (!ownsOperation(activeProfileRef, operation)) return;
			if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
				throw new Error(copy.audacitySelectionHint || copy.rackNoiseProfileMissing);
			}
			setEffects((current) => current.map((effect) => effect.id === effectId
				? createEffect(effect.type, {
					id: effect.id,
					enabled: true,
					params: effect.params,
					context: { ...(effect.context || {}), noiseProfile: profile },
				})
				: effect));
		} catch (cause) {
			if (!ownsOperation(activeProfileRef, operation)) return;
			const detail = cause instanceof Error ? cause.message : String(cause);
			showMessage(`${copy.effectProcessingFailed || 'Noise profile capture failed.'} ${detail}`, 'error');
		} finally {
			if (ownsOperation(activeProfileRef, operation)) {
				activeProfileRef.current = null;
				setIsCapturingProfile(false);
			}
		}
	};
	const removeEffect = (effectId) => setEffects((current) => current.filter((effect) => effect.id !== effectId));
	const reorderEffect = (fromIndex, toIndex) => {
		if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= effects.length) return;
		setEffects((current) => {
			const next = [...current];
			const [effect] = next.splice(fromIndex, 1);
			next.splice(toIndex, 0, effect);
			return next;
		});
	};
	const replaceFromRegistry = (effect, candidate) => {
		const type = resolveSupportedEffectType(candidate, locale, copy);
		if (!type) {
			showMessage(copy.effectEngineUnsupported, 'error');
			return;
		}
		const replacement = createEffect(type, { id: effect.id });
		updateEffect(effect.id, { type, params: replacement.params });
	};
	const importMacro = async (file) => {
		if (!file) return;
		const operation = startOperation(activeImportRef);
		try {
			if (file.size > MAX_MACRO_IMPORT_BYTES) {
				throw new RangeError('File exceeds the 1 MiB macro import limit.');
			}
			const parsed = parseAudacityEffectMacro(await file.text());
			if (!ownsOperation(activeImportRef, operation)) return;
			setDraft((current) => {
				if (!ownsOperation(activeImportRef, operation)) return current;
				return {
					...current,
					name: file.name.replace(/\.txt$/i, '') || copy.untitledMacro,
					effects: [...parsed.effects],
				};
			});
			if (!ownsOperation(activeImportRef, operation)) return;
			const warning = parsed.ignoredCommands.length
				? ` ${copy.macroUnsupportedCommands.replace('{commands}', parsed.ignoredCommands.join(', '))}`
				: '';
			showMessage(`${copy.macroImported}${warning}`, parsed.ignoredCommands.length ? 'warning' : 'success');
		} catch (cause) {
			if (!ownsOperation(activeImportRef, operation)) return;
			const detail = cause instanceof Error ? cause.message : String(cause);
			showMessage(/no supported effects/i.test(detail)
				? copy.macroImportEmpty
				: copy.macroImportFailed.replace('{message}', detail), 'error');
		}
	};
	const exportMacro = async () => {
		const operation = startOperation(activeExportRef);
		try {
			const encoded = serializeAudacityEffectMacro(effects);
			const saved = await downloadTextFile(encoded, `${macroFileName(draft?.name || copy.untitledMacro)}.txt`, fileService, 'macro');
			if (!ownsOperation(activeExportRef, operation)) return;
			if (saved?.cancelled) return;
			showMessage(copy.macroExported, 'success');
		} catch (cause) {
			if (!ownsOperation(activeExportRef, operation)) return;
			const detail = cause instanceof Error ? cause.message : String(cause);
			showMessage(copy.macroExportFailed.replace('{message}', detail), 'error');
		}
	};
	const runMacro = async () => {
		if (runningRef.current) return;
		if (missingEmbeddedNoiseProfile) {
			showMessage(templateCopy.profileRequired, 'warning');
			return;
		}
		const operation = startOperation(runningRef);
		setIsRunning(true);
		showMessage(copy.macroProcessing);
		try {
			const applied = await controller.actions.macros.run({
				name: draft?.name || copy.untitledMacro,
				effects,
			});
			if (!ownsOperation(runningRef, operation)) return;
			if (applied) showMessage(copy.macroApplied, 'success');
		} catch (cause) {
			if (!ownsOperation(runningRef, operation)) return;
			const detail = cause instanceof Error ? cause.message : String(cause);
			showMessage(copy.macroRunFailed.replace('{message}', detail), 'error');
		} finally {
			if (ownsOperation(runningRef, operation)) {
				runningRef.current = null;
				setIsRunning(false);
			}
		}
	};

	return (
		<>
			<AudioEditorDialogShell
				isOpen={isOpen && !selectedEffect && !picker && !pendingTemplateId}
				title={copy.macroManager}
				onClose={onClose}
				width={680}
				className="audio-editor-macro-manager"
				dataAttributes={{ 'data-macro-manager': '' }}
				footer={(
					<DialogFooter
						className="audio-editor-dialog-footer audio-editor-macro-manager__footer"
						leftContent={(
							<Button
								variant="secondary"
								icon={<Icon name="plus" size={14} />}
								onClick={() => setPicker({ replaceId: null })}
							>{copy.effects}</Button>
						)}
						rightContent={(
							<div className="audio-editor-macro-manager__footer-actions">
								<div className="audio-editor-macro-manager__file-actions" role="group" aria-label={`${copy.importMacro} / ${copy.exportMacro}`}>
									<button className="audio-editor-macro-manager__icon-button audio-editor-macro-manager__icon-button--import" type="button" aria-label={copy.importMacro} title={copy.importMacro} onClick={() => fileInputRef.current?.click()}>
										<Icon name="export" size={16} />
									</button>
									<button className="audio-editor-macro-manager__icon-button" type="button" aria-label={copy.exportMacro} title={copy.exportMacro} disabled={!effects.length} onClick={exportMacro}>
										<Icon name="export" size={16} />
									</button>
								</div>
								<Button variant="primary" icon={<Icon name="play" size={14} />} disabled={blocked || isRunning || !hasRunTarget || !effects.length || missingEmbeddedNoiseProfile} onClick={runMacro}>{copy.runMacro}</Button>
							</div>
						)}
					/>
				)}
			>
				<section className="audio-editor-macro-manager__content">
					{restorationAvailable && <section className="audio-editor-macro-manager__templates" data-macro-templates>
						<h3>{templateCopy.templates}</h3>
						<Button variant="secondary" onClick={requestRestorationTemplate}>{templateCopy.restoration}</Button>
					</section>}
					<label className="audio-editor-field audio-editor-macro-manager__name">
						<span>{copy.macroName}</span>
						<TextInput value={draft?.name || ''} onChange={(name) => setDraft((current) => ({ ...current, name }))} width="100%" />
					</label>
					<div
						ref={macroStackRef}
						className="audio-editor-macro-manager__stack"
						{...macroTabGroup.containerProps}
						aria-label={copy.macroManager}
						onKeyDown={macroTabGroup.onKeyDown}
						onBlur={macroTabGroup.onBlur}
						onFocus={macroTabGroup.onFocus}
						onClickCapture={macroTabGroup.onClickCapture}
						data-macro-effect-stack
					>
						{effects.map((effect, index) => (
							<EffectSlot
								key={effect.id}
								className="audio-editor-macro-manager__effect"
								effectName={safeEffectLabel(effect, copy)}
								enabled
								isDragging={draggedIndex === index}
								onSelectEffect={() => setSelectedEffectId(effect.id)}
								onRemoveEffect={() => removeEffect(effect.id)}
								onReplaceEffect={(candidate) => replaceFromRegistry(effect, candidate)}
								replaceEffectOptions={replaceEffectOptions}
								onChangeEffect={() => setPicker({ replaceId: effect.id })}
								onDragStart={(event) => {
									setDraggedIndex(index);
									event.dataTransfer.effectAllowed = 'move';
								}}
								onDragOver={(event) => {
									event.preventDefault();
									if (draggedIndex === null || draggedIndex === index) return;
									reorderEffect(draggedIndex, index);
									setDraggedIndex(index);
								}}
								onDragEnd={() => setDraggedIndex(null)}
								onReorder={(direction) => reorderEffect(index, index + direction)}
							/>
						))}
						{!effects.length && <p className="audio-editor-panel-hint" data-macro-empty>{copy.macroEmptyHint}</p>}
					</div>
					{!hasRunTarget && <p className="audio-editor-panel-hint">{copy.macroSelectionHint}</p>}
					{missingEmbeddedNoiseProfile && <p className="audio-editor-panel-hint" data-macro-noise-profile-required>{templateCopy.profileRequired}</p>}
					{message && <p className={`audio-editor-macro-manager__message audio-editor-macro-manager__message--${messageState}`} role={messageState === 'error' ? 'alert' : 'status'}>{message}</p>}
					<input ref={fileInputRef} type="file" accept="text/plain,.txt" hidden data-macro-import-file onChange={(event) => { void importMacro(takeSelectedFile(event.currentTarget)); }} />
				</section>
			</AudioEditorDialogShell>

			{selectedEffect && (
				<AudioEditorDialogShell
					isOpen
					title={safeEffectLabel(selectedEffect, copy)}
					onClose={() => setSelectedEffectId(null)}
					width={selectedEffect.type === 'eq' ? 920 : 620}
					className="audio-editor-effect-settings-dialog audio-editor-macro-effect-settings-dialog"
					dataAttributes={{ 'data-macro-effect': selectedEffect.id }}
				>
					<section className="audio-editor-effect-settings">
						<EffectParameterEditor
							effect={selectedEffect}
							copy={copy}
							disabled={false}
							sampleRate={project?.sampleRate || AUDIO_EDITOR_SAMPLE_RATE}
							tracks={project?.tracks || []}
							targetTrackId={snapshot.selectedTrackId}
							hideControlTrack
							captureNoiseProfile={restorationAvailable && selectedEffect.type === 'audacity-noise-reduction'
								? () => captureMacroNoiseProfile(selectedEffect.id)
								: undefined}
							captureNoiseProfileDisabled={blocked || isCapturingProfile || !hasRunTarget}
							noiseProfileLabel={selectedEffect.context?.noiseProfile
								? copy.replaceNoiseProfile
								: copy.getNoiseProfile}
							onChange={(changes) => updateEffect(selectedEffect.id, changes)}
						/>
						{message && <p className={`audio-editor-macro-manager__message audio-editor-macro-manager__message--${messageState}`} role={messageState === 'error' ? 'alert' : 'status'}>{message}</p>}
					</section>
				</AudioEditorDialogShell>
			)}

			{picker && (
				<EffectPicker
					copy={copy}
					disabled={false}
					onClose={() => setPicker(null)}
					onChoose={(type) => {
						if (picker.replaceId) {
							const effect = effects.find((candidate) => candidate.id === picker.replaceId);
							if (effect) {
								const replacement = createEffect(type, { id: effect.id });
								updateEffect(effect.id, { type, params: replacement.params });
							}
						} else setEffects((current) => [...current, createEffect(type)]);
						setPicker(null);
					}}
				/>
			)}

			<AudioEditorDialogShell
				isOpen={isOpen && pendingTemplateId === 'restoration'}
				title={templateCopy.replaceTitle}
				onClose={() => setPendingTemplateId(null)}
				width={480}
				dataAttributes={{ 'data-macro-template-confirmation': 'restoration' }}
				footer={(
					<DialogFooter
						rightContent={(
							<div className="audio-editor-macro-manager__footer-actions">
								<Button variant="secondary" onClick={() => setPendingTemplateId(null)}>{copy.cancel}</Button>
								<Button variant="primary" onClick={loadRestorationTemplate}>{templateCopy.replaceAction}</Button>
							</div>
						)}
					/>
				)}
			>
				<p>{templateCopy.replaceDescription}</p>
			</AudioEditorDialogShell>
		</>
	);
}

export default AudioEditorMacroManagerDialog;
