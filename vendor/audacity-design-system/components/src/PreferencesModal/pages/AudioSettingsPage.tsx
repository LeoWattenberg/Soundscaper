import { useState, useRef, useEffect } from 'react';
import { Dropdown, DropdownOption } from '../../Dropdown';
import { LabeledInput } from '../../LabeledInput';
import { Separator } from '../../Separator';
import { usePreferences } from '../../contexts/PreferencesContext';
import { TabGroupField } from '../TabGroupField';

// Audio Settings Page Content
export function AudioSettingsPage() {
  const { preferences, updatePreference } = usePreferences();

  const hostOptions: DropdownOption[] = [
    { value: 'mme', label: 'MME' },
    { value: 'wasapi', label: 'Windows WASAPI' },
    { value: 'directsound', label: 'Windows DirectSound' },
    { value: 'core-audio', label: 'Core Audio' },
  ];

  const deviceOptions: DropdownOption[] = [
    { value: 'scarlett', label: 'Scarlett Solo USB' },
    { value: 'realtek', label: 'Realtek High Definition Audio' },
    { value: 'default', label: 'Default Device' },
  ];

  const channelOptions: DropdownOption[] = [
    { value: 'mono', label: '1 (mono)' },
    { value: 'stereo', label: '2 (stereo)' },
  ];

  const sampleRateOptions: DropdownOption[] = [
    { value: '44100', label: '44100 Hz' },
    { value: '48000', label: '48000 Hz' },
    { value: '96000', label: '96000 Hz' },
  ];

  const sampleFormatOptions: DropdownOption[] = [
    { value: '16bit', label: '16-bit PCM' },
    { value: '24bit', label: '24-bit PCM' },
    { value: '32bit', label: '32-bit float' },
  ];

  // Separate tab groups for each section
  const inputsOutputsRefs = useRef<(HTMLElement | null)[]>([]);
  const inputsOutputsActiveIndexRef = useRef<number>(0);
  const [inputsOutputsActiveIndex, setInputsOutputsActiveIndex] = useState<number>(0);

  const bufferRefs = useRef<(HTMLElement | null)[]>([]);
  const bufferActiveIndexRef = useRef<number>(0);
  const [bufferActiveIndex, setBufferActiveIndex] = useState<number>(0);

  const sampleRateRefs = useRef<(HTMLElement | null)[]>([]);
  const sampleRateActiveIndexRef = useRef<number>(0);
  const [sampleRateActiveIndex, setSampleRateActiveIndex] = useState<number>(0);

  // Reset all active indices to 0 on mount
  useEffect(() => {
    setInputsOutputsActiveIndex(0);
    inputsOutputsActiveIndexRef.current = 0;
    setBufferActiveIndex(0);
    bufferActiveIndexRef.current = 0;
    setSampleRateActiveIndex(0);
    sampleRateActiveIndexRef.current = 0;
  }, []);

  // Sync state with refs
  useEffect(() => {
    inputsOutputsActiveIndexRef.current = inputsOutputsActiveIndex;
  }, [inputsOutputsActiveIndex]);

  useEffect(() => {
    bufferActiveIndexRef.current = bufferActiveIndex;
  }, [bufferActiveIndex]);

  useEffect(() => {
    sampleRateActiveIndexRef.current = sampleRateActiveIndex;
  }, [sampleRateActiveIndex]);

  return (
    <div className="preferences-page">
      {/* Section 1: Inputs and outputs */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Inputs and outputs</h3>

        <TabGroupField
          groupId="inputs-outputs"
          itemIndex={0}
          totalItems={4}
          itemRefs={inputsOutputsRefs}
          activeIndexRef={inputsOutputsActiveIndexRef}
          activeIndex={inputsOutputsActiveIndex}
          onActiveIndexChange={setInputsOutputsActiveIndex}
          resetKey="audio-settings"
        >
          <label className="preferences-page__label">Host</label>
          <Dropdown
            options={hostOptions}
            value={preferences.audioHost}
            onChange={(value) => updatePreference('audioHost', value)}
          />
        </TabGroupField>

        <TabGroupField
          groupId="inputs-outputs"
          itemIndex={1}
          totalItems={4}
          itemRefs={inputsOutputsRefs}
          activeIndexRef={inputsOutputsActiveIndexRef}
          activeIndex={inputsOutputsActiveIndex}
          onActiveIndexChange={setInputsOutputsActiveIndex}
          resetKey="audio-settings"
        >
          <label className="preferences-page__label">Playback device</label>
          <Dropdown
            options={deviceOptions}
            value={preferences.playbackDevice}
            onChange={(value) => updatePreference('playbackDevice', value)}
          />
        </TabGroupField>

        <TabGroupField
          groupId="inputs-outputs"
          itemIndex={2}
          totalItems={4}
          itemRefs={inputsOutputsRefs}
          activeIndexRef={inputsOutputsActiveIndexRef}
          activeIndex={inputsOutputsActiveIndex}
          onActiveIndexChange={setInputsOutputsActiveIndex}
          resetKey="audio-settings"
        >
          <label className="preferences-page__label">Recording device</label>
          <Dropdown
            options={deviceOptions}
            value={preferences.recordingDevice}
            onChange={(value) => updatePreference('recordingDevice', value)}
          />
        </TabGroupField>

        <TabGroupField
          groupId="inputs-outputs"
          itemIndex={3}
          totalItems={4}
          itemRefs={inputsOutputsRefs}
          activeIndexRef={inputsOutputsActiveIndexRef}
          activeIndex={inputsOutputsActiveIndex}
          onActiveIndexChange={setInputsOutputsActiveIndex}
          resetKey="audio-settings"
        >
          <label className="preferences-page__label">Recording channels</label>
          <Dropdown
            options={channelOptions}
            value="stereo"
          />
        </TabGroupField>
      </div>

      <Separator />

      {/* Section 2: Buffer settings */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Buffer and latency</h3>

        <TabGroupField
          groupId="buffer-latency"
          itemIndex={0}
          totalItems={2}
          itemRefs={bufferRefs}
          activeIndexRef={bufferActiveIndexRef}
          activeIndex={bufferActiveIndex}
          onActiveIndexChange={setBufferActiveIndex}
          resetKey="audio-settings"
        >
          <label className="preferences-page__label">Buffer length</label>
          <LabeledInput
            label=""
            value="50 ms"
          />
        </TabGroupField>

        <TabGroupField
          groupId="buffer-latency"
          itemIndex={1}
          totalItems={2}
          itemRefs={bufferRefs}
          activeIndexRef={bufferActiveIndexRef}
          activeIndex={bufferActiveIndex}
          onActiveIndexChange={setBufferActiveIndex}
          resetKey="audio-settings"
        >
          <label className="preferences-page__label">Latency compensation</label>
          <LabeledInput
            label=""
            value="50 ms"
          />
        </TabGroupField>
      </div>

      <Separator />

      {/* Section 3: Sample rate */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Sample rate</h3>

        <TabGroupField
          groupId="sample-rate"
          itemIndex={0}
          totalItems={2}
          itemRefs={sampleRateRefs}
          activeIndexRef={sampleRateActiveIndexRef}
          activeIndex={sampleRateActiveIndex}
          onActiveIndexChange={setSampleRateActiveIndex}
          resetKey="audio-settings"
        >
          <label className="preferences-page__label">Default sample rate</label>
          <Dropdown
            options={sampleRateOptions}
            value="44100"
          />
        </TabGroupField>

        <TabGroupField
          groupId="sample-rate"
          itemIndex={1}
          totalItems={2}
          itemRefs={sampleRateRefs}
          activeIndexRef={sampleRateActiveIndexRef}
          activeIndex={sampleRateActiveIndex}
          onActiveIndexChange={setSampleRateActiveIndex}
          resetKey="audio-settings"
        >
          <label className="preferences-page__label">Default sample format</label>
          <Dropdown
            options={sampleFormatOptions}
            value="32bit"
          />
        </TabGroupField>
      </div>
    </div>
  );
}
