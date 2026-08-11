import React from 'react';
import figma from '@figma/code-connect';
import { ClipHeader } from './ClipHeader';

/**
 * Figma Code Connect for ClipHeader component
 * Links the ClipHeader component to its Figma design
 */
figma.connect(
  ClipHeader,
  'https://www.figma.com/design/8rgC6MOTSEY1MHO4wWnucb/01---Audacity-Component-library?node-id=2293-148397',
  {
    example: () => (
      <ClipHeader
        color="blue"
        selected={false}
        name="Audio Clip"
        width={224}
        showMenu={true}
        onMenuClick={(e) => console.log('Menu clicked')}
      />
    ),
  }
);
