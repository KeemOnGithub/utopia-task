import { apiRequest } from './client.js';
import type {
  AssistantQueryRequest,
  AssistantResponse
} from '../../../../packages/contracts/src/operations-assistant.js';

export async function queryOperationsAssistant(
  body: AssistantQueryRequest,
  signal?: AbortSignal
): Promise<AssistantResponse> {
  return apiRequest<AssistantResponse>('/operations-assistant/query', {
    method: 'POST',
    body: JSON.stringify(body),
    signal
  });
}

