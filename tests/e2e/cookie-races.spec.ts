import {test,expect,request as httpRequest} from '@playwright/test';
const origin='http://localhost:5178';
const headers={origin,'x-csrf-protection':'1','content-type':'application/json'};
const credentials=(email:string)=>({email,password:'browser synthetic password'});
test('delayed logout deletes newer browser cookie but does not revoke the other login session',async({page,context})=>{
 const http=await httpRequest.newContext({baseURL:origin});
 try{
  const login=await http.post('/api/auth/login',{headers,data:credentials('browser20@example.test')});expect(login.status()).toBe(200);
  const cookieA=login.headers()['set-cookie'].split(';')[0];await context.addCookies([{name:'dev_session',value:cookieA.split('=')[1],url:origin}]);
  await page.goto('/orders');await expect(page.getByRole('heading',{name:'Service orders',exact:true})).toBeVisible();
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let markCommitted!:()=>void;const committed=new Promise<void>(resolve=>{markCommitted=resolve;});
  await page.route('**/api/auth/logout',async route=>{const response=await http.post('/api/auth/logout',{headers:{...headers,cookie:cookieA},data:{}});expect(response.status()).toBe(204);markCommitted();await held;await route.fulfill({status:204,headers:response.headers(),body:''});});
  const logout=page.evaluate(async()=>{const r=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Protection':'1'},body:'{}'});return r.status;});
  await committed;
  const newer=await http.post('/api/auth/login',{headers,data:credentials('browser21@example.test')});expect(newer.status()).toBe(200);const cookieB=newer.headers()['set-cookie'].split(';')[0];await context.addCookies([{name:'dev_session',value:cookieB.split('=')[1],url:origin}]);
  release();expect(await logout).toBe(204);expect((await context.cookies()).some(c=>c.name==='dev_session')).toBe(false);
  const valid=await http.get('/api/auth/session',{headers:{cookie:cookieB}});expect(valid.status()).toBe(200);expect((await valid.json()).data.user.email).toBe('browser21@example.test');
 }finally{await http.dispose();}
});
test('a delayed committed login can establish a valid cookie after an earlier-token logout',async({page,context})=>{
 const http=await httpRequest.newContext({baseURL:origin});
 try{
  const login=await http.post('/api/auth/login',{headers,data:credentials('browser22@example.test')});const cookieA=login.headers()['set-cookie'].split(';')[0];await context.addCookies([{name:'dev_session',value:cookieA.split('=')[1],url:origin}]);
  await page.goto('/orders');await expect(page.getByRole('heading',{name:'Service orders',exact:true})).toBeVisible();
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let markCommitted!:()=>void;const committed=new Promise<void>(resolve=>{markCommitted=resolve;});
  await page.route('**/api/auth/login',async route=>{const response=await http.post('/api/auth/login',{headers:{...headers,cookie:cookieA},data:credentials('browser23@example.test')});expect(response.status()).toBe(200);markCommitted();await held;await route.fulfill({response});});
  const late=page.evaluate(async()=>{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Protection':'1'},body:JSON.stringify({email:'browser23@example.test',password:'browser synthetic password'})});return response.status;});await committed;
  const loggedOut=await page.request.post('/api/auth/logout',{headers:{...headers,cookie:cookieA},data:{}});expect(loggedOut.status()).toBe(204);expect((await context.cookies()).some(c=>c.name==='dev_session')).toBe(false);
  release();expect(await late).toBe(200);const actual=await page.request.get('/api/auth/session');expect(actual.status()).toBe(200);expect((await actual.json()).data.user.email).toBe('browser23@example.test');
 }finally{await http.dispose();}
});
