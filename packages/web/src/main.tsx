import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.js';

console.log(
    '%c🛡️ Swazz API Fuzzer\n%cПрисоединяйтесь к разработке на GitHub: https://github.com/SecH0us3/swazz\n💡 Предложить идею — тоже участие!',
    'font-size: 20px; font-weight: bold; color: #8b5cf6;',
    'font-size: 14px; color: #a1a1aa; line-height: 1.5;'
);

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
