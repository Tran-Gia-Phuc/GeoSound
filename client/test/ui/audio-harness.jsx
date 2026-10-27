import React from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioController } from '../../src/hooks/useAudioController.js';
function Harness() {
  const audio = useAudioController();
  window.controller = audio;
  return <output>{JSON.stringify(audio.state)}</output>;
}
createRoot(document.getElementById('root')).render(<Harness />);
