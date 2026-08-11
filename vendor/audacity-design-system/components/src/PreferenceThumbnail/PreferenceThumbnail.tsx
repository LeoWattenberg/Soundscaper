import React from 'react';
import { useTheme } from '../ThemeProvider';
import './PreferenceThumbnail.css';

export interface PreferenceThumbnailProps {
  /**
   * URL or path to the image/gif
   */
  src: string;
  /**
   * Alt text for the image
   */
  alt: string;
  /**
   * Label text for the radio button
   */
  label: string;
  /**
   * Whether this option is selected
   */
  checked: boolean;
  /**
   * Change handler
   */
  onChange: (checked: boolean) => void;
  /**
   * Radio button name (for grouping)
   */
  name: string;
  /**
   * Value for the radio button
   */
  value: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const PreferenceThumbnail: React.FC<PreferenceThumbnailProps> = ({
  src,
  alt,
  label,
  checked,
  onChange,
  name,
  value,
  className = '',
}) => {
  const { theme } = useTheme();

  const style = {
    '--preference-thumbnail-bg': theme.background.surface.subtle,
    '--preference-thumbnail-selected-outline': theme.border.focus,
    '--preference-thumbnail-label-text': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <div className={`preference-thumbnail ${className}`} style={style}>
      <button
        type="button"
        className={`preference-thumbnail__image-button ${checked ? 'preference-thumbnail__image-button--selected' : ''}`}
        onClick={() => onChange(true)}
        aria-label={`Select ${label}`}
      >
        <img
          src={src}
          alt={alt}
          className="preference-thumbnail__image"
        />
      </button>
      <label className="preference-thumbnail__radio-label">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="preference-thumbnail__radio"
        />
        <span className="preference-thumbnail__label-text">{label}</span>
      </label>
    </div>
  );
};

export default PreferenceThumbnail;
