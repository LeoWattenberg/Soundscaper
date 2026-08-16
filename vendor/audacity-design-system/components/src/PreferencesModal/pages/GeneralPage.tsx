import { Button } from '../../Button';
import { Dropdown, DropdownOption } from '../../Dropdown';
import { LabeledCheckbox } from '../../LabeledCheckbox';
import { LabeledInput } from '../../LabeledInput';
import { Separator } from '../../Separator';
import { usePreferences } from '../../contexts/PreferencesContext';

// General Page Content
export function GeneralPage({ onResetWarnings }: { onResetWarnings?: () => void }) {
  const { preferences, updatePreference } = usePreferences();

  const languageOptions: DropdownOption[] = [
    { value: 'en', label: 'System (English)' },
    { value: 'es', label: 'Español' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
  ];

  return (
    <div className="preferences-page">
      <div className="preferences-page__section">
        <div className="preferences-page__field preferences-page__field--small">
          <label className="preferences-page__label">Language</label>
          <Dropdown
            options={languageOptions}
            value="en"
          />
        </div>

        <div className="preferences-page__field preferences-page__field--small">
          <label className="preferences-page__label">Number format</label>
          <Dropdown
            options={languageOptions}
            value="en"
          />
          <span className="preferences-page__hint">Example: 1,000,000.99</span>
        </div>
      </div>

      <Separator />

      <div className="preferences-page__section">
        <div className="preferences-page__field preferences-page__field--large">
          <label className="preferences-page__label">Temporary files location</label>
          <div className="preferences-page__input-group">
            <LabeledInput
              label=""
              value="C:\Users\mc\AppData\Local\audacity"
            />
            <Button variant="secondary">
              Browse
            </Button>
          </div>
          <span className="preferences-page__hint">
            Folder in which unsaved projects and other data are kept
          </span>
        </div>

        <div className="preferences-page__field preferences-page__field--large">
          <label className="preferences-page__label">Free space</label>
          <div className="preferences-page__value">547.2 GB</div>
        </div>
      </div>

      <Separator />

      <div className="preferences-page__section">
        <div className="preferences-page__checkboxes">
          <LabeledCheckbox
            label="Show what's new on launch"
            checked={preferences.showWelcomeDialog}
            onChange={(checked) => updatePreference('showWelcomeDialog', checked)}
          />
          <LabeledCheckbox
            label="Check to see if a new version of Audacity is available"
            checked={preferences.checkForUpdates}
            onChange={(checked) => updatePreference('checkForUpdates', checked)}
          />
        </div>

        <div className="preferences-page__info-box">
          Update checking requires network access. In order to protect your privacy,
          Audacity does not store any personal information. See our{' '}
          <a href="#" className="preferences-page__link">Privacy Policy</a> for more info.
        </div>
      </div>

      <Separator />

      <div className="preferences-page__section">
        <div className="preferences-page__field preferences-page__field--large">
          <label className="preferences-page__label">Warnings and dialogs</label>
          <div className="preferences-page__button-group">
            <Button
              variant="secondary"
              onClick={onResetWarnings}
            >
              Reset warnings
            </Button>
            <span className="preferences-page__hint">
              Reset all "Don't show again" checkboxes for warning dialogs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
