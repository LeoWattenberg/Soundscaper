import React from 'react';
import './Label.css';

export interface LabelRectangleProps {
  startTime: number;
  endTime: number;
}

export const LabelRectangle: React.FC<LabelRectangleProps> = ({
  startTime,
  endTime,
}) => {
  return (
    <div className="label">
      Hello
    </div>
  );
};
