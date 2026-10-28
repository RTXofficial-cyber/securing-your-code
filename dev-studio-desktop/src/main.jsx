import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './lib/monaco.js';
import './styles.css';
import '@xterm/xterm/css/xterm.css';

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
