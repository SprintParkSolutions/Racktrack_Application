import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';
import './fonts.css';
import { installFetchInterceptor } from './utils/api.js';

installFetchInterceptor();

// The boundary wraps App rather than living inside it, so an error thrown by
// App's own providers or routing is still caught. Anything it does not catch
// would leave the user on a blank page with nothing to report.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
