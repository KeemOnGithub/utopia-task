import { describe, it, expect, vi } from 'vitest';
import { extractJsonText, OpenAiChatCompletionsProvider } from './provider.js';

describe('extractJsonText', () => {
  it('parses plain JSON correctly', () => {
    const raw = '{"kind": "query", "plan": {"operation": "countOrders"}}';
    expect(extractJsonText(raw)).toBe(raw);
    expect(JSON.parse(extractJsonText(raw))).toEqual({
      kind: 'query',
      plan: { operation: 'countOrders' }
    });
  });

  it('strips markdown ```json code fences', () => {
    const raw = '```json\n{\n  "kind": "clarification",\n  "message": "test"\n}\n```';
    expect(JSON.parse(extractJsonText(raw))).toEqual({
      kind: 'clarification',
      message: 'test'
    });
  });

  it('strips markdown ``` code fences without language tag', () => {
    const raw = '```\n{\n  "kind": "unsupported",\n  "message": "test"\n}\n```';
    expect(JSON.parse(extractJsonText(raw))).toEqual({
      kind: 'unsupported',
      message: 'test'
    });
  });

  it('strips <think>...</think> reasoning tags and markdown fences', () => {
    const raw = '<think>I need to construct a query plan.</think>\n```json\n{"kind": "query"}\n```';
    expect(JSON.parse(extractJsonText(raw))).toEqual({
      kind: 'query'
    });
  });

  it('extracts outermost JSON object from conversational surrounding text', () => {
    const raw = 'Here is the response:\n{"kind": "query", "plan": null}\nHope that helps!';
    expect(JSON.parse(extractJsonText(raw))).toEqual({
      kind: 'query',
      plan: null
    });
  });
});

describe('OpenAiChatCompletionsProvider with markdown-fenced responses', () => {
  it('successfully interprets questions when provider wraps JSON in markdown code blocks', async () => {
    const mockFencedJson = '```json\n{\n  "kind": "clarification",\n  "message": "Which technician?"\n}\n```';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: mockFencedJson
            }
          }
        ]
      })
    });

    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAiChatCompletionsProvider({
      enabled: true,
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model'
    });

    const result = await provider.interpretQuestion(
      'Find orders',
      [],
      null,
      [],
      new Date('2026-10-25T12:00:00Z')
    );

    expect(result).toEqual({
      kind: 'clarification',
      message: 'Which technician?'
    });

    vi.unstubAllGlobals();
  });
});
