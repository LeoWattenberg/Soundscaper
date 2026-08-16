import { useState } from 'react';
import { Dropdown } from '../../Dropdown';
import { LabeledCheckbox } from '../../LabeledCheckbox';
import { LabeledRadio } from '../../LabeledRadio';
import { Separator } from '../../Separator';
import { PreferenceThumbnail } from '../../PreferenceThumbnail';
import { PreferencePanel } from '../../PreferencePanel';

// Audio Editing Page Content
export interface EditingPageProps {
  zoomToggleLevel1?: string;
  onZoomToggleLevel1Change?: (value: string) => void;
  zoomToggleLevel2?: string;
  onZoomToggleLevel2Change?: (value: string) => void;
}

export function EditingPage({
  zoomToggleLevel1 = 'zoom-default',
  onZoomToggleLevel1Change,
  zoomToggleLevel2 = 'seconds',
  onZoomToggleLevel2Change,
}: EditingPageProps) {
  const [deletingBehavior, setDeletingBehavior] = useState<'leave-gap' | 'close-gap'>('leave-gap');
  const [closeGapBehavior, setCloseGapBehavior] = useState<'selected-clip' | 'same-track' | 'all-tracks'>('selected-clip');
  const [pastingBehavior, setPastingBehavior] = useState<'overlaps' | 'pushes'>('overlaps');
  const [pastingPushesBehavior, setPastingPushesBehavior] = useState<'same-track' | 'all-tracks'>('same-track');
  const [alwaysPasteAsNewClip, setAlwaysPasteAsNewClip] = useState(false);
  const [pastingBetweenProjects, setPastingBetweenProjects] = useState<'smart' | 'selected-only' | 'ask'>('smart');
  const [stereoHeightsBehavior, setStereoHeightsBehavior] = useState<'always' | 'workspace' | 'never'>('workspace');
  const [workspaceType, setWorkspaceType] = useState({
    classic: false,
    music: false,
    advancedAudioEditing: true,
    myNewWorkspace: false,
  });
  const [stereoToMono, setStereoToMono] = useState<'ask' | 'mix-together' | 'left-only'>('mix-together');

  return (
    <div className="preferences-page">
      {/* Effect behavior */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Effect behavior</h3>
        <LabeledCheckbox
          label="Apply effects to all audio when no selection is made"
          checked={true}
        />
      </div>

      <Separator />

      {/* Choose behavior when deleting a portion of a clip */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Choose behavior when deleting a portion of a clip</h3>

        <div style={{ display: 'flex', gap: '16px' }}>
          <PreferenceThumbnail
            src="https://via.placeholder.com/188x106?text=Leave+Gap"
            alt="Leave gap when deleting"
            label="Leave gap"
            checked={deletingBehavior === 'leave-gap'}
            onChange={() => setDeletingBehavior('leave-gap')}
            name="deleting-behavior"
            value="leave-gap"
          />
          <PreferenceThumbnail
            src="https://via.placeholder.com/188x106?text=Close+Gap"
            alt="Close gap (ripple) when deleting"
            label="Close gap (ripple)"
            checked={deletingBehavior === 'close-gap'}
            onChange={() => setDeletingBehavior('close-gap')}
            name="deleting-behavior"
            value="close-gap"
          />
        </div>

        {deletingBehavior === 'close-gap' && (
          <PreferencePanel title="When closing the gap, do the following">
            <LabeledRadio
              label="The selected clip moves back to fill the gap"
              checked={closeGapBehavior === 'selected-clip'}
              onChange={() => setCloseGapBehavior('selected-clip')}
              name="close-gap-behavior"
              value="selected-clip"
            />
            <LabeledRadio
              label="All clips on the same track move back to fill the gap"
              checked={closeGapBehavior === 'same-track'}
              onChange={() => setCloseGapBehavior('same-track')}
              name="close-gap-behavior"
              value="same-track"
            />
            <LabeledRadio
              label="All clips on all tracks move back to fill the gap"
              checked={closeGapBehavior === 'all-tracks'}
              onChange={() => setCloseGapBehavior('all-tracks')}
              name="close-gap-behavior"
              value="all-tracks"
            />
          </PreferencePanel>
        )}
      </div>

      <Separator />

      {/* Choose behavior when pasting audio */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Choose behavior when pasting audio</h3>

        <div style={{ display: 'flex', gap: '16px' }}>
          <PreferenceThumbnail
            src="https://via.placeholder.com/188x106?text=Overlaps"
            alt="Pasting overlaps other clips"
            label="Pasting overlaps other clips"
            checked={pastingBehavior === 'overlaps'}
            onChange={() => setPastingBehavior('overlaps')}
            name="pasting-behavior"
            value="overlaps"
          />
          <PreferenceThumbnail
            src="https://via.placeholder.com/188x106?text=Pushes"
            alt="Pasting pushes other clips"
            label="Pasting pushes other clips"
            checked={pastingBehavior === 'pushes'}
            onChange={() => setPastingBehavior('pushes')}
            name="pasting-behavior"
            value="pushes"
          />
        </div>

        {pastingBehavior === 'pushes' && (
          <PreferencePanel title="When making room for pasted audio, do the following">
            <LabeledRadio
              label="Pasting audio pushes other clips on the same track"
              checked={pastingPushesBehavior === 'same-track'}
              onChange={() => setPastingPushesBehavior('same-track')}
              name="pasting-pushes-behavior"
              value="same-track"
            />
            <LabeledRadio
              label="Pasting audio pushes all clips on all tracks"
              checked={pastingPushesBehavior === 'all-tracks'}
              onChange={() => setPastingPushesBehavior('all-tracks')}
              name="pasting-pushes-behavior"
              value="all-tracks"
            />
          </PreferencePanel>
        )}

        <LabeledCheckbox
          label="Always paste audio as a new clip"
          checked={alwaysPasteAsNewClip}
          onChange={(checked) => setAlwaysPasteAsNewClip(checked)}
        />
      </div>

      <Separator />

      {/* Pasting audio between projects */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Pasting audio between projects</h3>

        <div className="preferences-page__radio-group preferences-page__radio-group--bold">
          <LabeledRadio
            label="Smart clip"
            checked={pastingBetweenProjects === 'smart'}
            onChange={() => setPastingBetweenProjects('smart')}
            name="pasting-between-projects"
            value="smart"
            bold={true}
            description="The entire source clip will be pasted into your project, allowing you to access trimmed audio data at anytime."
          />

          <LabeledRadio
            label="Selected audio only"
            checked={pastingBetweenProjects === 'selected-only'}
            onChange={() => setPastingBetweenProjects('selected-only')}
            name="pasting-between-projects"
            value="selected-only"
            bold={true}
            description="Only the selected portion of the source clip will be pasted."
          />

          <LabeledRadio
            label="Ask me each time"
            checked={pastingBetweenProjects === 'ask'}
            onChange={() => setPastingBetweenProjects('ask')}
            name="pasting-between-projects"
            value="ask"
            bold={true}
            description="Show dialog each time audio is pasted."
          />
        </div>
      </div>

      <Separator />

      {/* Asymmetric stereo heights */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Asymmetric stereo heights</h3>

        <img
          src="https://via.placeholder.com/188x64?text=Stereo+Heights"
          alt="Asymmetric stereo heights example"
          style={{ width: '188px', height: '64px', borderRadius: '4px', backgroundColor: '#d4d5d9' }}
        />

        <div style={{
          marginTop: '8px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '12px',
          fontWeight: 400,
          lineHeight: '16px',
          color: '#14151a'
        }}>
          Dragging on the center line may adjust the height of the channels:
        </div>

        <div className="preferences-page__radio-group">
          <LabeledRadio
            label="Always"
            checked={stereoHeightsBehavior === 'always'}
            onChange={() => setStereoHeightsBehavior('always')}
            name="stereo-heights"
            value="always"
          />

          <LabeledRadio
            label="Depending on workspace"
            checked={stereoHeightsBehavior === 'workspace'}
            onChange={() => setStereoHeightsBehavior('workspace')}
            name="stereo-heights"
            value="workspace"
          />

          {stereoHeightsBehavior === 'workspace' && (
            <div style={{ marginLeft: '24px', marginTop: '4px' }}>
              <div className="preferences-page__checkboxes">
                <LabeledCheckbox
                  label="Classic"
                  checked={workspaceType.classic}
                  onChange={(checked) => setWorkspaceType({ ...workspaceType, classic: checked })}
                />
                <LabeledCheckbox
                  label="Music"
                  checked={workspaceType.music}
                  onChange={(checked) => setWorkspaceType({ ...workspaceType, music: checked })}
                />
                <LabeledCheckbox
                  label="Advanced audio editing"
                  checked={workspaceType.advancedAudioEditing}
                  onChange={(checked) => setWorkspaceType({ ...workspaceType, advancedAudioEditing: checked })}
                />
                <LabeledCheckbox
                  label="My new workspace"
                  checked={workspaceType.myNewWorkspace}
                  onChange={(checked) => setWorkspaceType({ ...workspaceType, myNewWorkspace: checked })}
                />
              </div>
            </div>
          )}

          <LabeledRadio
            label="Never"
            checked={stereoHeightsBehavior === 'never'}
            onChange={() => setStereoHeightsBehavior('never')}
            name="stereo-heights"
            value="never"
          />
        </div>
      </div>

      <Separator />

      {/* When converting stereo to mono */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">When converting stereo to mono</h3>

        <div className="preferences-page__radio-group">
          <LabeledRadio
            label="Always ask"
            checked={stereoToMono === 'ask'}
            onChange={() => setStereoToMono('ask')}
            name="stereo-to-mono"
            value="ask"
          />

          <LabeledRadio
            label="Mix the left and right channels together"
            checked={stereoToMono === 'mix-together'}
            onChange={() => setStereoToMono('mix-together')}
            name="stereo-to-mono"
            value="mix-together"
          />

          <LabeledRadio
            label="Pick the left channel only"
            checked={stereoToMono === 'left-only'}
            onChange={() => setStereoToMono('left-only')}
            name="stereo-to-mono"
            value="left-only"
          />
        </div>
      </div>

      <Separator />

      {/* Zoom toggle */}
      <div className="preferences-page__section">
        <h3 className="preferences-page__section-title">Zoom toggle (magnifying glass)</h3>
        <p className="preferences-page__description">A special tool in the top bar that toggles between two different zoom states.</p>

        <div className="preferences-page__field preferences-page__field--small">
          <label className="preferences-page__label">Zoom state 1:</label>
          <Dropdown
            value={zoomToggleLevel1}
            options={[
              { value: 'fit-to-width', label: 'Fit to Width' },
              { value: 'zoom-to-selection', label: 'Zoom to Selection' },
              { value: 'zoom-default', label: 'Zoom Default' },
              { value: 'minutes', label: 'Minutes' },
              { value: 'seconds', label: 'Seconds' },
              { value: '5ths-of-seconds', label: '5ths of Seconds' },
              { value: '10ths-of-seconds', label: '10ths of Seconds' },
              { value: '20ths-of-seconds', label: '20ths of Seconds' },
              { value: '50ths-of-seconds', label: '50ths of Seconds' },
              { value: '100ths-of-seconds', label: '100ths of Seconds' },
              { value: '500ths-of-seconds', label: '500ths of Seconds' },
              { value: 'milliseconds', label: 'MilliSeconds' },
              { value: 'samples', label: 'Samples' },
              { value: '4-pixels-per-sample', label: '4 Pixels per Sample' },
              { value: 'max-zoom', label: 'Max Zoom' },
            ]}
            onChange={(value) => onZoomToggleLevel1Change?.(value)}
          />
        </div>

        <div className="preferences-page__field preferences-page__field--small">
          <label className="preferences-page__label">Zoom state 2:</label>
          <Dropdown
            value={zoomToggleLevel2}
            options={[
              { value: 'fit-to-width', label: 'Fit to Width' },
              { value: 'zoom-to-selection', label: 'Zoom to Selection' },
              { value: 'zoom-default', label: 'Zoom Default' },
              { value: 'minutes', label: 'Minutes' },
              { value: 'seconds', label: 'Seconds' },
              { value: '5ths-of-seconds', label: '5ths of Seconds' },
              { value: '10ths-of-seconds', label: '10ths of Seconds' },
              { value: '20ths-of-seconds', label: '20ths of Seconds' },
              { value: '50ths-of-seconds', label: '50ths of Seconds' },
              { value: '100ths-of-seconds', label: '100ths of Seconds' },
              { value: '500ths-of-seconds', label: '500ths of Seconds' },
              { value: 'milliseconds', label: 'MilliSeconds' },
              { value: 'samples', label: 'Samples' },
              { value: '4-pixels-per-sample', label: '4 Pixels per Sample' },
              { value: 'max-zoom', label: 'Max Zoom' },
            ]}
            onChange={(value) => onZoomToggleLevel2Change?.(value)}
          />
        </div>
      </div>
    </div>
  );
}
