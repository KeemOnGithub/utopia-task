import { useEffect,useRef,useState } from 'react';
import { registerLeaveGuard } from '../navigation.js';
import { subscribeAuthLifecycle } from '../auth/index.js';
type Confirmation={message:string;confirmLabel:string;cancelLabel:string;resolve:(allow:boolean)=>void};
let ask:((message:string,confirmLabel:string,cancelLabel:string)=>Promise<boolean>)|null=null;
export function confirmEditor(message:string,confirmLabel='Discard changes and leave',cancelLabel='Stay'):Promise<boolean>{return ask?ask(message,confirmLabel,cancelLabel):Promise.resolve(false);}
export function EditorConfirmation(){
 const [confirmation,setConfirmation]=useState<Confirmation|null>(null);const dialog=useRef<HTMLDialogElement>(null);const previous=useRef<HTMLElement|null>(null);const pending=useRef<Confirmation|null>(null);pending.current=confirmation;
 useEffect(()=>{ask=(message,confirmLabel,cancelLabel)=>new Promise(resolve=>{previous.current=document.activeElement as HTMLElement;setConfirmation({message,confirmLabel,cancelLabel,resolve});});return()=>{ask=null;pending.current?.resolve(false);};},[]);
 useEffect(()=>subscribeAuthLifecycle(event=>{if(event.type!=='resume'){pending.current?.resolve(false);dialog.current?.close();setConfirmation(null);}}),[]);
 useEffect(()=>{if(confirmation){dialog.current?.showModal();dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();}},[confirmation]);
 function finish(allow:boolean){confirmation?.resolve(allow);dialog.current?.close();setConfirmation(null);previous.current?.focus();}
 return <dialog ref={dialog} aria-labelledby="editor-confirm-title" onCancel={e=>{e.preventDefault();finish(false);}}><h2 id="editor-confirm-title">Confirm action</h2><p>{confirmation?.message}</p><div className="actions"><button type="button" onClick={()=>finish(false)}>{confirmation?.cancelLabel??'Stay'}</button><button type="button" onClick={()=>finish(true)}>{confirmation?.confirmLabel??'Discard changes and leave'}</button></div></dialog>;
}
export function useEditorGuard(blocked:boolean,uncertain:boolean){
 const current=useRef({blocked,uncertain});current.current={blocked,uncertain};
 useEffect(()=>registerLeaveGuard(()=>!current.current.blocked?Promise.resolve(true):confirmEditor(current.current.uncertain?'It may already have completed. Leaving does not cancel it. Discard changes and leave?':'Discard unsaved changes and leave?')),[]);
 useEffect(()=>{if(!blocked)return;const handler=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[blocked]);
}
