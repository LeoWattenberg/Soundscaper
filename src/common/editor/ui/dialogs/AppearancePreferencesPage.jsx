import { useEditorSkin } from '../skins/EditorSkinProvider.tsx';
import { appearancePreview } from '../skins/appearance-previews.ts';
import classicPreview from '../skins/previews/Classic.svg';
import colorfulPreview from '../skins/previews/Colorful.svg';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import PreferenceChoice from './PreferenceChoice.tsx';
import { Separator } from '@soundscaper/design-system/Separator';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';
import SkinPreferences from '../skins/SkinPreferences.tsx';

export default function AppearancePreferencesPage({ controller, preferences, copy, run }) {
	const { skin } = useEditorSkin();
	const preview = (kind) => appearancePreview(skin, kind.includes('dark') ? 'dark' : 'light', kind.startsWith('high-contrast'));
	const appearanceTheme = preferences.appearance.theme;
	const highContrastTheme = appearanceTheme.startsWith('high-contrast');
	const darkAppearanceTheme = appearanceTheme.endsWith('dark');
	const setAppearanceTheme = (theme) => run(() => controller.actions.preferences.setTheme(theme));
	const renderedThemeIsDark = () => darkAppearanceTheme
		|| (appearanceTheme === 'system' && document.documentElement.dataset.theme === 'dark');
	return (
		<div className="kw-audio-editor-preferences__appearance">
			<SkinPreferences controller={controller} copy={copy} run={run} savedSkin={preferences.appearance.skin} />
			<Separator />
			<PreferencePanel title={highContrastTheme ? copy.highContrastTheme : copy.theme}>
				<div className="kw-audio-editor-preferences__thumbnails">
					<PreferenceChoice
						selectLabel={copy.selectPreference}
						src={preview(highContrastTheme ? 'high-contrast-light' : 'light')}
						alt={highContrastTheme ? copy.themeHighContrastLight : copy.themeLight}
						label={highContrastTheme ? copy.themeHighContrastLight : copy.themeLight}
						checked={appearanceTheme === (highContrastTheme ? 'high-contrast-light' : 'light')}
						onChange={(checked) => checked && setAppearanceTheme(highContrastTheme ? 'high-contrast-light' : 'light')}
						name="audio-editor-theme"
						value={highContrastTheme ? 'high-contrast-light' : 'light'}
					/>
					<PreferenceChoice
						selectLabel={copy.selectPreference}
						src={preview(highContrastTheme ? 'high-contrast-dark' : 'dark')}
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
						src={colorfulPreview}
						alt={copy.clipStyleColorful}
						label={copy.clipStyleColorful}
						checked={preferences.appearance.clipStyle === 'colorful'}
						onChange={(checked) => checked && run(() => controller.actions.preferences.setClipStyle('colorful'))}
						name="audio-editor-clip-style"
						value="colorful"
					/>
					<PreferenceChoice
						selectLabel={copy.selectPreference}
						src={classicPreview}
						alt={copy.clipStyleClassic}
						label={copy.clipStyleClassic}
						checked={preferences.appearance.clipStyle === 'classic'}
						onChange={(checked) => checked && run(() => controller.actions.preferences.setClipStyle('classic'))}
						name="audio-editor-clip-style"
						value="classic"
					/>
				</div>
			</PreferencePanel>
			<Separator />
			<PreferencePanel title={copy.defaultTrackView}>
				<PreferenceDropdownField
					label={copy.defaultTrackView}
					visuallyHiddenLabel
					value={preferences.appearance.defaultView ?? 'waveform'}
					onChange={(value) => run(() => controller.actions.preferences.setDefaultView(value))}
					options={[
						{ value: 'waveform', label: copy.waveformView },
						{ value: 'spectrogram', label: copy.spectrogramView },
						{ value: 'multiview', label: copy.multiview },
					]}
				/>
				<p className="kw-audio-editor-preferences__note">{copy.defaultTrackViewNote}</p>
			</PreferencePanel>
			<Separator />
			<PreferencePanel title={copy.layout}>
				<PreferenceDropdownField
					label={copy.layout}
					visuallyHiddenLabel
					value={preferences.appearance.layout ?? 'auto'}
					onChange={(value) => run(() => controller.actions.preferences.setLayout(value))}
					options={[
						{ value: 'auto', label: copy.layoutAuto },
						{ value: 'compact', label: copy.layoutCompact },
						{ value: 'desktop', label: copy.layoutDesktop },
					]}
				/>
			</PreferencePanel>
		</div>
	);
}
