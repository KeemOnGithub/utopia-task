export type Actor = {accountId:string;role:'admin'};
export type SessionData = {user:{id:string;email:string;role:'admin'};expiresAt:string};
export type ApiErrorBody = {error:{code:string;message:string;fieldErrors?:Record<string,string[]>;requestId:string}};
export type AuthBinding = {accountId:string;authGeneration:number};
