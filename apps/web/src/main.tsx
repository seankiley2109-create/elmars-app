import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import App from './App';
import './fonts.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* One place makes every framer-motion animation honor prefers-reduced-motion: the global CSS
          rule can only stop CSS transitions, not framer's JS-driven transforms. "user" keeps opacity
          fades but drops transform/layout motion when the OS asks for reduced motion. */}
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </BrowserRouter>
  </React.StrictMode>,
);
