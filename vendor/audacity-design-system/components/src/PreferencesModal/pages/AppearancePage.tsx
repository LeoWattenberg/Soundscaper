import { LabeledRadio } from '../../LabeledRadio';
import { usePreferences } from '../../contexts/PreferencesContext';

// Appearance Page Content
export function AppearancePage() {
  const { preferences, updatePreference } = usePreferences();

  return (
    <div className="preferences-page">
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Theme</h3>

        <div className="preferences-page__radio-group">
          <LabeledRadio
            label="Light"
            checked={preferences.theme === 'light'}
            onChange={() => updatePreference('theme', 'light')}
            name="theme"
            value="light"
          />

          <LabeledRadio
            label="Dark"
            checked={preferences.theme === 'dark'}
            onChange={() => updatePreference('theme', 'dark')}
            name="theme"
            value="dark"
          />
        </div>
      </div>

      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Clip style</h3>

        <div className="preferences-page__radio-group">
          <LabeledRadio
            label="Colourful"
            checked={preferences.clipStyle === 'colourful'}
            onChange={() => updatePreference('clipStyle', 'colourful')}
            name="clipStyle"
            value="colourful"
          />

          <LabeledRadio
            label="Classic"
            checked={preferences.clipStyle === 'classic'}
            onChange={() => updatePreference('clipStyle', 'classic')}
            name="clipStyle"
            value="classic"
          />
        </div>
      </div>
    </div>
  );
}
