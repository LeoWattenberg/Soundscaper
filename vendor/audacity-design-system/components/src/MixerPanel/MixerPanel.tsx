import React from 'react';
import { useTheme } from '../ThemeProvider';
import { MixerChannel, type MixerChannelProps } from '../MixerChannel';
import { PanelHeader, type PanelHeaderTab } from '../PanelHeader';
import './MixerPanel.css';

export interface MixerPanelChannel {
  /** Unique identifier for the channel */
  id: string;
  /** Props passed through to MixerChannel */
  channelProps: Omit<MixerChannelProps, 'className'>;
}

export interface MixerPanelProps {
  /**
   * Tabs shown in the panel header.
   * Each tab needs an `id` and `label`.
   * @default [{ id: 'mixer', label: 'Mixer' }]
   */
  tabs?: PanelHeaderTab[];
  /**
   * ID of the currently active tab
   * @default 'mixer'
   */
  activeTabId?: string;
  /**
   * Called when a tab is clicked
   */
  onTabChange?: (tabId: string) => void;
  /**
   * Called when the panel menu (ellipsis) button is clicked
   */
  onMenuClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /**
   * Master channel props (always shown as the first channel)
   */
  masterChannel?: Omit<MixerChannelProps, 'className'>;
  /**
   * Track mixer channels to display
   */
  channels?: MixerPanelChannel[];
  /**
   * Hide the built-in PanelHeader (when managed externally, e.g. in a tabbed drawer)
   */
  hideHeader?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/** Height of a single effect slot (24px) + gap (4px) */
const EFFECT_SLOT_HEIGHT = 24;
const EFFECT_SLOT_GAP = 4;
const EFFECT_SLOT_PADDING = 12; // 6px top + 6px bottom

/** Calculate effect stack height for a given number of slots */
function effectStackHeight(slotCount: number): number {
  return EFFECT_SLOT_PADDING + slotCount * EFFECT_SLOT_HEIGHT + Math.max(0, slotCount - 1) * EFFECT_SLOT_GAP;
}

/**
 * MixerPanel - The complete mixer panel with header tabs, row labels, and channel strips.
 *
 * Composes PanelHeader for tabs and MixerChannel components in a
 * horizontally scrollable area with right-aligned row labels on the left side.
 */
export const MixerPanel: React.FC<MixerPanelProps> = ({
  tabs = [{ id: 'mixer', label: 'Mixer' }],
  activeTabId = 'mixer',
  onTabChange,
  onMenuClick,
  masterChannel,
  channels = [],
  hideHeader = false,
  className = '',
}) => {
  const { theme } = useTheme();

  // Compute max effect slot count across all channels (at least 1 empty slot per channel)
  const masterEffectCount = (masterChannel?.effects?.length ?? 0) + 1; // +1 for empty add slot
  const channelEffectCounts = channels.map(ch => (ch.channelProps.effects?.length ?? 0) + 1);
  const maxEffectSlots = Math.min(5, Math.max(masterEffectCount, ...channelEffectCounts, 1));

  const effectRowHeight = effectStackHeight(maxEffectSlots);

  const style = {
    '--mp-text': theme.foreground.text.primary,
    '--mp-body-bg': theme.background.surface.default,
    '--mp-border': theme.border.default,
  } as React.CSSProperties;

  return (
    <div className={`mixer-panel ${className}`} style={style}>
      {/* Reuse existing PanelHeader component */}
      {!hideHeader && (
        <PanelHeader
          tabs={tabs}
          activeTabId={activeTabId}
          onTabChange={onTabChange}
          onMenuClick={onMenuClick}
        />
      )}

      {/* Panel body — scrolls vertically */}
      <div className="mixer-panel__body">
        {/* Inner content row — sized by channel content, may exceed body */}
        <div className="mixer-panel__content">
          {/* Row labels */}
          <div className="mixer-panel__row-labels">
            <div style={{ marginTop: 'auto', paddingRight: 8 }}>
              <div className="mixer-panel__row-label" style={{ height: effectRowHeight, alignItems: 'flex-start', paddingTop: 10 }}>
                <span>Audio FX</span>
              </div>
              <div className="mixer-panel__row-label" style={{ height: 40 }}>
                <span>Pan</span>
              </div>
              <div className="mixer-panel__row-label" style={{ height: 40 }}>
                <span>Volume</span>
              </div>
              <div style={{ height: 160 }} />
              <div className="mixer-panel__row-label" style={{ height: 40 }}>
                <span>Mute/Solo</span>
              </div>
              <div className="mixer-panel__row-label" style={{ height: 24 }}>
                <span>Name</span>
              </div>
            </div>
          </div>

          {/* Channel strip area — scrolls horizontally */}
          <div className="mixer-panel__channels-scroll">
            <div className="mixer-panel__channels">
              <div className="mixer-panel__channel-divider" />
              {channels.map((ch, i) => (
                <React.Fragment key={ch.id}>
                  {i > 0 && <div className="mixer-panel__channel-divider" />}
                  <MixerChannel {...ch.channelProps} effectSlotCount={maxEffectSlots} />
                </React.Fragment>
              ))}
              {masterChannel && (
                <>
                  {channels.length > 0 && <div className="mixer-panel__channel-divider" />}
                  <MixerChannel {...masterChannel} effectSlotCount={maxEffectSlots} />
                </>
              )}
              <div className="mixer-panel__channel-divider" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MixerPanel;
