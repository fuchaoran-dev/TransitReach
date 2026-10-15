import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApplicationBootstrap } from './app/ApplicationBootstrap';
import './index.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ApplicationBootstrap /></StrictMode>);
