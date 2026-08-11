/**
 * @dilsonspickles/components
 *
 * UI component library for Audacity Design System
 */

/**
 * Theme System
 */
export * from './ThemeProvider';
export { lightTheme, darkTheme, type ThemeTokens } from '@audacity-ui/tokens';

/**
 * Constants
 */
export * from './constants';

/**
 * UI Components
 */
export * from './Button';
export * from './GhostButton';
export * from './Icon';
export * from './Knob';
export * from './PanKnob';
export * from './Slider';
export * from './ToggleButton';
export * from './ToolButton';
export * from './TrackMeter';
export * from './MasterMeter';
export * from './MasterMeterVertical';
export * from './MixerFaderHandle';
export * from './MixerFader';
export * from './MixerEffect';
export * from './MixerChannel';
export * from './MixerPanel';
export * from './ToggleToolButton';
export * from './TrackControlPanel';
export * from './TransportButton';
export * from './ContextMenu';
export * from './ContextMenuItem';
export * from './AddTrackFlyout';
export * from './RulerFlyout';
export * from './Toast';
export * from './Dialog';
export * from './DialogHeader';
export * from './DialogSideNav/DialogSideNav';
export * from './WelcomeDialog';
export * from './WaveformPreview';
export * from './SwipeyDots';
export * from './Carousel';
export * from './Dropdown';
export * from './Separator';
export * from './Footer';
export * from './SignInActionBar';
export * from './TextInput';
export * from './LabeledInput';
export * from './SocialSignInButton';
export * from './LabeledFormDivider';
export * from './TextLink';
export * from './ProgressBar';
export * from './Checkbox';
export * from './LabeledCheckbox';
export * from './Radio';
export * from './LabeledRadio';
export * from './NumberStepper';
export * from './BpmStepper';
export * from './TimeSignatureSelector';
export * from './ChannelMappingDialog';
export * from './CustomScrollbar';
export * from './Tooltip';
export * from './FilterChip';
export * from './CloudProjectIndicator';
export * from './ApplicationHeader';
export * from './Menu';
export * from './SaveProjectModal';
export * from './PreferencesModal';
export * from './PreferencePanel';
export * from './ExportModal';
export * from './PluginBrowserDialog';
export * from './PluginCard';
export * from './Spinner';
export * from './AlertDialog';
export * from './Tab';
export * from './TabItem';
export * from './TabList';
export * from './HomeTab';
export * from './SearchField';
export * from './ProjectThumbnail';
export * from './AudioFileThumbnail';
export * from './PreferenceThumbnail';
export * from './ShortcutTableRow';
export * from './ShortcutTableHeader';
export * from './Table';
export * from './LabelEditor';
export * from './LabelEditorHeader';
export * from './LabelEditorTableHeader';
export * from './LabelEditorTableRow';
export * from './PluginManagerDialog';
export * from './MacroManager';
export * from './SelectCommandDialog';
export * from './VSTEffectOptionsDialog';

/**
 * Audio Components
 */
export * from './Clip';
export * from './ClipHeader';
export * from './ClipBody';
export * from './ClipContextMenu';
export * from './TrackContextMenu';
export * from './TimelineRulerContextMenu';
export * from './AutomationCurvePoint';
export * from './EnvelopePoint';
export * from './EnvelopeCurve';
export * from './EnvelopeInteractionLayer';
export * from './EnvelopeOverlay';
export * from './Track';
export { TrackNew } from './Track/TrackNew';
export * from './LabelMarker';
export * from './RegionLabel';
export * from './PointLabel';
export * from './Label';

/**
 * MIDI Components
 */
export * from './MidiClipBody/MidiClipBody';
export * from './NoteRect';
export * from './PianoRoll';

/**
 * Layout & Behavior Utilities
 */
export * from './ResizablePanel';
export * from './SidePanel';
export * from './TimelineRuler';
export * from './VerticalRuler';
export * from './TimeSelectionCanvasOverlay';
export * from './TimeSelectionRulerOverlay';
export * from './SpectralSelectionOverlay';
export * from './PlayheadCursor';
export * from './ProjectToolbar';
export * from './Toolbar';
export * from './ToolbarGroup';
export * from './TransportToolbar';
export * from './TrackControlSidePanel';
export * from './EffectsPanel';
export * from './PanelHeader';
export * from './EffectDialog';
export * from './TimeCode';
export * from './SelectionToolbar';

/**
 * Contexts
 */
export * from './contexts/AccessibilityProfileContext';
export * from './contexts/PreferencesContext';

/**
 * Hooks
 */
export * from './hooks';

/**
 * Utilities
 */
export * from './utils/waveform';
export * from './utils/spectrogram';
export * from './utils/projectStorage';
export * from './utils/scrollIntoViewIfNeeded';
// Note: envelope utilities are available via direct import from '@dilsonspickles/components/utils/envelope'
// Not re-exported here to avoid naming conflicts with EnvelopePoint component
