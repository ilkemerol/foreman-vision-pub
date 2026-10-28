import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { setLang } from './logic/i18n.ts';
import { loadSettings } from './logic/settings.ts';
import './styles.css';

// the saved language before the first render, so nothing draws in the default first
setLang(loadSettings().lang);
createRoot(document.getElementById('root')!).render(<App />);
