// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OperationsAssistantPage } from './OperationsAssistantPage';
import { clearTabConversationMemory } from '../operations-assistant/useConversation';
import { apiRequest } from '../api/client';
import type { AssistantResponse } from '@sejuk/contracts/operations-assistant';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
      public fieldErrors?: Record<string, string[]>,
      public requestId?: string,
      public retryAfterSeconds?: number
    ) {
      super(message);
    }
  }
}));

const mockAuth = {
  phase: 'authenticated',
  user: { id: '50000000-0000-4000-8000-000000000001', email: 'test@example.test', role: 'admin' },
  authGeneration: 1,
  binding: { accountId: '50000000-0000-4000-8000-000000000001', authGeneration: 1 },
  handleAuthError: vi.fn().mockReturnValue(false)
};

vi.mock('../auth', () => ({
  useAuth: () => mockAuth,
  subscribeAuthLifecycle: vi.fn(() => () => {})
}));

describe('OperationsAssistantPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTabConversationMemory(false);
  });

  afterEach(() => {
    cleanup();
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <OperationsAssistantPage />
      </MemoryRouter>
    );
  }

  it('renders H1, privacy warning, supported examples, and disabled Send on empty input', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Operations assistant');
    expect(screen.getByRole('note').textContent).toContain('External AI Notice');
    expect(screen.getByText(/Supported Queries/i)).toBeTruthy();

    const sendBtn = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('submits question and renders structured answer evidence', async () => {
    const mockResponse: AssistantResponse = {
      kind: 'answer',
      operation: 'countOrders',
      query: {
        operation: 'countOrders',
        filters: {
          technicianId: null,
          serviceType: null,
          dateBasis: 'createdAt',
          startDate: null,
          endDate: null,
          customerName: null,
          serviceText: null
        },
        orderNumber: null,
        rankingMetric: null
      },
      resolvedFilters: {
        technician: null,
        serviceType: null,
        dateBasis: 'createdAt',
        intervalLabel: 'All recorded history',
        startDate: null,
        endDate: null,
        startUtc: null,
        endUtc: null,
        customerName: null,
        serviceText: null
      },
      retrievedAt: '2026-10-24T12:00:00.000Z',
      narrative: 'Found 15 matching orders in recorded history.',
      summarySource: 'ai',
      evidence: {
        kind: 'countOrders',
        data: { matchingCount: '15' }
      }
    };

    vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

    renderPage();
    const input = screen.getByLabelText('Ask a question about service orders') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'How many orders total?' } });

    const sendBtn = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText('Found 15 matching orders in recorded history.')).toBeTruthy();
    });

    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('Matching Service Orders')).toBeTruthy();
  });

  it('renders clarification choices and allows clicking to submit', async () => {
    const mockClarification: AssistantResponse = {
      kind: 'clarification',
      message: 'Multiple technicians matched. Which technician did you mean?',
      choices: [
        { label: 'Ali', question: 'Show orders for Ali' },
        { label: 'Bala', question: 'Show orders for Bala' }
      ]
    };

    vi.mocked(apiRequest).mockResolvedValueOnce(mockClarification);

    renderPage();
    const input = screen.getByLabelText('Ask a question about service orders');
    fireEvent.change(input, { target: { value: 'Show orders for tech' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByText('Multiple technicians matched. Which technician did you mean?')).toBeTruthy();
    });

    const aliBtn = screen.getByRole('button', { name: 'Ali' });
    expect(aliBtn).toBeTruthy();
  });

  it('renders unsupported message with suggestions', async () => {
    const mockUnsupported: AssistantResponse = {
      kind: 'unsupported',
      message: 'Completion tracking is not recorded in service orders.',
      suggestions: [
        { label: 'View active orders', question: 'How many orders are assigned?' }
      ]
    };

    vi.mocked(apiRequest).mockResolvedValueOnce(mockUnsupported);

    renderPage();
    const input = screen.getByLabelText('Ask a question about service orders');
    fireEvent.change(input, { target: { value: 'How many jobs completed?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByText('Query Not Supported')).toBeTruthy();
      expect(screen.getByText('Completion tracking is not recorded in service orders.')).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'View active orders' })).toBeTruthy();
  });

  it('formats bold text with asterisks properly as strong tags in AI narrative', async () => {
    const mockResponse: AssistantResponse = {
      kind: 'answer',
      operation: 'countOrders',
      query: {
        operation: 'countOrders',
        filters: {
          technicianId: null,
          serviceType: null,
          dateBasis: 'createdAt',
          startDate: null,
          endDate: null,
          customerName: null,
          serviceText: null
        },
        orderNumber: null,
        rankingMetric: null
      },
      resolvedFilters: {
        technician: null,
        serviceType: null,
        dateBasis: 'createdAt',
        intervalLabel: 'All recorded history',
        startDate: null,
        endDate: null,
        startUtc: null,
        endUtc: null,
        customerName: null,
        serviceText: null
      },
      retrievedAt: '2026-10-24T12:00:00.000Z',
      narrative: 'Based on the retrieved data, **1 service order** exists in the system.',
      summarySource: 'ai',
      evidence: {
        kind: 'countOrders',
        data: { matchingCount: '1' }
      }
    };

    vi.mocked(apiRequest).mockResolvedValueOnce(mockResponse);

    const { container } = renderPage();
    const input = screen.getByLabelText('Ask a question about service orders') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'How many service orders?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      const strong = container.querySelector('article strong');
      expect(strong).not.toBeNull();
      expect(strong?.textContent).toBe('1 service order');
    });

    expect(container.textContent).toContain('1 service order');
    expect(container.textContent).not.toContain('**');
  });
});

