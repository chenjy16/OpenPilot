import React from 'react';

interface StubViewProps {
  title: string;
  icon: string;
  description: string;
}

const StubView: React.FC<StubViewProps> = ({ title, icon, description }) => (
  <div className="flex h-full items-center justify-center">
    <div className="text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <h2 className="mb-2 text-lg font-semibold text-gray-700">{title}</h2>
      <p className="text-sm text-gray-500">{description}</p>
    </div>
  </div>
);

export default StubView;
