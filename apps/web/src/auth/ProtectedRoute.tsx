import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { LoginPage } from '../pages/LoginPage';
export function AuthGate(){
  const auth=useAuth();
  if(auth.phase==='anonymous' || auth.phase==='recovering')return <LoginPage/>;
  if(auth.phase==='forbidden')return <main className="surface"><h1 tabIndex={-1}>Access denied</h1><p>You do not have access to this portal.</p><button onClick={()=>void auth.logout()}>Sign out</button></main>;
  if(auth.phase==='unavailable')return <main className="surface"><h1 tabIndex={-1}>Session unavailable</h1><p role="alert">Your session could not be verified. Protected content remains hidden.</p><button onClick={()=>void auth.refreshSession()}>Retry session verification</button></main>;
  if(auth.phase==='unconfirmedLogout')return <main className="surface"><h1 tabIndex={-1}>Sign-out not confirmed</h1><p role="alert">Sign-out could not be confirmed. Retry.</p><p>Protected content and unsaved work have been cleared in this tab. Reloading may restore a still-valid session. Retrying revokes only the session presented on that retry.</p><button onClick={()=>void auth.logout()}>Retry sign out</button><button onClick={()=>void auth.refreshSession()}>Explicitly recheck session</button></main>;
  return <main><p role="status">{auth.phase==='signingOut'?'Signing out...':'Checking your session...'}</p></main>;
}
export function ProtectedRoute({children}:{children:ReactNode}){const auth=useAuth();return auth.phase==='authenticated'?children:<AuthGate/>;}
