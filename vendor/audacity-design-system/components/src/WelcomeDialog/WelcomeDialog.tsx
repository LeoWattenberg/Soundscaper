/**
 * WelcomeDialog - Welcome screen shown on first launch
 */

import { useState, useEffect } from 'react';
import { Dialog } from '../Dialog';
import { Button } from '../Button';
import { Carousel } from '../Carousel';
import { LabeledCheckbox } from '../LabeledCheckbox';
import { usePreferences } from '../contexts/PreferencesContext';
import { useTheme } from '../ThemeProvider';
import './WelcomeDialog.css';

// Import carousel images
import slide1Image from '../assets/images/welcome/slide-1-v3-vs-v4.png';
import slide2Image from '../assets/images/welcome/slide-2-cloud.png';
import slide3Image from '../assets/images/welcome/slide-3-plugins.png';
import slide4Image from '../assets/images/welcome/slide-4-merch.png';

export interface WelcomeDialogProps {
  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
  /**
   * Callback when dialog should close
   */
  onClose: () => void;
  /**
   * LocalStorage key for "don't show again" preference
   * @default 'audacity-welcome-dialog-dismissed'
   */
  storageKey?: string;
}

interface CarouselSlide {
  title: string;
  description: string;
  buttonText: string;
  buttonAction: () => void;
  image: string;
}

const carouselSlides: CarouselSlide[] = [
  {
    title: 'What are the differences between v3 and v4?',
    description: 'In this video, we take you through the differences between Audacity 3 and Audacity 4 to help you get set up quickly.',
    buttonText: 'Watch video',
    buttonAction: () => console.log('Watch video clicked'),
    image: slide1Image,
  },
  {
    title: 'Complete your Audacity cloud setup with audio.com',
    description: 'This integration allows you to save and access your Audacity projects on any device',
    buttonText: 'Continue',
    buttonAction: () => console.log('Continue clicked'),
    image: slide2Image,
  },
  {
    title: 'Explore free plugins for sculpting your audio',
    description: 'There are tons of powerful plugins available that you can install for free on MuseHub',
    buttonText: 'View free plugins',
    buttonAction: () => console.log('View free plugins clicked'),
    image: slide3Image,
  },
  {
    title: 'Get 25th anniversary merchandise!',
    description: 'A collection of merchandise that commemorates Audacity\'s original appearance and branding',
    buttonText: 'Visit now',
    buttonAction: () => console.log('Visit now clicked'),
    image: slide4Image,
  },
];

/**
 * WelcomeDialog - Displays a welcome carousel on first launch with option to hide on subsequent loads
 */
export function WelcomeDialog({
  isOpen,
  onClose,
  storageKey = 'audacity-welcome-dialog-dismissed',
}: WelcomeDialogProps) {
  const { preferences, updatePreference } = usePreferences();
  const { theme } = useTheme();
  const [currentSlide, setCurrentSlide] = useState(0);

  const style = {
    '--welcome-dialog-bg': theme.background.surface.default,
    '--welcome-dialog-title-text': theme.foreground.text.primary,
    '--welcome-dialog-desc-text': theme.foreground.text.primary,
    '--welcome-dialog-footer-bg': theme.background.surface.default,
    '--welcome-dialog-footer-border': theme.border.default,
  } as React.CSSProperties;

  const handleClose = () => {
    onClose();
  };

  const slide = carouselSlides[currentSlide];

  return (
    <Dialog
      isOpen={isOpen}
      title="Welcome"
      os={preferences.operatingSystem}
      onClose={handleClose}
      width={800}
      noPadding={true}
      closeOnClickOutside={false}
      closeOnEscape={true}
      style={style}
      footer={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px',
            width: '100%',
            boxSizing: 'border-box',
            backgroundColor: 'var(--welcome-dialog-footer-bg)',
            borderTop: '1px solid var(--welcome-dialog-footer-border)',
            flexShrink: 0,
            ...style,
          }}
        >
          <LabeledCheckbox
            label="Show on startup"
            checked={preferences.showWelcomeDialog}
            onChange={(checked) => updatePreference('showWelcomeDialog', checked)}
          />

          <Button
            variant="secondary"
            size="default"
            onClick={handleClose}
          >
            OK
          </Button>
        </div>
      }
    >
      <div className="welcome-dialog__content">
        <h2 className="welcome-dialog__heading">{slide.title}</h2>

        {/* Carousel with Image Slides */}
        <Carousel
          onSlideChange={setCurrentSlide}
          className="welcome-dialog__carousel-wrapper"
        >
          {carouselSlides.map((slide, index) => (
            <img
              key={index}
              src={slide.image}
              alt={slide.title}
              className="welcome-dialog__carousel-image"
            />
          ))}
        </Carousel>

        {/* Description */}
        <p className="welcome-dialog__description">
          {slide.description}
        </p>

        {/* CTA Button */}
        <div className="welcome-dialog__cta">
          <Button
            variant="primary"
            size="large"
            onClick={slide.buttonAction}
          >
            {slide.buttonText}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Hook to manage welcome dialog visibility based on preferences
 */
export function useWelcomeDialog() {
  const { preferences } = usePreferences();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Show welcome dialog on first load if preference is enabled
    if (preferences.showWelcomeDialog) {
      setIsOpen(true);
    }
  }, []); // Only check on mount

  const handleClose = () => {
    setIsOpen(false);
  };

  return { isOpen, onClose: handleClose };
}

export default WelcomeDialog;
