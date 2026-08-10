import { render } from 'preact';

import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('app');
if (!rootElement) {
  throw new Error('No se encontró el elemento #app para montar la UI.');
}

render(<App />, rootElement);
