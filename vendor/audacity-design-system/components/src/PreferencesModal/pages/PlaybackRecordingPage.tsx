import { useState, useRef, useEffect } from 'react';
import { Dropdown, DropdownOption } from '../../Dropdown';
import { LabeledCheckbox } from '../../LabeledCheckbox';
import { LabeledRadio } from '../../LabeledRadio';
import { NumberStepper } from '../../NumberStepper';
import { Separator } from '../../Separator';
import { usePreferences } from '../../contexts/PreferencesContext';
import { TabGroupField } from '../TabGroupField';

// Playback/Recording Page Content
export function PlaybackRecordingPage() {
  const { preferences, updatePreference } = usePreferences();

  const playbackQualityOptions: DropdownOption[] = [
    { value: 'best', label: 'Best quality' },
    { value: 'high', label: 'High quality' },
    { value: 'medium', label: 'Medium quality' },
  ];

  const ditheringOptions: DropdownOption[] = [
    { value: 'none', label: 'None' },
    { value: 'rectangle', label: 'Rectangle' },
    { value: 'triangle', label: 'Triangle' },
  ];

  // Tab group states
  const playbackPerformanceRefs = useRef<(HTMLElement | null)[]>([]);
  const playbackPerformanceActiveIndexRef = useRef<number>(0);
  const [playbackPerformanceActiveIndex, setPlaybackPerformanceActiveIndex] = useState<number>(0);

  const soloBehaviorRefs = useRef<(HTMLElement | null)[]>([]);
  const soloBehaviorActiveIndexRef = useRef<number>(0);
  const [soloBehaviorActiveIndex, setSoloBehaviorActiveIndex] = useState<number>(0);

  const cursorMovementRefs = useRef<(HTMLElement | null)[]>([]);
  const cursorMovementActiveIndexRef = useRef<number>(0);
  const [cursorMovementActiveIndex, setCursorMovementActiveIndex] = useState<number>(0);

  const recordingBehaviorRefs = useRef<(HTMLElement | null)[]>([]);
  const recordingBehaviorActiveIndexRef = useRef<number>(0);
  const [recordingBehaviorActiveIndex, setRecordingBehaviorActiveIndex] = useState<number>(0);

  const soloBehaviorTabRefs = useRef<(HTMLElement | null)[]>([]);
  const soloBehaviorTabActiveIndexRef = useRef<number>(0);
  const [soloBehaviorTabActiveIndex, setSoloBehaviorTabActiveIndex] = useState<number>(0);

  // Sync state with refs
  useEffect(() => {
    playbackPerformanceActiveIndexRef.current = playbackPerformanceActiveIndex;
  }, [playbackPerformanceActiveIndex]);

  useEffect(() => {
    soloBehaviorActiveIndexRef.current = soloBehaviorActiveIndex;
  }, [soloBehaviorActiveIndex]);

  useEffect(() => {
    cursorMovementActiveIndexRef.current = cursorMovementActiveIndex;
  }, [cursorMovementActiveIndex]);

  useEffect(() => {
    recordingBehaviorActiveIndexRef.current = recordingBehaviorActiveIndex;
  }, [recordingBehaviorActiveIndex]);

  useEffect(() => {
    soloBehaviorTabActiveIndexRef.current = soloBehaviorTabActiveIndex;
  }, [soloBehaviorTabActiveIndex]);

  return (
    <div className="preferences-page">
      {/* Section 1: Playback performance */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Playback performance</h3>

        <TabGroupField
          groupId="playback-performance"
          itemIndex={0}
          totalItems={2}
          itemRefs={playbackPerformanceRefs}
          activeIndexRef={playbackPerformanceActiveIndexRef}
          activeIndex={playbackPerformanceActiveIndex}
          onActiveIndexChange={setPlaybackPerformanceActiveIndex}
          resetKey="playback-recording"
        >
          <label className="preferences-page__label">Playback quality</label>
          <Dropdown
            options={playbackQualityOptions}
            value="best"
          />
        </TabGroupField>

        <TabGroupField
          groupId="playback-performance"
          itemIndex={1}
          totalItems={2}
          itemRefs={playbackPerformanceRefs}
          activeIndexRef={playbackPerformanceActiveIndexRef}
          activeIndex={playbackPerformanceActiveIndex}
          onActiveIndexChange={setPlaybackPerformanceActiveIndex}
          resetKey="playback-recording"
        >
          <label className="preferences-page__label">Dithering</label>
          <Dropdown
            options={ditheringOptions}
            value="none"
          />
        </TabGroupField>
      </div>

      <Separator />

      {/* Section 2: Solo button behavior */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Solo button behavior</h3>

        <div className="preferences-page__radio-group">
          <TabGroupField
            groupId="solo-behavior-tab"
            itemIndex={0}
            totalItems={2}
            itemRefs={soloBehaviorTabRefs}
            activeIndexRef={soloBehaviorTabActiveIndexRef}
            activeIndex={soloBehaviorTabActiveIndex}
            onActiveIndexChange={setSoloBehaviorTabActiveIndex}
            resetKey="playback-recording"
          >
            <LabeledRadio
              label="Solo can be activated for multiple tracks at the same time"
              checked={preferences.soloMode === 'multiple'}
              onChange={() => updatePreference('soloMode', 'multiple')}
              name="solo-mode"
              value="multiple"
            />
          </TabGroupField>
          <TabGroupField
            groupId="solo-behavior-tab"
            itemIndex={1}
            totalItems={2}
            itemRefs={soloBehaviorTabRefs}
            activeIndexRef={soloBehaviorTabActiveIndexRef}
            activeIndex={soloBehaviorTabActiveIndex}
            onActiveIndexChange={setSoloBehaviorTabActiveIndex}
            resetKey="playback-recording"
          >
            <LabeledRadio
              label="When solo is activated, it deactivates solo for all other tracks"
              checked={preferences.soloMode === 'single'}
              onChange={() => updatePreference('soloMode', 'single')}
              name="solo-mode"
              value="single"
            />
          </TabGroupField>
        </div>
      </div>

      <Separator />

      {/* Section 3: Move cursor along the timeline during playback */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Move cursor along the timeline during playback</h3>

        <TabGroupField
          groupId="cursor-movement"
          itemIndex={0}
          totalItems={2}
          itemRefs={cursorMovementRefs}
          activeIndexRef={cursorMovementActiveIndexRef}
          activeIndex={cursorMovementActiveIndex}
          onActiveIndexChange={setCursorMovementActiveIndex}
          resetKey="playback-recording"
        >
          <label className="preferences-page__label">Short skip</label>
          <NumberStepper
            value={preferences.shortSkip}
            onChange={(value) => updatePreference('shortSkip', value)}
          />
        </TabGroupField>

        <TabGroupField
          groupId="cursor-movement"
          itemIndex={1}
          totalItems={2}
          itemRefs={cursorMovementRefs}
          activeIndexRef={cursorMovementActiveIndexRef}
          activeIndex={cursorMovementActiveIndex}
          onActiveIndexChange={setCursorMovementActiveIndex}
          resetKey="playback-recording"
        >
          <label className="preferences-page__label">Long skip</label>
          <NumberStepper
            value={preferences.longSkip}
            onChange={(value) => updatePreference('longSkip', value)}
          />
        </TabGroupField>
      </div>

      <Separator />

      {/* Section 4: Recording behaviour */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Recording behaviour</h3>

        <TabGroupField
          groupId="recording-behavior"
          itemIndex={0}
          totalItems={3}
          itemRefs={recordingBehaviorRefs}
          activeIndexRef={recordingBehaviorActiveIndexRef}
          activeIndex={recordingBehaviorActiveIndex}
          onActiveIndexChange={setRecordingBehaviorActiveIndex}
          resetKey="playback-recording"
        >
          <label className="preferences-page__label">Lead in time</label>
          <NumberStepper
            value={preferences.rollInTime}
            onChange={(value) => updatePreference('rollInTime', value)}
          />
        </TabGroupField>

      </div>

      <Separator />

      {/* Section 5: Monitoring */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Monitoring</h3>

        <TabGroupField
          groupId="recording-behavior"
          itemIndex={1}
          totalItems={3}
          itemRefs={recordingBehaviorRefs}
          activeIndexRef={recordingBehaviorActiveIndexRef}
          activeIndex={recordingBehaviorActiveIndex}
          onActiveIndexChange={setRecordingBehaviorActiveIndex}
          resetKey="playback-recording"
        >
          <LabeledCheckbox
            label="Show mic metering"
            checked={preferences.showMicMetering}
            onChange={(checked) => updatePreference('showMicMetering', checked)}
          />
        </TabGroupField>

        <TabGroupField
          groupId="recording-behavior"
          itemIndex={2}
          totalItems={3}
          itemRefs={recordingBehaviorRefs}
          activeIndexRef={recordingBehaviorActiveIndexRef}
          activeIndex={recordingBehaviorActiveIndex}
          onActiveIndexChange={setRecordingBehaviorActiveIndex}
          resetKey="playback-recording"
        >
          <LabeledCheckbox
            label="Enable input monitoring"
            checked={preferences.enableInputMonitoring}
            onChange={(checked) => updatePreference('enableInputMonitoring', checked)}
          />
        </TabGroupField>
      </div>
    </div>
  );
}
