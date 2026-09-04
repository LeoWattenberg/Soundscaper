import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { Icon } from '@soundscaper/design-system/Icon';
import { TextInput } from '@soundscaper/design-system/TextInput';
import { createEffectMacroStep, effectMacroStepTypes } from '../../effect-macro-steps.ts';
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
import MacroManagerLibraryList from './MacroManagerLibraryList.jsx';
import MacroManagerStepList from './MacroManagerStepList.jsx';
import { resolveEffectMacroTemplateCopy } from './effect-macro-template-copy.ts';
import { resolveSupportedEffectType, safeEffectLabel } from './effect-helpers.ts';
import { downloadTextFile, macroFileName } from './inspector-helpers.ts';

const MAX_MACRO_IMPORT_BYTES = 1024 * 1024;
const EMPTY_EFFECTS = Object.freeze([]);
const EMPTY_MACROS = Object.freeze([]);

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
	const library = controller.actions.macros.library;
	const macros = snapshot.macros?.library || EMPTY_MACROS;
	const effects = draft?.effects || EMPTY_EFFECTS;
	// A macro runs its steps over the selection, so it offers every effect the
	// editor has rather than only the ones the realtime rack can stream.
	const macroEffectTypes = useMemo(() => effectMacroStepTypes(), []);
	// The caret menu swaps through Soundscaper's registry, not the sample set
	// the design-system package ships with.
	const replaceEffectOptions = useMemo(
		() => macroEffectTypes.map((type) => ({ id: type, name: safeEffectLabel(type, copy) })),
		[copy, macroEffectTypes],
	);
	const templateCopy = resolveEffectMacroTemplateCopy(locale);
	const blocked = selectAudioEditorEditBlock(snapshot).blocked;
	const hasRunTarget = Boolean(snapshot.selection || snapshot.selectedClipId);
	const restorationAvailable = productId === 'soundscaper';
	const missingEmbeddedNoiseProfile = restorationAvailable
		&& effectMacroMissingEmbeddedNoiseProfile(effects);
	const [selectedEffectId, setSelectedEffectId] = useState(null);
	const [message, setMessage] = useState('');
	const [messageState, setMessageState] = useState('info');
	const [isRunning, setIsRunning] = useState(false);
	const [isCapturingProfile, setIsCapturingProfile] = useState(false);
	const fileInputRef = useRef(null);
	const mountedRef = useRef(false);
	const operationSessionRef = useRef(null);
	const activeImportRef = useRef(null);
	const activeExportRef = useRef(null);
	const activeProfileRef = useRef(null);
	const runningRef = useRef(null);
	const stateProjectIdentityRef = useRef(projectIdentity);
	// Async work resumes against whatever the manager is editing now, not the
	// draft that was open when it started.
	const draftRef = useRef(draft);
	draftRef.current = draft;
	if (operationSessionRef.current?.projectIdentity !== projectIdentity
		|| operationSessionRef.current?.isOpen !== isOpen) {
		operationSessionRef.current = { projectIdentity, isOpen };
	}
	const selectedEffect = effects.find((effect) => effect.id === selectedEffectId) || null;

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
			setSelectedEffectId(null);
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

	// A macro the library no longer holds cannot be edited, so the manager opens
	// on the first saved macro instead of on a draft with nowhere to save to.
	useEffect(() => {
		if (!isOpen) return;
		if (draft && macros.some((macro) => macro.id === draft.id)) return;
		onDraftChange?.(macros[0] || null);
	}, [draft, isOpen, macros, onDraftChange]);

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
	/** Publishes an edit to the open macro and stores it under the same name. */
	const writeDraft = (updater) => {
		const base = draftRef.current;
		if (!base) return;
		const next = typeof updater === 'function' ? updater(base) : updater;
		draftRef.current = next;
		onDraftChange?.(next);
		// A half-typed name is not storable; the next keystroke that leaves one
		// behind saves the macro, and the library keeps the last stored name.
		if (String(next.name ?? '').trim()) library.save(next);
	};
	const openMacro = (macro) => {
		draftRef.current = macro;
		onDraftChange?.(macro);
		setSelectedEffectId(null);
		setMessage('');
	};
	const setEffects = (nextEffects) => writeDraft((current) => ({
		...current,
		effects: typeof nextEffects === 'function' ? nextEffects(current.effects || []) : nextEffects,
	}));
	const createMacro = (macro) => {
		try {
			openMacro(library.save(macro));
		} catch (cause) {
			showMessage(cause instanceof Error ? cause.message : String(cause), 'error');
		}
	};
	const deleteMacro = () => {
		const current = draftRef.current;
		if (!current) return;
		const index = macros.findIndex((macro) => macro.id === current.id);
		library.delete(current.id);
		openMacro(macros[index + 1] || macros[index - 1] || null);
	};
	const updateEffect = (effectId, changes) => setEffects((current) => current.map((effect) => {
		if (effect.id !== effectId) return effect;
		const type = changes.type || effect.type;
		const preservedMetadata = changes.type ? {} : {
			...(effect.context !== undefined ? { context: effect.context } : {}),
			...(effect.state !== undefined ? { state: effect.state } : {}),
		};
		return createEffectMacroStep(type, {
			id: effect.id,
			enabled: true,
			...preservedMetadata,
			...(changes.context !== undefined ? { context: changes.context } : {}),
			params: changes.type
				? changes.params
				: { ...effect.params, ...(changes.params || {}) },
		});
	}));
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
				? createEffectMacroStep(effect.type, {
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
	const replaceFromRegistry = (effectId, candidate) => {
		const type = resolveSupportedEffectType(candidate, locale, copy, macroEffectTypes);
		if (!type) {
			showMessage(copy.effectEngineUnsupported, 'error');
			return;
		}
		changeEffectType(effectId, type);
	};
	const changeEffectType = (effectId, type) => {
		const replacement = createEffectMacroStep(type, { id: effectId });
		updateEffect(effectId, { type, params: replacement.params });
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
			createMacro({
				name: file.name.replace(/\.txt$/i, '') || copy.untitledMacro,
				effects: [...parsed.effects],
			});
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
				isOpen={isOpen && !selectedEffect}
				title={copy.macroManager}
				onClose={onClose}
				width={860}
				className="audio-editor-macro-manager"
				dataAttributes={{ 'data-macro-manager': '' }}
				footer={(
					<DialogFooter
						className="audio-editor-dialog-footer audio-editor-macro-manager__footer"
						rightContent={(
							<Button variant="primary" icon={<Icon name="play" size={14} />} disabled={blocked || isRunning || !hasRunTarget || !effects.length || missingEmbeddedNoiseProfile} onClick={runMacro}>{copy.runMacro}</Button>
						)}
					/>
				)}
			>
				<section className="audio-editor-macro-manager__content">
					<MacroManagerLibraryList
						copy={copy}
						macros={macros}
						selectedId={draft?.id || null}
						exportDisabled={!effects.length}
						templates={restorationAvailable ? {
							heading: templateCopy.templates,
							restoration: templateCopy.restoration,
							onCreateRestoration: () => createMacro(createEffectMacroTemplateDraft('restoration')),
						} : null}
						onSelect={(macroId) => openMacro(macros.find((macro) => macro.id === macroId) || null)}
						onCreate={() => createMacro({ name: copy.untitledMacro, effects: [] })}
						onDelete={deleteMacro}
						onExport={exportMacro}
						onImport={() => fileInputRef.current?.click()}
					/>
					<section className="audio-editor-macro-manager__detail">
						{draft ? <>
							<label className="audio-editor-field audio-editor-macro-manager__name">
								<span>{copy.macroName}</span>
								<TextInput value={draft.name || ''} onChange={(name) => writeDraft((current) => ({ ...current, name }))} width="100%" />
							</label>
							<MacroManagerStepList
								copy={copy}
								effects={effects}
								effectTypes={macroEffectTypes}
								replaceEffectOptions={replaceEffectOptions}
								onAddEffect={(type) => setEffects((current) => [...current, createEffectMacroStep(type)])}
								onChangeEffect={changeEffectType}
								onRemoveEffect={(effectId) => setEffects((current) => current.filter((effect) => effect.id !== effectId))}
								onReorderEffect={(fromIndex, toIndex) => setEffects((current) => {
									if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= current.length) return current;
									const next = [...current];
									const [effect] = next.splice(fromIndex, 1);
									next.splice(toIndex, 0, effect);
									return next;
								})}
								onReplaceEffect={replaceFromRegistry}
								onSelectEffect={setSelectedEffectId}
							/>
						</> : <p className="audio-editor-panel-hint" data-macro-unselected>{copy.macroNotSelected}</p>}
						{!hasRunTarget && <p className="audio-editor-panel-hint">{copy.macroSelectionHint}</p>}
						{missingEmbeddedNoiseProfile && <p className="audio-editor-panel-hint" data-macro-noise-profile-required>{templateCopy.profileRequired}</p>}
						{message && <p className={`audio-editor-macro-manager__message audio-editor-macro-manager__message--${messageState}`} role={messageState === 'error' ? 'alert' : 'status'}>{message}</p>}
					</section>
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
		</>
	);
}

export default AudioEditorMacroManagerDialog;
