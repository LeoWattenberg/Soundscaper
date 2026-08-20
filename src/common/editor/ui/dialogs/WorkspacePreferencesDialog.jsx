import { useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	DialogSideNav,
	Dropdown,
	PreferencePanel,
	PreferenceThumbnail,
	Separator,
} from '@dilsonspickles/components';

import { ROUTE_LOCALES } from '../../../i18n/locales.js';
import { productProfile } from '../../../products.js';
import { collectAudacityShortcutCommands } from '../../audacity-action-parity.js';
import { iconNameToChar } from '../../audacity-iconcodes.js';
import { findAudioEditorShortcutConflicts, normalizeAudioEditorShortcut } from '../../preferences.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import SoundActivationPreferences from '../SoundActivationPreferences.tsx';
import { workspacePanelAvailable } from '../framescaper-capture-ui-model.ts';
import OfflineRuntimePreferencePanel from './OfflineRuntimePreferencePanel.tsx';
import {
	WORKSPACE_DOCK_IDS,
	WORKSPACE_PANEL_IDS,
	workspaceDockLabel,
	workspacePanelLabel,
} from '../workspace/workspace-panel-model.ts';

const SOUNDSCAPER_ONLY_SHORTCUT_IDS = new Set([
	'toggle-sound-activated-recording',
	'set-sound-activation-level',
]);

export default function WorkspacePreferencesDialog({
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	menus,
	run,
	initialPage = 'shortcuts',
	isPanelVisible = null,
	onTogglePanel,
	onClose,
	productId = 'soundscaper',
}) {
	const sideNavRef = useRef(null);
	const [selectedPage, setSelectedPage] = useState(preferencePage(initialPage));
	const [shortcutSearch, setShortcutSearch] = useState('');
	const [workspaceName, setWorkspaceName] = useState('');
	const preferences = snapshot.preferences;
	const commands = useMemo(() => collectAudacityShortcutCommands(menus, {
		locale,
		copy,
		disabledCommandIds: productProfile(productId).shortcuts.disabledCommandIds,
	}).filter((command) => (
		productId === 'soundscaper' || !SOUNDSCAPER_ONLY_SHORTCUT_IDS.has(command.id)
	)), [copy, locale, menus, productId]);
	const visibleCommands = commands.filter((command) => `${command.label} ${command.id}`.toLowerCase().includes(shortcutSearch.trim().toLowerCase()));
	const activeCustom = preferences.workspace.custom.find((workspace) => workspace.id === preferences.workspace.activeId);
	const pages = [
		{ id: 'appearance', label: copy.appearance, icon: iconNameToChar('BRUSH') },
		{ id: 'editing', label: copy.preferencesEditing, icon: iconNameToChar('WAVEFORM') },
		{ id: 'spectrogram', label: copy.panelSpectrogram, icon: iconNameToChar('SPECTROGRAM') },
		{ id: 'workspace', label: copy.workspace, icon: iconNameToChar('WORKSPACE') },
		{ id: 'panels', label: copy.panels, icon: iconNameToChar('SPLIT_VIEW_VERTICAL') },
		{ id: 'shortcuts', label: copy.shortcuts, icon: iconNameToChar('SHORTCUTS') },
		...(!fileService.isDesktop ? [{ id: 'offline', label: copy.offlineRuntime, icon: iconNameToChar('CLOUD_FILE') }] : []),
	];
	const selectedPageLabel = pages.find((page) => page.id === selectedPage)?.label || copy.preferencesTitle;
	const appearanceTheme = preferences.appearance.theme;
	const highContrastTheme = appearanceTheme.startsWith('high-contrast');
	const darkAppearanceTheme = appearanceTheme.endsWith('dark');
	const setAppearanceTheme = (theme) => run(() => controller.actions.preferences.setTheme(theme));
	const renderedThemeIsDark = () => darkAppearanceTheme
		|| (appearanceTheme === 'system' && document.documentElement.dataset.theme === 'dark');
	const selectedSpectrogramTrack = snapshot.project?.tracks.find((track) => (
		track.id === snapshot.selectedTrackId && track.type === 'audio'
	)) || null;
	const defaultSpectrogram = preferences.spectrogram;
	const spectrogram = { ...defaultSpectrogram, ...(selectedSpectrogramTrack?.spectrogram || {}) };
	const spectrogramSettingsDisabled = Boolean(selectedSpectrogramTrack && snapshot.readOnly);
	const spectrogramNyquist = Math.max(1, (snapshot.project?.sampleRate || 48_000) / 2);
	const updateSpectrogram = (changes) => run(() => selectedSpectrogramTrack
		? controller.actions.track.update(selectedSpectrogramTrack.id, {
			spectrogram: { ...spectrogram, ...changes },
		})
		: controller.actions.preferences.update({ spectrogram: changes }));
	const updateSpectrogramFrequency = (name, requestedValue) => {
		const value = Number(requestedValue);
		if (!Number.isFinite(value) || value < 0 || value > spectrogramNyquist) return;
		const next = { ...spectrogram, [name]: value };
		if (next.maximumFrequency <= next.minimumFrequency) return;
		updateSpectrogram({ [name]: value });
	};
	useEffect(() => setSelectedPage(preferencePage(initialPage)), [initialPage]);
	const handleSideNavKeyDown = (event) => {
		if (!event.target.closest('[role="tab"]') || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const currentIndex = Math.max(0, pages.findIndex((page) => page.id === selectedPage));
		const nextIndex = event.key === 'Home'
			? 0
			: event.key === 'End'
				? pages.length - 1
				: (currentIndex + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + pages.length) % pages.length;
		const nextPage = pages[nextIndex];
		setSelectedPage(nextPage.id);
		queueMicrotask(() => sideNavRef.current?.querySelector(`[aria-controls="dialog-panel-${nextPage.id}"]`)?.focus());
	};

	useEffect(() => {
		sideNavRef.current?.querySelectorAll('[role="tab"]').forEach((tab) => {
			tab.tabIndex = tab.getAttribute('aria-controls') === `dialog-panel-${selectedPage}` ? 0 : -1;
		});
	}, [selectedPage]);

	return (
		<AudioEditorDialogShell
			title={copy.preferencesTitle}
			onClose={onClose}
			width={900}
			initialFocus={initialPage === 'sound-activation' ? '[data-sound-activation-threshold]' : 'dialog'}
			className="kw-audio-editor-preferences"
			bodyClassName="kw-audio-editor-preferences__body"
			footer={<div className="kw-audio-editor-dialog__actions kw-audio-editor-preferences__footer"><Button onClick={onClose}>{copy.close}</Button></div>}
		>
					<div ref={sideNavRef} className="kw-audio-editor-preferences__sidebar-adapter" onKeyDownCapture={handleSideNavKeyDown}>
						<DialogSideNav
							items={pages}
							selectedId={selectedPage}
							onSelectId={setSelectedPage}
							ariaLabel={copy.preferencesTitle}
							className="kw-audio-editor-preferences__sidebar"
						/>
					</div>
					<main
						className="kw-audio-editor-preferences__page"
						role="tabpanel"
						id={`dialog-panel-${selectedPage}`}
						aria-label={selectedPageLabel}
					>
						{selectedPage === 'appearance' && (
							<div className="kw-audio-editor-preferences__appearance">
								{fileService.isDesktop && (
									<>
										<PreferencePanel title={copy.languageLabel}>
											<PreferenceDropdownField
												label={copy.languageLabel}
												value={locale}
												onChange={(value) => run(async () => {
													await controller.actions.project.flush();
													await fileService.setLocale(value);
												})}
												options={ROUTE_LOCALES.map((descriptor) => ({
													value: descriptor.locale,
													label: descriptor.nativeName,
												}))}
											/>
										</PreferencePanel>
										<Separator />
									</>
								)}
								<PreferencePanel title={highContrastTheme ? copy.highContrastTheme : copy.theme}>
									<div className="kw-audio-editor-preferences__thumbnails">
										<PreferenceChoice
											selectLabel={copy.selectPreference}
											src={preferencePreview(highContrastTheme ? 'high-contrast-light' : 'light')}
											alt={highContrastTheme ? copy.themeHighContrastLight : copy.themeLight}
											label={highContrastTheme ? copy.themeHighContrastLight : copy.themeLight}
											checked={appearanceTheme === (highContrastTheme ? 'high-contrast-light' : 'light')}
											onChange={(checked) => checked && setAppearanceTheme(highContrastTheme ? 'high-contrast-light' : 'light')}
											name="audio-editor-theme"
											value={highContrastTheme ? 'high-contrast-light' : 'light'}
										/>
										<PreferenceChoice
											selectLabel={copy.selectPreference}
											src={preferencePreview(highContrastTheme ? 'high-contrast-dark' : 'dark')}
											alt={highContrastTheme ? copy.themeHighContrastDark : copy.themeDark}
											label={highContrastTheme ? copy.themeHighContrastDark : copy.themeDark}
											checked={appearanceTheme === (highContrastTheme ? 'high-contrast-dark' : 'dark')}
											onChange={(checked) => checked && setAppearanceTheme(highContrastTheme ? 'high-contrast-dark' : 'dark')}
											name="audio-editor-theme"
											value={highContrastTheme ? 'high-contrast-dark' : 'dark'}
										/>
									</div>
									<div className="kw-audio-editor-preferences__appearance-checks">
										<PreferenceCheckbox
											label={copy.followSystemTheme}
											checked={appearanceTheme === 'system'}
											onChange={(checked) => setAppearanceTheme(checked ? 'system' : renderedThemeIsDark() ? 'dark' : 'light')}
										/>
										<PreferenceCheckbox
											label={copy.enableHighContrast}
											checked={highContrastTheme}
											onChange={(checked) => setAppearanceTheme(checked
												? renderedThemeIsDark() ? 'high-contrast-dark' : 'high-contrast-light'
												: renderedThemeIsDark() ? 'dark' : 'light')}
										/>
									</div>
								</PreferencePanel>
								<Separator />
								<PreferencePanel title={copy.clipStyle}>
									<div className="kw-audio-editor-preferences__thumbnails">
										<PreferenceChoice
											selectLabel={copy.selectPreference}
											src={preferencePreview('colorful')}
											alt={copy.clipStyleColorful}
											label={copy.clipStyleColorful}
											checked={preferences.appearance.clipStyle === 'colorful'}
											onChange={(checked) => checked && run(() => controller.actions.preferences.setClipStyle('colorful'))}
											name="audio-editor-clip-style"
											value="colorful"
										/>
										<PreferenceChoice
											selectLabel={copy.selectPreference}
											src={preferencePreview('classic')}
											alt={copy.clipStyleClassic}
											label={copy.clipStyleClassic}
											checked={preferences.appearance.clipStyle === 'classic'}
											onChange={(checked) => checked && run(() => controller.actions.preferences.setClipStyle('classic'))}
											name="audio-editor-clip-style"
											value="classic"
										/>
									</div>
								</PreferencePanel>
							</div>
						)}

						{selectedPage === 'workspace' && (
							<PreferencePanel title={copy.workspace}>
								<PreferenceDropdownField
									label={copy.workspacePreset}
									value={preferences.workspace.activeId}
									onChange={(value) => run(() => controller.actions.preferences.setWorkspace(value))}
									options={[
										{ value: 'modern', label: copy.workspaceModern },
										{ value: 'music', label: copy.workspaceMusic },
										{ value: 'classic', label: copy.workspaceClassic },
										{ value: 'video-editor', label: copy.workspaceVideo },
										...preferences.workspace.custom.map((workspace) => ({ value: workspace.id, label: workspace.name })),
									]}
								/>
								<label className="kw-audio-editor-preferences__workspace-name">
									<span>{copy.workspaceName}</span>
									<input aria-label={copy.workspaceName} placeholder={copy.workspaceName} value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} />
								</label>
								<div className="kw-audio-editor__custom-workspace-actions">
									<Button variant="secondary" disabled={!workspaceName.trim()} onClick={() => {
										run(() => controller.actions.preferences.createWorkspace(workspaceName.trim()));
										setWorkspaceName('');
									}}>{copy.workspaceCreate}</Button>
									<Button variant="secondary" disabled={!activeCustom} onClick={() => run(() => controller.actions.preferences.updateWorkspace(activeCustom.id, workspaceName.trim() ? { name: workspaceName.trim() } : {}))}>{copy.workspaceUpdate}</Button>
									<Button variant="secondary" disabled={!activeCustom} onClick={() => run(() => controller.actions.preferences.deleteWorkspace(activeCustom.id))}>{copy.workspaceDelete}</Button>
								</div>
							</PreferencePanel>
						)}

						{selectedPage === 'spectrogram' && (
							<PreferencePanel title={copy.panelSpectrogram}>
								<div className="kw-audio-editor__spectrogram-settings" data-spectrogram-settings data-spectrogram-target={selectedSpectrogramTrack?.id || 'defaults'}>
									<p data-spectrogram-target-name>{selectedSpectrogramTrack?.name || copy.spectrogramDefaults}</p>
									<label><span>{copy.spectrogramScale}</span>
										<select aria-label={copy.spectrogramScale} disabled={spectrogramSettingsDisabled} value={spectrogram.scale} onChange={(event) => updateSpectrogram({ scale: event.currentTarget.value })}>
											<option value="mel">{copy.spectrogramMel}</option><option value="linear">{copy.linear}</option><option value="log">{copy.logarithmic}</option>
										</select>
									</label>
									<label><span>{copy.minimumFrequency}</span><input aria-label={copy.minimumFrequency} disabled={spectrogramSettingsDisabled} type="number" min="0" max={Math.max(0, spectrogram.maximumFrequency - 1)} step="1" value={spectrogram.minimumFrequency} onChange={(event) => updateSpectrogramFrequency('minimumFrequency', event.currentTarget.value)} /></label>
									<label><span>{copy.maximumFrequency}</span><input aria-label={copy.maximumFrequency} disabled={spectrogramSettingsDisabled} type="number" min={Math.min(spectrogramNyquist, spectrogram.minimumFrequency + 1)} max={spectrogramNyquist} step="1" value={spectrogram.maximumFrequency} onChange={(event) => updateSpectrogramFrequency('maximumFrequency', event.currentTarget.value)} /></label>
									<label><span>{copy.spectrogramRange}</span><input aria-label={copy.spectrogramRange} disabled={spectrogramSettingsDisabled} type="number" min="1" max="240" value={spectrogram.range} onChange={(event) => {
										const value = Number(event.currentTarget.value);
										if (Number.isFinite(value) && value >= 1 && value <= 240) updateSpectrogram({ range: value });
									}} /></label>
									<label><span>{copy.spectrogramWindow}</span>
										<select aria-label={copy.spectrogramWindow} disabled={spectrogramSettingsDisabled} value={spectrogram.windowSize} onChange={(event) => updateSpectrogram({ windowSize: Number(event.currentTarget.value) })}>
											{[512, 1024, 2048, 4096, 8192].map((value) => <option key={value} value={value}>{value}</option>)}
										</select>
									</label>
									<label><span>{copy.spectrogramWindowType}</span>
										<select aria-label={copy.spectrogramWindowType} disabled={spectrogramSettingsDisabled} value={spectrogram.windowType} onChange={(event) => updateSpectrogram({ windowType: event.currentTarget.value })}>
											<option value="hann">{copy.spectrogramWindowHann}</option><option value="hamming">{copy.spectrogramWindowHamming}</option><option value="blackman">{copy.spectrogramWindowBlackman}</option>
										</select>
									</label>
								</div>
							</PreferencePanel>
						)}

						{selectedPage === 'editing' && (
							<>
								<PreferencePanel title={copy.preferencesEditing}>
									<div className="kw-audio-editor-preferences__grid">
										<PreferenceDropdownField
											label={copy.rippleEditing}
											value={preferences.editing.rippleMode}
											onChange={(value) => run(() => controller.actions.preferences.update({ editing: { rippleMode: value } }))}
											options={[
												{ value: 'off', label: copy.preferenceOff },
												{ value: 'per-track', label: copy.preferencePerTrack },
												{ value: 'all-tracks', label: copy.allTracks },
											]}
										/>
									</div>
									<div className="kw-audio-editor-preferences__checks">
										<PreferenceCheckbox
											label={copy.snapZeroCrossings}
											checked={preferences.editing.snapToZeroCrossings}
											onChange={(checked) => run(() => controller.actions.preferences.update({ editing: { snapToZeroCrossings: checked } }))}
										/>
									</div>
								</PreferencePanel>
								<Separator />
								<PreferencePanel title={copy.playAtSpeed}>
									<div className="kw-audio-editor-preferences__grid">
										<PreferenceDropdownField
											label={copy.playAtSpeedMode}
											value={preferences.playback?.playAtSpeedMode || 'naive'}
											onChange={(value) => run(() => controller.actions.preferences.update({ playback: { playAtSpeedMode: value } }))}
											options={[
												{ value: 'naive', label: copy.playAtSpeedNaive },
												{ value: 'staffpad', label: copy.playAtSpeedStaffPad },
											]}
										/>
									</div>
								</PreferencePanel>
								<Separator />
								<PreferencePanel title={copy.recordingPreferences}>
									<div className="kw-audio-editor-preferences__checks kw-audio-editor-preferences__recording">
										<PreferenceCheckbox
											label={copy.recordingKeepInputsOpen}
											checked={snapshot.recordingInputs?.retainInputs ?? preferences.recording?.retainInputs ?? true}
											onChange={(checked) => run(() => controller.actions.recording.setRetainInputs(checked))}
										/>
										<small>{copy.recordingKeepInputsOpenDescription}</small>
									</div>
									{snapshot.recordingInputs?.soundActivation && <SoundActivationPreferences
										productId={productId}
										locale={locale}
										readOnly={Boolean(snapshot.readOnly)}
										soundActivation={snapshot.recordingInputs.soundActivation}
										copy={copy}
										controller={controller}
										run={run}
									/>}
								</PreferencePanel>
							</>
						)}

						{selectedPage === 'panels' && (
							<PreferencePanel title={copy.panels}>
								<div className="kw-audio-editor-preferences__panel-list">
									{WORKSPACE_PANEL_IDS.filter((panelId) => workspacePanelAvailable(productId, panelId)).map((panelId) => {
										const panel = preferences.workspace.panels[panelId];
										const label = workspacePanelLabel(copy, panelId);
										return (
											<div key={panelId}>
												<PreferenceCheckbox
													label={label}
													checked={isPanelVisible ? isPanelVisible(panelId) : panel.visible}
													onChange={() => (
														onTogglePanel
															? onTogglePanel(panelId)
															: run(() => controller.actions.preferences.togglePanel(panelId))
													)}
												/>
												<PreferenceDropdownField
													label={`${label}: ${copy.panelDock}`}
													visuallyHiddenLabel
													value={panel.dock}
													onChange={(value) => run(() => controller.actions.preferences.setPanel(panelId, { dock: value }))}
													options={WORKSPACE_DOCK_IDS.map((dockId) => ({ value: dockId, label: workspaceDockLabel(copy, dockId) }))}
												/>
											</div>
										);
									})}
								</div>
							</PreferencePanel>
						)}

						{selectedPage === 'shortcuts' && (
							<PreferencePanel title={copy.shortcuts} className="kw-audio-editor-preferences__shortcuts">
								<label className="kw-audio-editor-preferences__search">
									<span className="kw-audio-editor-sr-only">{copy.shortcutSearch}</span>
									<input type="search" value={shortcutSearch} onChange={(event) => setShortcutSearch(event.currentTarget.value)} placeholder={copy.shortcutSearch} aria-label={copy.shortcutSearch} />
								</label>
								<div className="kw-audio-editor-preferences__shortcut-header" aria-hidden="true">
									<span>{copy.commandColumn}</span>
									<span>{copy.shortcutColumn}</span>
									<span>{copy.actionColumn}</span>
								</div>
								<div className="kw-audio-editor-preferences__shortcut-list">
									{visibleCommands.map((command) => <ShortcutEditorRow key={command.id} command={command} preferences={preferences} controller={controller} copy={copy} run={run} />)}
								</div>
								<Button variant="secondary" onClick={() => run(() => controller.actions.preferences.resetShortcuts())}>{copy.shortcutsReset}</Button>
							</PreferencePanel>
						)}

						{selectedPage === 'offline' && !fileService.isDesktop && (
							<OfflineRuntimePreferencePanel copy={copy} />
						)}
					</main>
		</AudioEditorDialogShell>
	);
}

function preferencePage(requestedPage) {
	return requestedPage === 'sound-activation' ? 'editing' : requestedPage;
}

function PreferenceDropdownField({ label, options, value, visuallyHiddenLabel = false, onChange }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-preferences__field" role="group" aria-label={label}>
			<span className={visuallyHiddenLabel ? 'kw-audio-editor-sr-only' : undefined}>{label}</span>
			<Dropdown options={options} value={value} onChange={onChange} width="100%" />
		</div>
	);
}

function PreferenceChoice({ selectLabel, label, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.preference-thumbnail__image-button')?.setAttribute(
			'aria-label',
			`${selectLabel}: ${label}`,
		);
	}, [label, selectLabel]);
	return <div ref={wrapperRef}><PreferenceThumbnail label={label} {...props} /></div>;
}

function preferencePreview(kind) {
	const dark = kind.includes('dark') || ['colorful', 'classic'].includes(kind);
	const contrast = kind.startsWith('high-contrast');
	const background = contrast ? dark ? '#000000' : '#ffffff' : dark ? '#202126' : '#f5f5f7';
	const surface = contrast ? dark ? '#111111' : '#ffffff' : dark ? '#303139' : '#ffffff';
	const line = contrast ? dark ? '#ffffff' : '#000000' : dark ? '#555861' : '#c9cbd2';
	const text = contrast ? dark ? '#ffffff' : '#000000' : dark ? '#e4e5e7' : '#25262b';
	const colorful = kind === 'colorful';
	const classic = kind === 'classic';
	const firstClip = colorful ? '#7c68ee' : classic ? '#6f737d' : '#6577df';
	const secondClip = colorful ? '#d65b91' : classic ? '#858995' : '#56a3a6';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 188 106">
		<rect width="188" height="106" rx="4" fill="${background}"/>
		<rect x="6" y="6" width="176" height="16" rx="2" fill="${surface}" stroke="${line}"/>
		<circle cx="15" cy="14" r="3" fill="${firstClip}"/><path d="M24 14h45m8 0h25" stroke="${text}" stroke-width="2" opacity=".7"/>
		<rect x="6" y="28" width="34" height="70" rx="2" fill="${surface}" stroke="${line}"/>
		<path d="M13 39h20M13 49h14M13 78h20M13 88h16" stroke="${text}" opacity=".55"/>
		<rect x="46" y="28" width="136" height="32" rx="3" fill="${firstClip}" opacity=".88"/>
		<rect x="64" y="65" width="102" height="33" rx="3" fill="${secondClip}" opacity=".88"/>
		<path d="M50 44l5-7 5 15 5-11 5 6 5-13 5 18 5-11 5 5 5-9 5 13 5-7 5 3 5-10 5 15 5-9 5 4 5-6 5 8 5-5 5 2 5-6 5 9" fill="none" stroke="${text}" stroke-width="1" opacity=".85"/>
		<path d="M68 82l5-5 5 11 5-8 5 4 5-10 5 15 5-8 5 3 5-6 5 9 5-5 5 2 5-7 5 11 5-6 5 3 5-5 5 7" fill="none" stroke="${text}" stroke-width="1" opacity=".85"/>
	</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function ShortcutEditorRow({ command, preferences, controller, copy, run }) {
	const preferenceId = command.id;
	const persisted = preferences.shortcuts[command.id]?.[0] || preferences.shortcuts[command.preferenceId]?.[0] || '';
	const [binding, setBinding] = useState(persisted);
	useEffect(() => setBinding(persisted), [persisted]);
	let normalized = '';
	let conflict = null;
	if (!command.disabled && binding.trim()) {
		try {
			normalized = normalizeAudioEditorShortcut(binding);
			const shortcuts = { ...preferences.shortcuts, [preferenceId]: [normalized] };
			conflict = findAudioEditorShortcutConflicts(shortcuts).find((entry) => entry.actionIds.includes(preferenceId)) || null;
		} catch {
			conflict = { binding, actionIds: [preferenceId] };
		}
	}
	const conflictAction = conflict?.actionIds.find((id) => id !== preferenceId);
	const error = conflict
		? (conflictAction
			? copy.shortcutConflict.replace('{binding}', conflict.binding).replace('{action}', conflictAction)
			: copy.shortcutInvalid)
		: '';
	return (
		<div
			className="kw-audio-editor-preferences__shortcut-row"
			data-shortcut-action={command.id}
			data-disabled-reason={command.disabledReason || undefined}
			aria-disabled={command.disabled ? 'true' : undefined}
			title={command.disabledReason || undefined}
		>
			<label><span>{command.label}</span><input disabled={command.disabled} value={binding} aria-invalid={error ? 'true' : 'false'} onChange={(event) => setBinding(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={command.disabled || Boolean(error) || normalized === persisted} onClick={() => run(() => controller.actions.preferences.setShortcut(preferenceId, normalized))}>{copy.shortcutAssign}</Button>
			{error && <small role="alert">{error}</small>}
			{command.disabledReason && <small data-shortcut-disabled-reason>{command.disabledReason}</small>}
		</div>
	);
}
