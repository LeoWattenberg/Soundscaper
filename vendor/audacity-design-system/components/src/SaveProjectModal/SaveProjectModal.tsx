import React from 'react';
import { DialogHeader } from '../DialogHeader';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { useTheme } from '../ThemeProvider';
import './SaveProjectModal.css';

export interface SaveProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveToCloud: () => void;
  onSaveToComputer: () => void;
  dontShowAgain?: boolean;
  onDontShowAgainChange?: (checked: boolean) => void;
  cloudImageUrl?: string;
  computerImageUrl?: string;
  os?: 'macos' | 'windows';
  className?: string;
}

export function SaveProjectModal({
  isOpen,
  onClose,
  onSaveToCloud,
  onSaveToComputer,
  dontShowAgain = false,
  onDontShowAgainChange,
  cloudImageUrl = '/saveToCloud.png',
  computerImageUrl = '/saveToComputer.png',
  os = 'macos',
  className = '',
}: SaveProjectModalProps) {
  const { theme } = useTheme();

  const style = {
    '--save-modal-bg': theme.background.surface.default,
    '--save-modal-border': theme.border.default,
    '--save-modal-shadow': '0px 10px 30px 0px rgba(0, 0, 0, 0.3)',
    '--save-modal-heading-text': theme.foreground.text.primary,
    '--save-modal-image-bg': theme.background.surface.subtle,
    '--save-modal-title-text': theme.foreground.text.primary,
    '--save-modal-desc-text': theme.foreground.text.primary,
    '--save-modal-button-bg': theme.background.surface.subtle,
    '--save-modal-button-hover-bg': theme.background.surface.hover,
    '--save-modal-button-text': theme.foreground.text.primary,
    '--save-modal-footer-bg': theme.background.surface.default,
    '--save-modal-footer-border': theme.border.default,
    '--save-modal-checkbox-bg': theme.background.surface.subtle,
    '--save-modal-checkbox-checked-bg': theme.border.focus,
    '--save-modal-checkbox-icon': theme.foreground.icon.inverse,
    '--save-modal-checkbox-label': theme.foreground.text.primary,
  } as React.CSSProperties;

  if (!isOpen) return null;

  return (
    <>
      <div className="save-project-modal-backdrop" onClick={onClose} />
      <div className={`save-project-modal ${className}`} style={style}>
        <DialogHeader title="Save project" onClose={onClose} os={os} />

        {/* Body */}
        <div className="save-project-modal__body">
          <h2 className="save-project-modal__heading">How would you like to save?</h2>

          <div className="save-project-modal__options">
            {/* Cloud Save Option */}
            <div className="save-project-modal__option">
              <div className="save-project-modal__option-image">
                <img src={cloudImageUrl} alt="Cloud storage" />
              </div>
              <div className="save-project-modal__option-content">
                <div className="save-project-modal__option-text">
                  <div className="save-project-modal__option-title">Save to the Cloud (free)</div>
                  <div className="save-project-modal__option-description">
                    Your project is backed up privately on audio.com. You can access your work from any device and collaborate on your project with others. Cloud saving is free for a limited number of projects.
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="default"
                  onClick={onSaveToCloud}
                >
                  Save to cloud
                </Button>
              </div>
            </div>

            {/* Computer Save Option */}
            <div className="save-project-modal__option">
              <div className="save-project-modal__option-image">
                <img src={computerImageUrl} alt="Local storage" />
              </div>
              <div className="save-project-modal__option-content">
                <div className="save-project-modal__option-text">
                  <div className="save-project-modal__option-title">On your computer</div>
                  <div className="save-project-modal__option-description">
                    Files are saved on your device.
                    <br />
                    <br />
                    Note: To export MP3 and WAV files, use File → Export Audio instead.
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="default"
                  onClick={onSaveToComputer}
                >
                  Save to computer
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="save-project-modal__footer">
          <div className="save-project-modal__checkbox-wrapper">
            <Checkbox
              checked={dontShowAgain}
              onChange={(checked) => onDontShowAgainChange?.(checked)}
              aria-label="Don't show this again"
            />
            <span className="save-project-modal__checkbox-text">Don't show this again</span>
          </div>
        </div>
      </div>
    </>
  );
}
