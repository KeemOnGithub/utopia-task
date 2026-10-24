// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({value:{} as any,open:vi.fn(),dismiss:vi.fn(),refresh:vi.fn(),retry:vi.fn()}));
vi.mock('./useOrderDetail.js',()=>({useOrderDetail:()=>mock.value}));
vi.mock('./handoff.js',()=>({dismissCreation:(...args:unknown[])=>mock.dismiss(...args)}));
vi.mock('react-router-dom',()=>({useParams:()=>({orderId:'30000000-0000-4000-8000-000000000001'}),useLocation:()=>({state:'opaque-key'})}));
vi.mock('../auth/index.js',()=>({useAuth:()=>({binding:{accountId:'account',authGeneration:1},isCurrent:()=>true})}));
vi.mock('../navigation.js',()=>({GuardedLink:({to,children}:{to:string;children:unknown})=>createElement('a',{href:to},children as string)}));
vi.mock('../listings/navigation.js',()=>({openOrders:(value:unknown)=>mock.open(value),resolveListReturn:()=>null}));
import { OrderDetailPage } from '../pages/OrderDetailPage.js';
const receipt={orderId:'30000000-0000-4000-8000-000000000001',orderNumber:'SO-000001',createdAt:'2026-10-23T07:40:00.000Z'};
const order={id:receipt.orderId,orderNumber:receipt.orderNumber,customerName:'<script>plain text</script>',phone:'0123',address:'Line one\nLine two',problemDescription:'Not cooling',serviceType:'repair',quotedPrice:{currency:'MYR',amount:'0.00'},assignedTechnician:{id:'10000000-0000-4000-8000-000000000001',name:'Ali'},adminNotes:null,status:'assigned',createdByAccountId:'50000000-0000-4000-8000-000000000001',assignedByAccountId:'50000000-0000-4000-8000-000000000001',createdAt:receipt.createdAt,assignedAt:receipt.createdAt};
beforeEach(()=>{mock.value={state:{kind:'loading'},visit:{visitId:'visit',receipt,dismissed:false,creationIntent:true},visible:true,focus:null,retry:mock.retry,refreshVisit:mock.refresh};vi.clearAllMocks();});
afterEach(cleanup);
describe('saved order presentation',()=>{
  it('shows historical creation while loading and never offers new creation before ready',()=>{
    render(<OrderDetailPage/>);expect(screen.getByRole('status').textContent).toContain('was created. Loading');expect(screen.queryByText('Create another order')).toBeNull();expect(screen.getByRole('heading',{level:1}).textContent).toBe('Service order');
  });
  it('renders every section, selectable safe text, canonical zero money, KL semantic dates',()=>{
    mock.value.state={kind:'ready',order};const {container}=render(<OrderDetailPage/>);
    expect(screen.getByText('<script>plain text</script>')).toBeTruthy();expect(container.querySelector('script')).toBeNull();expect(screen.getByText('MYR 0.00')).toBeTruthy();expect(screen.getByText('No admin notes')).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Traceability'})).toBeTruthy();expect(screen.getAllByText('23 Oct 2026, 15:40 MYT')).toHaveLength(2);expect(container.querySelector('time')?.getAttribute('datetime')).toBe(receipt.createdAt);expect(screen.getByRole('link',{name:'Create another order'}).getAttribute('href')).toBe('/orders/new');
    fireEvent.click(screen.getByRole('button',{name:'Dismiss creation confirmation'}));expect(mock.dismiss).toHaveBeenCalledWith('visit');expect(document.activeElement?.textContent).toBe('Customer details');
  });
  it('keeps receipt-backed missing feedback distinct from failed creation and retries only read',()=>{
    mock.value.state={kind:'missing',message:'Order not found. Its saved details are not available.',retryAt:0};render(<OrderDetailPage/>);
    expect(screen.getByRole('status').textContent).toContain('was created, but');fireEvent.click(screen.getByRole('button',{name:'Retry loading'}));expect(mock.retry).toHaveBeenCalledTimes(1);expect(screen.queryByText('Create another order')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Service orders'}));expect(mock.open).toHaveBeenCalledWith({kind:'newestOrders'});
  });
  it('withholds success and customer text on receipt mismatch, and all content under auth gates',()=>{
    mock.value.state={kind:'consistencyError',message:'The saved order details could not be verified.',retryAt:0,suppressReceipt:true};const {rerender,container}=render(<OrderDetailPage/>);expect(screen.queryByRole('status')).toBeNull();expect(screen.queryByText(order.customerName)).toBeNull();
    mock.value.visible=false;rerender(<OrderDetailPage/>);expect(container.textContent).toBe('');
  });
});
