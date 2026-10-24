import Fastify from 'fastify';
import type { Pool } from 'pg';
import { afterEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({authorize:vi.fn(),load:vi.fn()}));
vi.mock('../auth/index.js',()=>({requireAdmin:(...args:unknown[])=>mocks.authorize(...args)}));
vi.mock('./queries.js',()=>({loadOrderDetail:(...args:unknown[])=>mocks.load(...args)}));
import { registerOrderDetailRoutes } from './routes.js';
import { AppError,sendApiError } from '../errors.js';
const id='30000000-0000-4000-8000-000000000001';
const servers:ReturnType<typeof Fastify>[]=[];
function server(){const app=Fastify();servers.push(app);app.decorate('db',{} as Pool);app.setErrorHandler((error,request,reply)=>sendApiError(reply,error,request.id));registerOrderDetailRoutes(app);return app;}
afterEach(async()=>{await Promise.all(servers.splice(0).map(app=>app.close()));vi.resetAllMocks();});
describe('authorized detail route',()=>{
  it('authorizes before invalid identifier/query validation',async()=>{
    mocks.authorize.mockRejectedValue(new AppError(401,'UNAUTHENTICATED','Your session has expired. Sign in again.'));
    const response=await server().inject({url:'/api/service-orders/not-a-uuid?created=true'});
    expect(response.statusCode).toBe(401);expect(mocks.load).not.toHaveBeenCalled();expect(response.headers['set-cookie']).toBeUndefined();
  });
  it.each([`/api/service-orders/not-a-uuid`,`/api/service-orders/${id}?created=true`,`/api/service-orders/${id}?cursor=x&cursor=y`,`/api/service-orders/${id}?created=`])('rejects invalid or query-bearing read %s',async url=>{
    mocks.authorize.mockResolvedValue({accountId:id,role:'admin'});expect((await server().inject({url})).statusCode).toBe(400);expect(mocks.load).not.toHaveBeenCalled();
  });
  it('canonicalizes the identifier and returns one independently loaded result',async()=>{
    mocks.authorize.mockResolvedValue({accountId:id,role:'admin'});mocks.load.mockResolvedValue({id});const response=await server().inject({url:`/api/service-orders/${id.toUpperCase()}`});
    expect(response.statusCode).toBe(200);expect(response.json()).toEqual({data:{id}});expect(mocks.load.mock.calls[0]![1]).toBe(id);expect(response.headers['set-cookie']).toBeUndefined();
  });
});
