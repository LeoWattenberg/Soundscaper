import React from 'react';
import figma from '@figma/code-connect';
import { PanKnob } from './PanKnob';

/**
 * Figma Code Connect for PanKnob component
 * Links the PanKnob component to its Figma design
 */
figma.connect(
  PanKnob,
  'https://www.figma.com/design/8rgC6MOTSEY1MHO4wWnucb/01---Audacity-Component-library?node-id=111-1383',
  {
    example: () => (
      <PanKnob
        value={0}
        onChange={(newValue) => console.log('Pan changed to:', newValue)}
      />
    ),
  }
);
