import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.tsx';
import Landing from './pages/Landing.tsx';
import Diag from './pages/Diag.tsx';
import Track from './pages/Track.tsx';
import Duel from './pages/Duel.tsx';
import Replay from './pages/Replay.tsx';
import CursorHUD from './components/CursorHUD.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CursorHUD />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/terminal" element={<App />} />
        <Route path="/duel" element={<Duel />} />
        <Route path="/replay" element={<Replay />} />
        <Route path="/diag" element={<Diag />} />
        <Route path="/track" element={<Track />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
