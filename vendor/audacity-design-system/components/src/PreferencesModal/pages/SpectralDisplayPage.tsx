import { useState, useRef, useEffect } from 'react';
import { Dropdown, DropdownOption } from '../../Dropdown';
import { LabeledCheckbox } from '../../LabeledCheckbox';
import { NumberStepper } from '../../NumberStepper';
import { Separator } from '../../Separator';
import { usePreferences } from '../../contexts/PreferencesContext';
import { TabGroupField } from '../TabGroupField';

// Spectral Display Page Content
export function SpectralDisplayPage() {
  const { preferences, updatePreference } = usePreferences();

  const scaleOptions: DropdownOption[] = [
    { value: 'mel', label: 'Mel' },
    { value: 'linear', label: 'Linear' },
    { value: 'logarithmic', label: 'Logarithmic' },
  ];

  const schemeOptions: DropdownOption[] = [
    { value: 'inverse-grayscale', label: 'Inverse grayscale' },
    { value: 'grayscale', label: 'Grayscale' },
    { value: 'color', label: 'Color' },
  ];

  const algorithmOptions: DropdownOption[] = [
    { value: 'frequencies', label: 'Frequencies' },
    { value: 'reassignment', label: 'Reassignment' },
    { value: 'pitch-eac', label: 'Pitch (EAC)' },
  ];

  const windowSizeOptions: DropdownOption[] = [
    { value: '32768', label: '32768 - most narrowband' },
    { value: '16384', label: '16384' },
    { value: '8192', label: '8192' },
    { value: '4096', label: '4096' },
    { value: '2048', label: '2048' },
    { value: '1024', label: '1024' },
    { value: '512', label: '512' },
    { value: '256', label: '256 - most wideband' },
  ];

  const windowTypeOptions: DropdownOption[] = [
    { value: 'blackman-harris', label: 'Blackman-Harris' },
    { value: 'hann', label: 'Hann' },
    { value: 'hamming', label: 'Hamming' },
  ];

  const zeroPaddingOptions: DropdownOption[] = [
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '4', label: '4' },
    { value: '8', label: '8' },
  ];

  // Tab group states
  const coloursRefs = useRef<(HTMLElement | null)[]>([]);
  const coloursActiveIndexRef = useRef<number>(0);
  const [coloursActiveIndex, setColoursActiveIndex] = useState<number>(0);

  const algorithmRefs = useRef<(HTMLElement | null)[]>([]);
  const algorithmActiveIndexRef = useRef<number>(0);
  const [algorithmActiveIndex, setAlgorithmActiveIndex] = useState<number>(0);

  // Sync state with refs
  useEffect(() => {
    coloursActiveIndexRef.current = coloursActiveIndex;
  }, [coloursActiveIndex]);

  useEffect(() => {
    algorithmActiveIndexRef.current = algorithmActiveIndex;
  }, [algorithmActiveIndex]);

  return (
    <div className="preferences-page">
      {/* Section 1: Selection */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Selection</h3>
        <LabeledCheckbox
          label="Enable spectral selection"
          checked={true}
        />
      </div>

      <Separator />

      {/* Section 2: Scale */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Scale</h3>

        <div className="preferences-page__field preferences-page__field--small">
          <label className="preferences-page__label">Scale</label>
          <Dropdown
            options={scaleOptions}
            value="mel"
          />
        </div>
      </div>

      <Separator />

      {/* Section 3: Colours */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Colours</h3>

        <TabGroupField
          groupId="spectral-colours"
          itemIndex={0}
          totalItems={4}
          itemRefs={coloursRefs}
          activeIndexRef={coloursActiveIndexRef}
          activeIndex={coloursActiveIndex}
          onActiveIndexChange={setColoursActiveIndex}
          resetKey="spectral-display"
        >
          <label className="preferences-page__label">Gain</label>
          <NumberStepper
            value={preferences.spectralGain}
            onChange={(value) => updatePreference('spectralGain', value)}
          />
        </TabGroupField>

        <TabGroupField
          groupId="spectral-colours"
          itemIndex={1}
          totalItems={4}
          itemRefs={coloursRefs}
          activeIndexRef={coloursActiveIndexRef}
          activeIndex={coloursActiveIndex}
          onActiveIndexChange={setColoursActiveIndex}
          resetKey="spectral-display"
        >
          <label className="preferences-page__label">Range</label>
          <NumberStepper
            value="80 dB"
          />
        </TabGroupField>

        <TabGroupField
          groupId="spectral-colours"
          itemIndex={2}
          totalItems={4}
          itemRefs={coloursRefs}
          activeIndexRef={coloursActiveIndexRef}
          activeIndex={coloursActiveIndex}
          onActiveIndexChange={setColoursActiveIndex}
          resetKey="spectral-display"
        >
          <label className="preferences-page__label">High boost</label>
          <NumberStepper
            value="20 dB/dec"
          />
        </TabGroupField>

        <TabGroupField
          groupId="spectral-colours"
          itemIndex={3}
          totalItems={4}
          itemRefs={coloursRefs}
          activeIndexRef={coloursActiveIndexRef}
          activeIndex={coloursActiveIndex}
          onActiveIndexChange={setColoursActiveIndex}
          resetKey="spectral-display"
        >
          <label className="preferences-page__label">Scheme</label>
          <Dropdown
            options={schemeOptions}
            value={preferences.spectralScheme}
            onChange={(value) => updatePreference('spectralScheme', value)}
          />
        </TabGroupField>
      </div>

      <Separator />

      {/* Section 4: Algorithm */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Algorithm</h3>

        <TabGroupField
          groupId="spectral-algorithm"
          itemIndex={0}
          totalItems={4}
          itemRefs={algorithmRefs}
          activeIndexRef={algorithmActiveIndexRef}
          activeIndex={algorithmActiveIndex}
          onActiveIndexChange={setAlgorithmActiveIndex}
          resetKey="spectral-display"
        >
          <label className="preferences-page__label">Algorithm</label>
          <Dropdown
            options={algorithmOptions}
            value="frequencies"
          />
        </TabGroupField>

        <TabGroupField
          groupId="spectral-algorithm"
          itemIndex={1}
          totalItems={4}
          itemRefs={algorithmRefs}
          activeIndexRef={algorithmActiveIndexRef}
          activeIndex={algorithmActiveIndex}
          onActiveIndexChange={setAlgorithmActiveIndex}
          resetKey="spectral-display"
        >
          <label className="preferences-page__label">Window size</label>
          <Dropdown
            options={windowSizeOptions}
            value="32768"
          />
        </TabGroupField>

        <TabGroupField
          groupId="spectral-algorithm"
          itemIndex={2}
          totalItems={4}
          itemRefs={algorithmRefs}
          activeIndexRef={algorithmActiveIndexRef}
          activeIndex={algorithmActiveIndex}
          onActiveIndexChange={setAlgorithmActiveIndex}
          resetKey="spectral-display"
        >
          <label className="preferences-page__label">Scheme</label>
          <Dropdown
            options={windowTypeOptions}
            value="blackman-harris"
          />
        </TabGroupField>

        <TabGroupField
          groupId="spectral-algorithm"
          itemIndex={3}
          totalItems={4}
          itemRefs={algorithmRefs}
          activeIndexRef={algorithmActiveIndexRef}
          activeIndex={algorithmActiveIndex}
          onActiveIndexChange={setAlgorithmActiveIndex}
          resetKey="spectral-display"
        >
          <label className="preferences-page__label">Zero padding factor</label>
          <Dropdown
            options={zeroPaddingOptions}
            value="2"
          />
        </TabGroupField>
      </div>
    </div>
  );
}
