/**
 * ExportModal - Modal dialog for exporting audio
 * Based on Figma design: node-id=9119-62209
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../ThemeProvider';
import { DialogHeader } from '../DialogHeader';
import { Button } from '../Button';
import { Dropdown, DropdownOption } from '../Dropdown';
import { TextInput } from '../TextInput';
import { LabeledRadio } from '../LabeledRadio';
import { LabeledCheckbox } from '../LabeledCheckbox';
import { Separator } from '../Separator';
import { ChannelMappingDialog } from '../ChannelMappingDialog';
import { useTabGroup } from '../hooks/useTabGroup';
import './ExportModal.css';

export interface ExportModalProps {
  /**
   * Whether the modal is open
   */
  isOpen: boolean;
  /**
   * Callback when the modal is closed
   */
  onClose: () => void;
  /**
   * Callback when export is triggered
   */
  onExport?: (settings: ExportSettings) => void;
  /**
   * Callback when edit metadata is clicked
   */
  onEditMetadata?: () => void;
  /**
   * Operating system for platform-specific header controls
   * @default 'macos'
   */
  os?: 'macos' | 'windows';
  /**
   * Initial export type to set when modal opens
   */
  initialExportType?: string;
  /**
   * Whether a loop region is currently active
   */
  hasLoopRegion?: boolean;
  /**
   * Callback to show validation error (e.g., no loop region)
   */
  onValidationError?: (title: string, message: string) => void;
  /**
   * Array of tracks for channel mapping
   */
  tracks?: Array<{ id: number; name: string }>;
}

export interface ExportSettings {
  exportType: string;
  fileName: string;
  folder: string;
  format: string;
  channels: 'mono' | 'stereo' | 'custom';
  sampleRate: string;
  encoding: string;
  trimBlankSpace: boolean;
  fileNamePrefix?: string;
  includeNumbers?: boolean;
}

/**
 * Get file extension based on format
 */
function getFileExtension(format: string): string {
  const extensionMap: Record<string, string> = {
    'wav': 'wav',
    'aiff': 'aiff',
    'other-uncompressed': 'aiff',
    'mp3': 'mp3',
    'ogg': 'ogg',
    'opus': 'opus',
    'flac': 'flac',
    'wavpack': 'wv',
    'm4a': 'm4a',
    'ac3': 'ac3',
    'amr': 'amr',
    'wma': 'wma',
    'custom-ffmpeg': '[last_selected_format]',
    'mp2': 'mp2',
    'external': '[last_selected_format]',
    'txt': 'txt',
  };
  return extensionMap[format] || 'wav';
}

const exportTypeOptions: DropdownOption[] = [
  { value: 'full-project', label: 'Export full project audio' },
  { value: 'selected-audio', label: 'Export selected audio' },
  { value: 'loop-region', label: 'Export audio in loop region' },
  { value: 'separator-1', label: '---', disabled: true },
  { value: 'separate-tracks', label: 'Export tracks as separate audio files (stems)' },
  { value: 'label-audio', label: 'Export each label as a separate audio file (chapters)' },
  { value: 'separator-2', label: '---', disabled: true },
  { value: 'label-subtitle', label: 'Export all labels as a subtitle file' },
];

const formatOptions: DropdownOption[] = [
  { value: 'wav', label: 'WAV' },
  { value: 'aiff', label: 'AIFF (Apple/SGI)' },
  { value: 'other-uncompressed', label: 'Other uncompressed files' },
  { value: 'mp3', label: 'MP3' },
  { value: 'ogg', label: 'Ogg Vorbis Files' },
  { value: 'opus', label: 'Opus' },
  { value: 'flac', label: 'FLAC' },
  { value: 'wavpack', label: 'WavPack Files' },
  { value: 'm4a', label: 'M4A' },
  { value: 'ac3', label: 'AC3 Files' },
  { value: 'amr', label: 'AMR (narrow band) Files (FFmpeg)' },
  { value: 'wma', label: 'WMA (version 2) Files (FFmpeg)' },
  { value: 'custom-ffmpeg', label: 'Custom FFmpeg Export' },
  { value: 'mp2', label: 'MP2 Files' },
  { value: 'external', label: 'External program' },
  { value: 'txt', label: 'TXT' },
];

const sampleRateOptions: DropdownOption[] = [
  { value: '44100', label: '44100 Hz' },
  { value: '48000', label: '48000 Hz' },
  { value: '96000', label: '96000 Hz' },
  { value: '192000', label: '192000 Hz' },
];

const encodingOptions: DropdownOption[] = [
  { value: 'signed-8bit', label: 'Signed 8-bit PCM' },
  { value: 'signed-16bit', label: 'Signed 16-bit PCM' },
  { value: 'signed-24bit', label: 'Signed 24-bit PCM' },
  { value: 'signed-32bit', label: 'Signed 32-bit PCM' },
  { value: 'float-32bit', label: '32-bit float' },
];

const headerOptions: DropdownOption[] = [
  { value: 'aiff', label: 'AIFF' },
  { value: 'caf', label: 'CAF' },
  { value: 'wav', label: 'WAV' },
];

const bitRateModeOptions: DropdownOption[] = [
  { value: 'preset', label: 'Preset' },
  { value: 'constant', label: 'Constant' },
  { value: 'variable', label: 'Variable' },
];

const qualityOptions: DropdownOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'extreme', label: 'Extreme' },
];

const bitDepthOptions: DropdownOption[] = [
  { value: '16', label: '16-bit' },
  { value: '24', label: '24-bit' },
];

const levelOptions: DropdownOption[] = [
  { value: '5', label: '5' },
  { value: '8', label: '8' },
];

const bitRateOptions: DropdownOption[] = [
  { value: '128', label: '128 kbps' },
  { value: '192', label: '192 kbps' },
  { value: '256', label: '256 kbps' },
  { value: '320', label: '320 kbps' },
];

const vbrModeOptions: DropdownOption[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
  { value: 'constrained', label: 'Constrained' },
];

const optimizeForOptions: DropdownOption[] = [
  { value: 'audio', label: 'Audio' },
  { value: 'voice', label: 'Voice' },
];

const cutoffOptions: DropdownOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
];

const mp2VersionOptions: DropdownOption[] = [
  { value: 'mpeg1', label: 'MPEG-1 Layer II' },
  { value: 'mpeg2', label: 'MPEG-2 Layer II' },
];

interface TabGroupFieldProps {
  groupId: string;
  itemIndex: number;
  totalItems: number;
  itemRefs: React.RefObject<(HTMLElement | null)[]>;
  activeIndexRef: React.MutableRefObject<number>;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  resetKey?: string | number;
  children: React.ReactNode;
}

/**
 * Wrapper component that applies tab group behavior to form fields
 */
function TabGroupField({
  groupId,
  itemIndex,
  totalItems,
  itemRefs,
  activeIndexRef,
  activeIndex = 0,
  onActiveIndexChange,
  resetKey,
  children,
}: TabGroupFieldProps) {
  const fieldRef = useRef<HTMLDivElement>(null);

  const { tabIndex, onKeyDown, onFocus, onBlur } = useTabGroup({
    groupId,
    itemIndex,
    totalItems,
    itemRefs,
    activeIndexRef,
    activeIndex,
    resetKey,
    onItemActivate: (newIndex) => {
      onActiveIndexChange?.(newIndex);
    },
  });

  // Store ref to focusable element for navigation
  useEffect(() => {
    if (!fieldRef.current || !itemRefs.current) return;

    const focusableElement = fieldRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [role="checkbox"], [role="radio"]'
    );

    if (focusableElement) {
      // Store the fieldRef wrapper so blur handler can detect focus within descendants
      itemRefs.current[itemIndex] = fieldRef.current;

      const handlers: Array<{ type: string; handler: (e: Event) => void }> = [];

      // Add keyboard handler
      if (onKeyDown) {
        const keydownHandler = (e: Event) => {
          const keyEvent = e as KeyboardEvent;
          // Don't handle Space/Enter - let the element's own handler deal with it
          if (keyEvent.key === ' ' || keyEvent.key === 'Enter') {
            return;
          }
          onKeyDown(e as any);
        };
        focusableElement.addEventListener('keydown', keydownHandler);
        handlers.push({ type: 'keydown', handler: keydownHandler });
      }

      // Add focus handler
      if (onFocus) {
        const focusHandler = (e: Event) => {
          onFocus(e as any);
        };
        focusableElement.addEventListener('focus', focusHandler);
        handlers.push({ type: 'focus', handler: focusHandler });
      }

      // Add blur handler
      if (onBlur) {
        const blurHandler = (e: Event) => {
          onBlur(e as any);
        };
        focusableElement.addEventListener('blur', blurHandler);
        handlers.push({ type: 'blur', handler: blurHandler });
      }

      return () => {
        handlers.forEach(({ type, handler }) => {
          focusableElement.removeEventListener(type, handler);
        });
      };
    }
  }, [onKeyDown, onFocus, onBlur, itemIndex, itemRefs]);

  // Clone children and inject tabIndex prop into interactive components
  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      // Check if it's a Dropdown, TextInput, LabeledCheckbox, LabeledRadio, or Button component
      if (child.type === Dropdown || child.type === TextInput || child.type === Button) {
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex });
      }
      // For LabeledCheckbox components
      if ((child.type as any).name === 'LabeledCheckbox' || child.type === LabeledCheckbox) {
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex });
      }
      // For LabeledRadio components
      if ((child.type as any).name === 'LabeledRadio' || child.type === LabeledRadio) {
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex });
      }
    }
    return child;
  });

  return <div ref={fieldRef}>{childrenWithProps}</div>;
}

/**
 * ExportModal component - Modal for exporting audio with various options
 */
export function ExportModal({
  isOpen,
  onClose,
  onExport,
  onEditMetadata,
  os = 'macos',
  initialExportType,
  hasLoopRegion = false,
  onValidationError,
  tracks = [],
}: ExportModalProps) {
  const { theme } = useTheme();

  const [exportType, setExportType] = useState('full-project');

  // Update export type when modal opens with initialExportType
  useEffect(() => {
    if (isOpen && initialExportType) {
      setExportType(initialExportType);
    }
  }, [isOpen, initialExportType]);
  const [fileName, setFileName] = useState('untitled.wav');
  const [folder, setFolder] = useState('C:\\Users\\mom\\Documents\\Audacity');
  const [format, setFormat] = useState('wav');
  const [channels, setChannels] = useState<'mono' | 'stereo' | 'custom'>('mono');
  const [sampleRate, setSampleRate] = useState('44100');
  const [encoding, setEncoding] = useState('signed-8bit');
  const [trimBlankSpace, setTrimBlankSpace] = useState(false);
  const [fileNamePrefix, setFileNamePrefix] = useState('');
  const [includeNumbers, setIncludeNumbers] = useState(false);

  // Format-specific audio options
  const [header, setHeader] = useState('wav');
  const [bitRateMode, setBitRateMode] = useState('preset');
  const [quality, setQuality] = useState('medium');
  const [bitDepth, setBitDepth] = useState('16');
  const [level, setLevel] = useState('5');
  const [bitRate, setBitRate] = useState('256');
  const [vbrMode, setVbrMode] = useState('on');
  const [optimizeFor, setOptimizeFor] = useState('audio');
  const [cutoff, setCutoff] = useState('auto');
  const [mp2Version, setMp2Version] = useState('mpeg1');
  const [currentFormat, setCurrentFormat] = useState('');
  const [currentCodec, setCurrentCodec] = useState('');
  const [externalCommand, setExternalCommand] = useState('');
  const [showOutput, setShowOutput] = useState(false);

  // Channel mapping dialog state
  const [isChannelMappingOpen, setIsChannelMappingOpen] = useState(false);
  const [channelMapping, setChannelMapping] = useState<boolean[][] | undefined>(undefined);

  // Tab group state for accessibility
  // Tab Group 1: Export type
  const exportTypeRefs = useRef<(HTMLElement | null)[]>([]);
  const exportTypeActiveIndexRef = useRef<number>(0);
  const [exportTypeActiveIndex, setExportTypeActiveIndex] = useState<number>(0);

  // Tab Group 2: File (filename, folder, format)
  const fileRefs = useRef<(HTMLElement | null)[]>([]);
  const fileActiveIndexRef = useRef<number>(0);
  const [fileActiveIndex, setFileActiveIndex] = useState<number>(0);

  // Tab Group 3: Audio options (channels, sample rate, encoding)
  const audioOptionsRefs = useRef<(HTMLElement | null)[]>([]);
  const audioOptionsActiveIndexRef = useRef<number>(0);
  const [audioOptionsActiveIndex, setAudioOptionsActiveIndex] = useState<number>(0);

  // Tab Group 4: Rendering (trim checkbox)
  const renderingRefs = useRef<(HTMLElement | null)[]>([]);
  const renderingActiveIndexRef = useRef<number>(0);
  const [renderingActiveIndex, setRenderingActiveIndex] = useState<number>(0);

  // Tab Group 5: Footer buttons (Edit metadata, Cancel, Export)
  const footerRefs = useRef<(HTMLElement | null)[]>([]);
  const footerActiveIndexRef = useRef<number>(0);
  const [footerActiveIndex, setFooterActiveIndex] = useState<number>(0);

  // Update file name when format changes for full-project, selected-audio, or loop-region export
  useEffect(() => {
    if (exportType === 'full-project' || exportType === 'selected-audio' || exportType === 'loop-region') {
      const baseName = fileName.replace(/\.[^.]+$/, '');
      const extension = getFileExtension(format);
      setFileName(`${baseName}.${extension}`);
    }
  }, [format, exportType]);

  const handleExportTypeChange = (newType: string) => {
    // Validate loop region export type selection
    if (newType === 'loop-region' && !hasLoopRegion) {
      onValidationError?.(
        'No loop region',
        'Export audio in loop region requires an active loop in the project. Please go back, create a loop and try again.'
      );
      return;
    }
    setExportType(newType);
  };

  const handleExport = () => {
    const settings: ExportSettings = {
      exportType,
      fileName,
      folder,
      format,
      channels,
      sampleRate,
      encoding,
      trimBlankSpace,
      fileNamePrefix,
      includeNumbers,
    };
    onExport?.(settings);
    onClose();
  };

  const handleBrowseFolder = () => {
    // In a real implementation, this would open a file browser
    console.log('Browse for folder');
  };

  const style = {
    '--bg-dialog-body': theme.background.dialog.body,
    '--bg-dialog-footer': theme.background.dialog.footer,
  } as React.CSSProperties;

  if (!isOpen) return null;

  return (
    <div className="export-modal__overlay" onClick={onClose}>
      <div
        className="export-modal"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title="Export" onClose={onClose} os={os} />

        <div className="export-modal__body">
        {/* Export type section */}
        <section className="export-modal__section">
          <h3 className="export-modal__section-title">Export</h3>
          <div className="export-modal__field export-modal__field--medium">
            <label className="export-modal__label">Type</label>
            <TabGroupField
              groupId="export-type"
              itemIndex={0}
              totalItems={1}
              itemRefs={exportTypeRefs}
              activeIndexRef={exportTypeActiveIndexRef}
              activeIndex={exportTypeActiveIndex}
              onActiveIndexChange={setExportTypeActiveIndex}
              resetKey="export-modal"
            >
              <Dropdown
                options={exportTypeOptions}
                value={exportType}
                onChange={handleExportTypeChange}
              />
            </TabGroupField>
          </div>
        </section>

        <Separator />

        {/* File section */}
        <section className="export-modal__section">
          <h3 className="export-modal__section-title">File</h3>

          {/* File name field - label changes based on export type */}
          <div className="export-modal__field export-modal__field--large">
            <label className="export-modal__label">
              {exportType === 'separate-tracks' || exportType === 'label-audio' || exportType === 'label-subtitle'
                ? 'File name preview'
                : 'File name'}
            </label>
            <div className="export-modal__input-wrapper">
              <TabGroupField
                groupId="file"
                itemIndex={0}
                totalItems={4}
                itemRefs={fileRefs}
                activeIndexRef={fileActiveIndexRef}
                activeIndex={fileActiveIndex}
                onActiveIndexChange={setFileActiveIndex}
                resetKey="export-modal"
              >
                {/* Show editable input for full-project, selected-audio, and loop-region, read-only preview for others */}
                {exportType === 'full-project' || exportType === 'selected-audio' || exportType === 'loop-region' ? (
                  <TextInput
                    value={fileName}
                    onChange={setFileName}
                  />
                ) : (
                  <TextInput
                    value={`TrackName.${getFileExtension(format)}`}
                    onChange={() => {}}
                    disabled
                  />
                )}
              </TabGroupField>
              {/* Invisible button matching Browse button below for perfect alignment */}
              <div style={{ visibility: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
                <Button variant="secondary" tabIndex={-1}>
                  Browse...
                </Button>
              </div>
            </div>
          </div>

          {/* File name prefix - only for separate-tracks and label-audio */}
          {(exportType === 'separate-tracks' || exportType === 'label-audio') && (
            <div className="export-modal__field export-modal__field--large">
              <label className="export-modal__label">File name prefix</label>
              <div className="export-modal__input-wrapper">
                <TextInput
                  value={fileNamePrefix}
                  onChange={setFileNamePrefix}
                />
                {/* Invisible button for alignment */}
                <div style={{ visibility: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
                  <Button variant="secondary" tabIndex={-1}>
                    Browse...
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Folder field */}
          <div className="export-modal__field export-modal__field--large">
            <label className="export-modal__label">Folder</label>
            <div className="export-modal__input-wrapper">
              <TabGroupField
                groupId="file"
                itemIndex={1}
                totalItems={4}
                itemRefs={fileRefs}
                activeIndexRef={fileActiveIndexRef}
                activeIndex={fileActiveIndex}
                onActiveIndexChange={setFileActiveIndex}
                resetKey="export-modal"
              >
                <TextInput
                  value={folder}
                  onChange={setFolder}
                />
              </TabGroupField>
              <TabGroupField
                groupId="file"
                itemIndex={2}
                totalItems={4}
                itemRefs={fileRefs}
                activeIndexRef={fileActiveIndexRef}
                activeIndex={fileActiveIndex}
                onActiveIndexChange={setFileActiveIndex}
                resetKey="export-modal"
              >
                <Button variant="secondary" onClick={handleBrowseFolder}>
                  Browse...
                </Button>
              </TabGroupField>
            </div>
          </div>

          {/* Format dropdown */}
          <div className="export-modal__field export-modal__field--small">
            <label className="export-modal__label">Format</label>
            <TabGroupField
              groupId="file"
              itemIndex={3}
              totalItems={4}
              itemRefs={fileRefs}
              activeIndexRef={fileActiveIndexRef}
              activeIndex={fileActiveIndex}
              onActiveIndexChange={setFileActiveIndex}
              resetKey="export-modal"
            >
              <Dropdown
                options={formatOptions}
                value={format}
                onChange={setFormat}
              />
            </TabGroupField>
          </div>

          {/* Checkbox - only for separate-tracks and label-audio */}
          {(exportType === 'separate-tracks' || exportType === 'label-audio') && (
            <div className="export-modal__field export-modal__field--checkbox" style={{ paddingLeft: '154px' }}>
              <LabeledCheckbox
                label={exportType === 'label-audio' ? 'Include label numbers' : 'Include track numbers'}
                checked={includeNumbers}
                onChange={setIncludeNumbers}
              />
            </div>
          )}
        </section>

        <Separator />

        {/* Audio options section */}
        <section className="export-modal__section">
          <h3 className="export-modal__section-title">Audio options</h3>

          {/* Channels - shown for all formats except Custom FFmpeg and External program */}
          {format !== 'custom-ffmpeg' && format !== 'external' && (
            <>
              <div className="export-modal__field export-modal__field--radio-group">
                <label className="export-modal__label">Channels</label>
                <div className="export-modal__radio-group">
                  <TabGroupField
                    groupId="audio-options"
                    itemIndex={0}
                    totalItems={6}
                    itemRefs={audioOptionsRefs}
                    activeIndexRef={audioOptionsActiveIndexRef}
                    activeIndex={audioOptionsActiveIndex}
                    onActiveIndexChange={setAudioOptionsActiveIndex}
                    resetKey="export-modal"
                  >
                    <LabeledRadio
                      label="Mono"
                      checked={channels === 'mono'}
                      onChange={() => setChannels('mono')}
                      name="channels"
                    />
                  </TabGroupField>
                  <TabGroupField
                    groupId="audio-options"
                    itemIndex={1}
                    totalItems={6}
                    itemRefs={audioOptionsRefs}
                    activeIndexRef={audioOptionsActiveIndexRef}
                    activeIndex={audioOptionsActiveIndex}
                    onActiveIndexChange={setAudioOptionsActiveIndex}
                    resetKey="export-modal"
                  >
                    <LabeledRadio
                      label="Stereo"
                      checked={channels === 'stereo'}
                      onChange={() => setChannels('stereo')}
                      name="channels"
                    />
                  </TabGroupField>
                  <TabGroupField
                    groupId="audio-options"
                    itemIndex={2}
                    totalItems={6}
                    itemRefs={audioOptionsRefs}
                    activeIndexRef={audioOptionsActiveIndexRef}
                    activeIndex={audioOptionsActiveIndex}
                    onActiveIndexChange={setAudioOptionsActiveIndex}
                    resetKey="export-modal"
                  >
                    <LabeledRadio
                      label="Custom mapping"
                      checked={channels === 'custom'}
                      onChange={() => setChannels('custom')}
                      name="channels"
                    />
                  </TabGroupField>
                </div>
              </div>

              {/* Edit mapping button - shown when Custom mapping is selected */}
              <div className="export-modal__field" style={{ paddingLeft: '154px', display: channels === 'custom' ? 'block' : 'none' }}>
                <TabGroupField
                  groupId="audio-options"
                  itemIndex={3}
                  totalItems={6}
                  itemRefs={audioOptionsRefs}
                  activeIndexRef={audioOptionsActiveIndexRef}
                  activeIndex={audioOptionsActiveIndex}
                  onActiveIndexChange={setAudioOptionsActiveIndex}
                  resetKey="export-modal"
                >
                  <Button
                    variant="secondary"
                    onClick={() => setIsChannelMappingOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setIsChannelMappingOpen(true);
                      }
                    }}
                  >
                    Edit mapping
                  </Button>
                </TabGroupField>
              </div>
            </>
          )}

          {/* Sample rate - shown for all formats except Custom FFmpeg and External program */}
          {format !== 'custom-ffmpeg' && format !== 'external' && (
            <div className="export-modal__field export-modal__field--small">
              <label className="export-modal__label">Sample rate</label>
              <TabGroupField
                groupId="audio-options"
                itemIndex={4}
                totalItems={6}
                itemRefs={audioOptionsRefs}
                activeIndexRef={audioOptionsActiveIndexRef}
                activeIndex={audioOptionsActiveIndex}
                onActiveIndexChange={setAudioOptionsActiveIndex}
                resetKey="export-modal"
              >
                <Dropdown
                  options={sampleRateOptions}
                  value={sampleRate}
                  onChange={setSampleRate}
                />
              </TabGroupField>
            </div>
          )}

          {/* Format-specific fields */}
          {/* WAV: Encoding */}
          {format === 'wav' && (
            <div className="export-modal__field export-modal__field--small">
              <label className="export-modal__label">Encoding</label>
              <TabGroupField
                groupId="audio-options"
                itemIndex={5}
                totalItems={6}
                itemRefs={audioOptionsRefs}
                activeIndexRef={audioOptionsActiveIndexRef}
                activeIndex={audioOptionsActiveIndex}
                onActiveIndexChange={setAudioOptionsActiveIndex}
                resetKey="export-modal"
              >
                <Dropdown
                  options={encodingOptions}
                  value={encoding}
                  onChange={setEncoding}
                />
              </TabGroupField>
            </div>
          )}

          {/* AIFF: Encoding */}
          {format === 'aiff' && (
            <div className="export-modal__field export-modal__field--small">
              <label className="export-modal__label">Encoding</label>
              <TabGroupField
                groupId="audio-options"
                itemIndex={5}
                totalItems={6}
                itemRefs={audioOptionsRefs}
                activeIndexRef={audioOptionsActiveIndexRef}
                activeIndex={audioOptionsActiveIndex}
                onActiveIndexChange={setAudioOptionsActiveIndex}
                resetKey="export-modal"
              >
                <Dropdown
                  options={encodingOptions}
                  value={encoding}
                  onChange={setEncoding}
                />
              </TabGroupField>
            </div>
          )}

          {/* Other uncompressed: Header, Encoding */}
          {format === 'other-uncompressed' && (
            <>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Header</label>
                <Dropdown
                  options={headerOptions}
                  value={header}
                  onChange={setHeader}
                />
              </div>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Encoding</label>
                <Dropdown
                  options={encodingOptions}
                  value={encoding}
                  onChange={setEncoding}
                />
              </div>
            </>
          )}

          {/* MP3: Bit rate mode, Quality */}
          {format === 'mp3' && (
            <>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Bit rate mode</label>
                <Dropdown
                  options={bitRateModeOptions}
                  value={bitRateMode}
                  onChange={setBitRateMode}
                />
              </div>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Quality</label>
                <Dropdown
                  options={qualityOptions}
                  value={quality}
                  onChange={setQuality}
                />
              </div>
            </>
          )}

          {/* Ogg Vorbis: Quality */}
          {format === 'ogg' && (
            <div className="export-modal__field export-modal__field--small">
              <label className="export-modal__label">Quality</label>
              <Dropdown
                options={qualityOptions}
                value={quality}
                onChange={setQuality}
              />
            </div>
          )}

          {/* Opus: Quality, VBR mode, Optimize for, Cut off */}
          {format === 'opus' && (
            <>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Quality</label>
                <Dropdown
                  options={qualityOptions}
                  value={quality}
                  onChange={setQuality}
                />
              </div>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">VBR mode</label>
                <Dropdown
                  options={vbrModeOptions}
                  value={vbrMode}
                  onChange={setVbrMode}
                />
              </div>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Optimize for</label>
                <Dropdown
                  options={optimizeForOptions}
                  value={optimizeFor}
                  onChange={setOptimizeFor}
                />
              </div>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Cut off</label>
                <Dropdown
                  options={cutoffOptions}
                  value={cutoff}
                  onChange={setCutoff}
                />
              </div>
            </>
          )}

          {/* FLAC: Bit depth, Level */}
          {format === 'flac' && (
            <>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Bit depth</label>
                <Dropdown
                  options={bitDepthOptions}
                  value={bitDepth}
                  onChange={setBitDepth}
                />
              </div>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Level</label>
                <Dropdown
                  options={levelOptions}
                  value={level}
                  onChange={setLevel}
                />
              </div>
            </>
          )}

          {/* WavPack: Quality, Bit depth */}
          {format === 'wavpack' && (
            <>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Quality</label>
                <Dropdown
                  options={qualityOptions}
                  value={quality}
                  onChange={setQuality}
                />
              </div>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Bit depth</label>
                <Dropdown
                  options={bitDepthOptions}
                  value={bitDepth}
                  onChange={setBitDepth}
                />
              </div>
            </>
          )}

          {/* M4A: Quality with stepper */}
          {format === 'm4a' && (
            <div className="export-modal__field export-modal__field--large">
              <label className="export-modal__label">Quality</label>
              <div className="export-modal__input-wrapper">
                <TextInput
                  value={`${bitRate} kbps`}
                  onChange={() => {}}
                  disabled
                />
                {/* Invisible button for alignment */}
                <div style={{ visibility: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
                  <Button variant="secondary" tabIndex={-1}>
                    Browse...
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* AC3: Bit rate */}
          {format === 'ac3' && (
            <div className="export-modal__field export-modal__field--small">
              <label className="export-modal__label">Bit rate</label>
              <Dropdown
                options={bitRateOptions}
                value={bitRate}
                onChange={setBitRate}
              />
            </div>
          )}

          {/* AMR: Bit rate */}
          {format === 'amr' && (
            <div className="export-modal__field export-modal__field--small">
              <label className="export-modal__label">Bit rate</label>
              <Dropdown
                options={bitRateOptions}
                value={bitRate}
                onChange={setBitRate}
              />
            </div>
          )}

          {/* WMA: Bit rate */}
          {format === 'wma' && (
            <div className="export-modal__field export-modal__field--small">
              <label className="export-modal__label">Bit rate</label>
              <Dropdown
                options={bitRateOptions}
                value={bitRate}
                onChange={setBitRate}
              />
            </div>
          )}

          {/* MP2: Version, Bit rate */}
          {format === 'mp2' && (
            <>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Version</label>
                <Dropdown
                  options={mp2VersionOptions}
                  value={mp2Version}
                  onChange={setMp2Version}
                />
              </div>
              <div className="export-modal__field export-modal__field--small">
                <label className="export-modal__label">Bit rate</label>
                <Dropdown
                  options={bitRateOptions}
                  value={bitRate}
                  onChange={setBitRate}
                />
              </div>
            </>
          )}

          {/* Custom FFmpeg: Button, Current format, Current codec */}
          {format === 'custom-ffmpeg' && (
            <>
              <div className="export-modal__field" style={{ paddingLeft: '154px' }}>
                <Button variant="secondary" onClick={() => console.log('Open FFmpeg options')}>
                  Open custom FFmpeg format options
                </Button>
              </div>
              <div className="export-modal__field export-modal__field--large">
                <label className="export-modal__label">Current format</label>
                <div className="export-modal__input-wrapper">
                  <TextInput
                    value={currentFormat}
                    onChange={setCurrentFormat}
                  />
                  <div style={{ visibility: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
                    <Button variant="secondary" tabIndex={-1}>
                      Browse...
                    </Button>
                  </div>
                </div>
              </div>
              <div className="export-modal__field export-modal__field--large">
                <label className="export-modal__label">Current codec</label>
                <div className="export-modal__input-wrapper">
                  <TextInput
                    value={currentCodec}
                    onChange={setCurrentCodec}
                  />
                  <div style={{ visibility: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
                    <Button variant="secondary" tabIndex={-1}>
                      Browse...
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* External program: Help text, Command, Show output checkbox */}
          {format === 'external' && (
            <>
              <div className="export-modal__field" style={{ paddingLeft: '154px' }}>
                <div style={{
                  padding: '8px',
                  backgroundColor: '#ebedf0',
                  border: '1px solid #d2d6dd',
                  borderRadius: '4px',
                  fontSize: '12px',
                  lineHeight: '16px',
                }}>
                  Data will be piped to standard in. "%f" uses the file name in the export window.
                </div>
              </div>
              <div className="export-modal__field export-modal__field--large">
                <label className="export-modal__label">Command</label>
                <div className="export-modal__input-wrapper">
                  <div style={{ flex: 1 }} />
                  <Button variant="secondary" onClick={handleBrowseFolder}>
                    Browse...
                  </Button>
                </div>
              </div>
              <div className="export-modal__field export-modal__field--checkbox" style={{ paddingLeft: '154px' }}>
                <LabeledCheckbox
                  label="Show output"
                  checked={showOutput}
                  onChange={setShowOutput}
                />
              </div>
            </>
          )}
        </section>

        <Separator />

        {/* Rendering section */}
        <section className="export-modal__section">
          <h3 className="export-modal__section-title">Rendering</h3>
          <TabGroupField
            groupId="rendering"
            itemIndex={0}
            totalItems={1}
            itemRefs={renderingRefs}
            activeIndexRef={renderingActiveIndexRef}
            activeIndex={renderingActiveIndex}
            onActiveIndexChange={setRenderingActiveIndex}
            resetKey="export-modal"
          >
            <LabeledCheckbox
              label="Trim blank space before first clip"
              checked={trimBlankSpace}
              onChange={setTrimBlankSpace}
            />
          </TabGroupField>
        </section>
      </div>

      {/* Footer */}
      <div className="export-modal__footer">
        <TabGroupField
          groupId="footer"
          itemIndex={0}
          totalItems={3}
          itemRefs={footerRefs}
          activeIndexRef={footerActiveIndexRef}
          activeIndex={footerActiveIndex}
          onActiveIndexChange={setFooterActiveIndex}
          resetKey="export-modal"
        >
          <Button variant="secondary" onClick={onEditMetadata}>
            Edit metadata
          </Button>
        </TabGroupField>
        <div className="export-modal__button-group">
          <TabGroupField
            groupId="footer"
            itemIndex={1}
            totalItems={3}
            itemRefs={footerRefs}
            activeIndexRef={footerActiveIndexRef}
            activeIndex={footerActiveIndex}
            onActiveIndexChange={setFooterActiveIndex}
            resetKey="export-modal"
          >
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </TabGroupField>
          <TabGroupField
            groupId="footer"
            itemIndex={2}
            totalItems={3}
            itemRefs={footerRefs}
            activeIndexRef={footerActiveIndexRef}
            activeIndex={footerActiveIndex}
            onActiveIndexChange={setFooterActiveIndex}
            resetKey="export-modal"
          >
            <Button variant="primary" onClick={handleExport}>
              Export
            </Button>
          </TabGroupField>
        </div>
      </div>

      {/* Channel Mapping Dialog */}
      {isChannelMappingOpen && (
        <ChannelMappingDialog
          tracks={tracks}
          channelCount={17}
          initialMapping={channelMapping}
          onApply={(mapping) => {
            setChannelMapping(mapping);
            setIsChannelMappingOpen(false);
          }}
          onCancel={() => setIsChannelMappingOpen(false)}
          open={true}
          os={os}
        />
      )}
      </div>
    </div>
  );
}

export default ExportModal;
