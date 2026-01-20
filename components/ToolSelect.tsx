
import React from 'react';
import { ControlTool } from '../types';

interface ToolSelectProps {
  value: string;
  onChange: (value: string) => void;
}

const ToolSelect: React.FC<ToolSelectProps> = ({ value, onChange }) => {
  const options = Object.values(ControlTool);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
};

export default ToolSelect;
