import { Button } from '../../Button';
import { Dropdown, DropdownOption } from '../../Dropdown';
import { LabeledCheckbox } from '../../LabeledCheckbox';
import { LabeledInput } from '../../LabeledInput';
import { LabeledRadio } from '../../LabeledRadio';
import { NumberStepper } from '../../NumberStepper';
import { Separator } from '../../Separator';
import { usePreferences } from '../../contexts/PreferencesContext';

export function CloudPage() {
  const { preferences, updatePreference } = usePreferences();

  const mixdownIntervalOptions: DropdownOption[] = [
    { value: '3', label: '3 saves' },
    { value: '5', label: '5 saves' },
    { value: '10', label: '10 saves' },
    { value: '20', label: '20 saves' },
  ];

  return (
    <div className="preferences-page">
      <div className="preferences-page__section">
        <label className="preferences-page__label">Generate mixdown for audio.com playback</label>

        <div className="preferences-page__radio-group">
          <LabeledRadio
            label="Never"
            checked={preferences.cloudMixdownMode === 'never'}
            onChange={() => updatePreference('cloudMixdownMode', 'never')}
            name="cloudMixdownMode"
            value="never"
          />

          <LabeledRadio
            label="Always"
            checked={preferences.cloudMixdownMode === 'always'}
            onChange={() => updatePreference('cloudMixdownMode', 'always')}
            name="cloudMixdownMode"
            value="always"
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LabeledRadio
              label="Every"
              checked={preferences.cloudMixdownMode === 'every'}
              onChange={() => updatePreference('cloudMixdownMode', 'every')}
              name="cloudMixdownMode"
              value="every"
            />
            <Dropdown
              options={mixdownIntervalOptions}
              value={preferences.cloudMixdownInterval}
              onChange={(val) => updatePreference('cloudMixdownInterval', val)}
              width="120px"
            />
          </div>
        </div>
      </div>

      <div className="preferences-page__section">
        <LabeledCheckbox
          label="Show 'How would you like to save?' dialog"
          checked={preferences.showSaveDialog}
          onChange={(checked) => updatePreference('showSaveDialog', checked)}
        />
      </div>

      <Separator />

      <div className="preferences-page__section">
        <div className="preferences-page__field preferences-page__field--large">
          <label className="preferences-page__label">Temporary local save location</label>
          <div className="preferences-page__input-group">
            <LabeledInput
              label=""
              value={preferences.cloudTempLocation}
              onChange={(val) => updatePreference('cloudTempLocation', val)}
            />
            <Button variant="secondary">
              Browse
            </Button>
          </div>
        </div>

        <div className="preferences-page__field preferences-page__field--small">
          <label className="preferences-page__label">Remove temporary files after</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NumberStepper
              value={preferences.cloudTempRetentionDays}
              onChange={(val) => updatePreference('cloudTempRetentionDays', val)}
              min={1}
              max={365}
              width="80px"
            />
            <span className="preferences-page__label" style={{ fontWeight: 400 }}>days</span>
          </div>
        </div>

        <div className="preferences-page__info-box">
          Audacity creates a local copy of cloud projects while you work on them,
          improving performance and enabling you to work on unstable connections.
        </div>
      </div>
    </div>
  );
}
