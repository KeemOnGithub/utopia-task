import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth';
export function LoginPage(){
  const auth=useAuth();
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [pending,setPending]=useState(false);const [error,setError]=useState('');
  const [fields,setFields]=useState<Record<string,string[]>>({});const [retryAt,setRetryAt]=useState(0);const [now,setNow]=useState(Date.now());
  const emailRef=useRef<HTMLInputElement>(null);const passwordRef=useRef<HTMLInputElement>(null);const errorRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{emailRef.current?.focus();},[]);
  useEffect(()=>{if(!retryAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[retryAt]);
  async function submit(event:FormEvent){
    event.preventDefault();if(pending || retryAt>Date.now())return;
    const invalid:Record<string,string[]>={};
    if(!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))invalid.email=['Enter a valid email address.'];
    if(Array.from(password).length<8 || Array.from(password).length>128)invalid.password=['Use 8-128 Unicode characters.'];
    setFields(invalid);setError('');
    if(Object.keys(invalid).length){(invalid.email?emailRef:passwordRef).current?.focus();return;}
    setPending(true);
    try{await auth.login({email,password});setPassword('');}
    catch(failure){
      setPassword('');setError(failure instanceof ApiError?failure.message:'Sign in could not be confirmed. Retry signing in or check your session.');
      if(failure instanceof ApiError){setFields(failure.fieldErrors??{});if(failure.retryAfterSeconds)setRetryAt(Date.now()+failure.retryAfterSeconds*1000);}
      setTimeout(()=>errorRef.current?.focus(),0);
    }finally{setPending(false);}
  }
  const wait=Math.max(0,Math.ceil((retryAt-now)/1000));
  return <main className="login-page"><section className="surface login-card"><p className="muted">Sejuk Sejuk Service / Admin portal</p><h1 tabIndex={-1}>Sign in</h1>
    {auth.phase==='recovering' && <p role="status">Your session has expired. Sign in to continue. Unsaved work is retained only for the same account in this tab.</p>}
    {error && <div className="error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
    <form onSubmit={submit} noValidate aria-busy={pending}><p>All fields are required.</p>
      <label htmlFor="login-email">Email</label><input id="login-email" ref={emailRef} type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} aria-invalid={!!fields.email} aria-describedby={fields.email?'login-email-error':undefined}/>
      {fields.email && <p className="error" id="login-email-error">{fields.email.join(' ')}</p>}
      <label htmlFor="login-password">Password</label><input id="login-password" ref={passwordRef} type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} aria-invalid={!!fields.password} aria-describedby={fields.password?'login-password-error':undefined}/>
      {fields.password && <p className="error" id="login-password-error">{fields.password.join(' ')}</p>}
      <p role="status">{pending?'Signing in...':wait?`Try again in ${wait} seconds.`:''}</p><button className="primary" disabled={pending || wait>0} type="submit">{pending?'Signing in...':'Sign in'}</button>
    </form>
    {auth.phase==='recovering' && <button type="button" onClick={()=>void auth.refreshSession()}>Retry session verification</button>}
  </section></main>;
}
