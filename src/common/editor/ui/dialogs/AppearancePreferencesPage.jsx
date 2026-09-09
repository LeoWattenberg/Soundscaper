import { useEditorSkin } from '../skins/EditorSkinProvider.tsx';
import { resolveSkinTheme } from '../skins/skin-themes.ts';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import PreferenceChoice from './PreferenceChoice.tsx';
import { Separator } from '@soundscaper/design-system/Separator';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';
import SkinPreferences from '../skins/SkinPreferences.tsx';

export default function AppearancePreferencesPage({ controller, preferences, copy, run }) {
	const { skin } = useEditorSkin();
	const preview = (kind) => preferencePreview(kind, skin);
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
						src={preview('colorful')}
						alt={copy.clipStyleColorful}
						label={copy.clipStyleColorful}
						checked={preferences.appearance.clipStyle === 'colorful'}
						onChange={(checked) => checked && run(() => controller.actions.preferences.setClipStyle('colorful'))}
						name="audio-editor-clip-style"
						value="colorful"
					/>
					<PreferenceChoice
						selectLabel={copy.selectPreference}
						src={preview('classic')}
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

function preferencePreview(kind, skin) {
	const theme = resolveSkinTheme(skin, kind.includes('dark') ? 'dark' : 'light');
	const dark = kind.includes('dark') || ['colorful', 'classic'].includes(kind);
	const contrast = kind.startsWith('high-contrast');
	const background = contrast ? dark ? '#000000' : '#ffffff' : theme.background.surface.default;
	const surface = contrast ? dark ? '#111111' : '#ffffff' : theme.background.surface.elevated;
	const line = contrast ? dark ? '#ffffff' : '#000000' : theme.border.default;
	const text = contrast ? dark ? '#ffffff' : '#000000' : theme.foreground.text.primary;
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
