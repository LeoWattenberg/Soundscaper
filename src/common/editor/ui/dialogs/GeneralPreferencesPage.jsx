/* SPDX-License-Identifier: AGPL-3.0-only */

import { Separator } from '@soundscaper/design-system/Separator';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';

import { ROUTE_LOCALES } from '../../../i18n/locales.js';
import { productHref } from '../../../product-web-links.js';
import { AUDIO_EDITOR_DEFAULT_STARTUP_MODE } from '../../startup-preferences.ts';
import DesktopFfmpegPreferencePanel from './DesktopFfmpegPreferencePanel.tsx';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';

const STARTUP_RADIO_GROUP_NAME = 'audio-editor-program-start';

/**
 * Audacity's General preferences page: the interface language, and the
 * "Program start" choice of what the next session opens with.
 *
 * Audacity offers four start modes, two of which — an empty window and a new
 * score — differ only because Audacity can show a start screen with no project
 * loaded. This editor always has a project open, so those two collapse into the
 * single new-project mode here.
 *
 * The desktop build adds the FFmpeg location, which has nowhere else to live:
 * it is the only preference naming an executable the user installed, and it is
 * meaningless in a browser.
 *
 * The radios are native inputs inside their labels rather than the vendored
 * LabeledRadio, whose `role="radio"` wrapper holds a focusable input and
 * carries no accessible name — findings the editor's accessibility gate
 * refuses.
 */
export default function GeneralPreferencesPage({
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	productId,
	run,
}) {
	const startup = snapshot.preferences.startup
		|| { mode: AUDIO_EDITOR_DEFAULT_STARTUP_MODE, projectId: '' };
	const projects = snapshot.projects || [];
	const startupProjectId = startup.projectId && projects.some((project) => project.id === startup.projectId)
		? startup.projectId
		: projects[0]?.id || '';
	const updateStartup = (changes) => run(() => controller.actions.preferences.update({
		startup: { ...startup, ...changes },
	}));
	const selectLocale = (value) => {
		if (value === locale) return;
		if (fileService.isDesktop) {
			run(async () => {
				await controller.actions.project.flush();
				await fileService.setLocale(value);
			});
			return;
		}
		// The browser build serves one locale per route, the way the site's own
		// language menu switches it: save first, then navigate.
		run(async () => {
			await controller.actions.project.flush();
			globalThis.location?.assign(productHref(productId, value, {
				embedded: globalThis.document?.documentElement?.dataset?.embedded === 'true',
			}));
		});
	};
	const startupModes = [
		{ id: 'continue-last-session', label: copy.startupContinueLastSession },
		{ id: 'new-project', label: copy.startupNewProject },
		{ id: 'project', label: copy.startupProject, disabled: projects.length === 0 },
	];
	return (
		<div className="kw-audio-editor-preferences__general">
			<PreferencePanel title={copy.languageLabel}>
				<PreferenceDropdownField
					label={copy.languageLabel}
					value={locale}
					onChange={selectLocale}
					options={ROUTE_LOCALES.map((descriptor) => ({
						value: descriptor.locale,
						label: descriptor.nativeName,
					}))}
				/>
			</PreferencePanel>
			<Separator />
			<PreferencePanel title={copy.programStart}>
				<div
					className="kw-audio-editor-preferences__startup"
					role="radiogroup"
					aria-label={copy.programStart}
					data-program-start={startup.mode}
				>
					{startupModes.map((mode) => (
						<div key={mode.id} className="kw-audio-editor-preferences__startup-row">
							<label data-program-start-option={mode.id}>
								<input
									type="radio"
									name={STARTUP_RADIO_GROUP_NAME}
									value={mode.id}
									checked={startup.mode === mode.id}
									disabled={mode.disabled}
									onChange={() => updateStartup({ mode: mode.id, projectId: startupProjectId })}
								/>
								<span>{mode.label}</span>
							</label>
							{mode.id === 'project' && projects.length > 0 && (
								<PreferenceDropdownField
									label={copy.startupProjectSelect}
									visuallyHiddenLabel
									value={startupProjectId}
									onChange={(value) => updateStartup({ projectId: value })}
									options={projects.map((project) => ({ value: project.id, label: project.title }))}
								/>
							)}
						</div>
					))}
				</div>
			</PreferencePanel>
			{fileService.isDesktop && (
				<>
					<Separator />
					<DesktopFfmpegPreferencePanel fileService={fileService} copy={copy} />
				</>
			)}
		</div>
	);
}
