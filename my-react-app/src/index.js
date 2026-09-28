import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Error Boundary to catch hidden "Script error." crashes
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Caught Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-2xl mx-auto font-sans">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Application Crash Detected</h1>
          <p className="text-slate-600 mb-4">
            If you see "Script error" below, it is likely caused by a <b>browser extension</b> (like an adblocker or React DevTools). 
            Try disabling extensions or opening this page in Incognito mode.
          </p>
          <pre className="bg-red-50 border border-red-200 p-4 rounded text-xs text-red-800 overflow-auto whitespace-pre-wrap">
            {this.state.error && this.state.error.toString()}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);