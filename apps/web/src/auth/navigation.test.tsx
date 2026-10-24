// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest';
import { act,cleanup,render,waitFor } from '@testing-library/react';
import { createMemoryRouter,RouterProvider,Outlet } from 'react-router-dom';
import { NavigationBridge,guardedNavigate,registerLeaveGuard } from '../navigation';
afterEach(cleanup);
function setup(){
  const router=createMemoryRouter([{element:<><NavigationBridge/><Outlet/></>,children:[{path:'/one',element:<h1>One</h1>},{path:'/two',element:<h1>Two</h1>}]}],{initialEntries:['/one','/two']});
  render(<RouterProvider router={router}/>);return router;
}
describe('guarded route navigation',()=>{
  it('keeps route on cancellation and offers a one-transition bypass only',async()=>{
    const router=setup();const guard=vi.fn(async()=>false);const stop=registerLeaveGuard(guard);
    try{
      await act(async()=>{expect(await guardedNavigate('/one')).toBe(false);});expect(router.state.location.pathname).toBe('/two');
      await act(async()=>{expect(await guardedNavigate('/one',{replace:true,bypassGuard:true,state:{private:'must not persist'}})).toBe(true);});
      expect(router.state.location.pathname).toBe('/one');expect(router.state.location.state).toBe(null);expect(guard).toHaveBeenCalledTimes(1);
      await act(async()=>{expect(await guardedNavigate('/two')).toBe(false);});expect(router.state.location.pathname).toBe('/one');expect(guard).toHaveBeenCalledTimes(2);
    }finally{stop();router.dispose();}
  });
  it('awaits the same guard for browser Back and Forward before committing a URL',async()=>{
    const router=setup();const guard=vi.fn(async()=>false);const stop=registerLeaveGuard(guard);
    try{
      await act(async()=>router.navigate(-1));await waitFor(()=>expect(guard).toHaveBeenCalledTimes(1));expect(router.state.location.pathname).toBe('/two');
      guard.mockResolvedValue(true);await act(async()=>router.navigate(-1));await waitFor(()=>expect(router.state.location.pathname).toBe('/one'));
      await act(async()=>router.navigate(1));await waitFor(()=>expect(router.state.location.pathname).toBe('/two'));expect(guard).toHaveBeenCalledTimes(3);
    }finally{stop();router.dispose();}
  });
});
