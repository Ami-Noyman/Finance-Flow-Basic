
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  handleReset = () => {
    if(confirm('This will delete all data. Are you sure?')) {
      localStorage.clear();
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Unknown Error";
      try {
          if (this.state.error instanceof Error) {
              errorMessage = this.state.error.message + "\n" + (this.state.error.stack || "");
          } else if (typeof this.state.error === 'string') {
              errorMessage = this.state.error;
          } else {
              // Safe stringify to handle cyclic objects
              const cache = new Set();
              errorMessage = JSON.stringify(this.state.error, (key, value) => {
                if (typeof value === 'object' && value !== null) {
                  if (cache.has(value)) return '[Circular]';
                  cache.add(value);
                }
                return value;
              }, 2);
          }
      } catch (e) {
          errorMessage = "Error message could not be serialized safely.";
      }

      return (
        <div style={{minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', backgroundColor:'#f9fafb', padding:'1rem'}}>
          <div style={{backgroundColor:'white', padding:'2rem', borderRadius:'0.75rem', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.1)', maxWidth:'32rem', width:'100%', textAlign:'center'}}>
            <h1 style={{color:'#dc2626', fontWeight:'bold', fontSize:'1.5rem', marginBottom:'1rem'}}>Something went wrong</h1>
            <p style={{color:'#4b5563', marginBottom:'1.5rem'}}>The application encountered an unexpected error.</p>
            <div style={{backgroundColor:'#f3f4f6', padding:'1rem', borderRadius:'0.25rem', textAlign:'left', fontSize:'0.75rem', color:'#6b7280', marginBottom:'1.5rem', overflow:'auto', maxHeight:'12rem', whiteSpace: 'pre-wrap'}}>
              {errorMessage}
            </div>
            <div style={{display:'flex', gap:'1rem', justifyContent:'center'}}>
                <button 
                  onClick={() => window.location.reload()}
                  style={{padding:'0.5rem 1rem', backgroundColor:'#2563eb', color:'white', borderRadius:'0.25rem', border:'none', cursor:'pointer'}}
                >
                  Reload Page
                </button>
                <button 
                  onClick={this.handleReset}
                  style={{padding:'0.5rem 1rem', backgroundColor:'#fee2e2', color:'#b91c1c', borderRadius:'0.25rem', border:'none', cursor:'pointer'}}
                >
                  Reset All Data
                </button>
            </div>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
