import React from 'react';
import ReactDOM from 'react-dom/client';
import { MigrationUI } from './components/migration/migration-ui';
import './styles/migration.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <MigrationUI />
  </React.StrictMode>
);