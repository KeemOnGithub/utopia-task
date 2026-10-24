export type RecoverySnapshot={accountId:string;returnPath:string;payload:unknown};
export interface RecoveryStore {capture(snapshot:RecoverySnapshot):void;takeFor(accountId:string):RecoverySnapshot|null;clear():void;}
let snapshot:RecoverySnapshot|null=null;
export const recoveryStore:RecoveryStore={
  capture(value){snapshot=value;},
  takeFor(accountId){const current=snapshot;snapshot=null;return current?.accountId===accountId?current:null;},
  clear(){snapshot=null;}
};
