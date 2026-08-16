import { Button } from '../../Button';
import { LabeledCheckbox } from '../../LabeledCheckbox';
import { LabeledInput } from '../../LabeledInput';
import { Separator } from '../../Separator';
import { usePreferences, type PreferencesState } from '../../contexts/PreferencesContext';

export function PluginsPage({ onOpenPluginManager }: { onOpenPluginManager?: () => void }) {
  const { preferences, updatePreference } = usePreferences();

  const pluginPaths: { key: keyof PreferencesState; label: string }[] = [
    { key: 'vst3PluginLocation', label: 'VST3 plugin location' },
    { key: 'vstPluginLocation', label: 'VST plugin location' },
    { key: 'lv2PluginLocation', label: 'LV2 plugin location' },
    { key: 'ladspaPluginLocation', label: 'LADSPA plugin location' },
    { key: 'audioUnitsPluginLocation', label: 'Audio Units plugin location' },
  ];

  return (
    <div className="preferences-page">
      <div className="preferences-page__section">
        <div>
          <Button variant="secondary" onClick={onOpenPluginManager}>
            Open plugin manager
          </Button>
        </div>

        <LabeledCheckbox
          label="Group effects in menus"
          checked={preferences.groupEffectsInMenus}
          onChange={(checked) => updatePreference('groupEffectsInMenus', checked)}
        />
      </div>

      <Separator />

      <div className="preferences-page__section">
        <div className="preferences-page__section-title">Custom plugin search paths</div>

        {pluginPaths.map(({ key, label }) => (
          <div key={key} className="preferences-page__field preferences-page__field--large">
            <label className="preferences-page__label">{label}</label>
            <div className="preferences-page__input-group">
              <LabeledInput
                label=""
                value={preferences[key] as string}
                onChange={(val) => updatePreference(key, val as any)} // justified: updatePreference is dynamically keyed — pending components sweep
              />
              <Button variant="secondary">
                Browse
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
