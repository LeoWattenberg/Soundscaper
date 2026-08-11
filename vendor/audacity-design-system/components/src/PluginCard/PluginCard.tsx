import React from 'react';
import { Button } from '../Button';
import { Icon } from '../Icon';
import './PluginCard.css';

export interface PluginCardProps {
  /**
   * Plugin name
   */
  name: string;
  /**
   * Plugin description
   */
  description: string;
  /**
   * Optional image URL for plugin thumbnail
   */
  imageUrl?: string;
  /**
   * Optional version requirement message
   */
  requiresVersion?: string;
  /**
   * Click handler for the action button
   */
  onActionClick?: () => void;
  /**
   * Custom action button text
   * @default 'Get it on MuseHub'
   */
  actionButtonText?: string;
  /**
   * Whether the card is disabled
   */
  disabled?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * PluginCard - Display card for a plugin/effect in the browser
 */
export const PluginCard: React.FC<PluginCardProps> = ({
  name,
  description,
  imageUrl,
  requiresVersion,
  onActionClick,
  actionButtonText = 'Get it on MuseHub',
  disabled = false,
  className = '',
}) => {
  return (
    <div className={`plugin-card ${disabled ? 'plugin-card--disabled' : ''} ${className}`}>
      <div className="plugin-card__image">
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="plugin-card__image-img" />
        ) : (
          <div className="plugin-card__image-placeholder">
            <Icon name="plugins" size={48} />
          </div>
        )}
      </div>
      <div className="plugin-card__content">
        <h3 className="plugin-card__name">{name}</h3>
        <p className="plugin-card__description">{description}</p>
        {requiresVersion && (
          <p className="plugin-card__version">
            IMPORTANT: Requires {requiresVersion}
          </p>
        )}
        <div className="plugin-card__actions">
          <Button variant="primary" size="small" onClick={onActionClick} disabled={disabled}>
            {actionButtonText}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PluginCard;
