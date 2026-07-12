import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import Landing from './pages/Landing.tsx';
import Judges from './pages/Judges.tsx';
import Diag from './pages/Diag.tsx';
import Track from './pages/Track.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/terminal" element={<App />} />
        <Route path="/judges" element={<Judges />} />
        <Route path="/diag" element={<Diag />} />
        <Route path="/track" element={<Track />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
