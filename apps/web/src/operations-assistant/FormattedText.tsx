import type { CSSProperties, ReactNode } from 'react';

// Inline token pattern:
// 1. ***bold italic***
// 2. **bold** (permits inner single asterisks)
// 3. *italic* (excludes inner asterisks or newlines)
// 4. `code`
const TOKEN_PATTERN =
  '(\\*{3}(?!\\s)[^*]+?(?<!\\s)\\*{3}|\\*{2}(?!\\s)(?:[^*]|\\*(?!\\*))+?(?<!\\s)\\*{2}|(?<!\\*)\\*(?!\\s)[^*\\n]+?(?<!\\s)\\*(?!\\*)|`(?!\s)[^`\\n]+?(?<!\\s)`)';

function renderInline(text: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (!text) return [];
  if (depth > 3) return [text];

  const result: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Fresh regex per invocation to avoid lastIndex mutations during recursion
  const regex = new RegExp(TOKEN_PATTERN, 'g');

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      result.push(...renderPlainWithNewlines(plain, `${keyPrefix}-txt-${lastIndex}`));
    }

    const raw = match[0];
    const key = `${keyPrefix}-tok-${match.index}`;

    if (raw.startsWith('***') && raw.endsWith('***') && raw.length >= 6) {
      const inner = raw.slice(3, -3);
      result.push(
        <strong key={key} style={{ fontWeight: 700 }}>
          <em>{inner}</em>
        </strong>
      );
    } else if (raw.startsWith('**') && raw.endsWith('**') && raw.length >= 4) {
      const inner = raw.slice(2, -2);
      result.push(
        <strong key={key} style={{ fontWeight: 700 }}>
          {renderInline(inner, `${key}-b`, depth + 1)}
        </strong>
      );
    } else if (raw.startsWith('*') && raw.endsWith('*') && raw.length >= 2) {
      const inner = raw.slice(1, -1);
      result.push(
        <em key={key}>
          {renderInline(inner, `${key}-i`, depth + 1)}
        </em>
      );
    } else if (raw.startsWith('`') && raw.endsWith('`') && raw.length >= 2) {
      const inner = raw.slice(1, -1);
      result.push(
        <code
          key={key}
          style={{
            background: 'var(--surface-highlight, rgba(0, 0, 0, 0.05))',
            padding: '1px 5px',
            borderRadius: 4,
            fontSize: '0.9em',
            fontFamily: 'var(--font-mono, monospace)'
          }}
        >
          {inner}
        </code>
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const plain = text.slice(lastIndex);
    result.push(...renderPlainWithNewlines(plain, `${keyPrefix}-txt-${lastIndex}`));
  }

  return result;
}

function renderPlainWithNewlines(plain: string, keyPrefix: string): ReactNode[] {
  if (!plain.includes('\n')) {
    return [plain];
  }

  const lines = plain.split('\n');
  return lines.flatMap((line, idx) =>
    idx === 0 ? [line] : [<br key={`${keyPrefix}-br-${idx}`} />, line]
  );
}

interface Block {
  type: 'paragraph' | 'bullet-list' | 'ordered-list';
  text?: string;
  items?: string[];
}

function parseBlocks(rawText: string): Block[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const rawBlocks = normalized.split(/\n{2,}/);
  const blocks: Block[] = [];

  for (const rawBlock of rawBlocks) {
    const lines = rawBlock.split('\n');
    let currentList: Block | null = null;
    let paragraphLines: string[] = [];

    const flushParagraph = () => {
      if (paragraphLines.length > 0) {
        blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') });
        paragraphLines = [];
      }
    };

    const flushList = () => {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
    };

    for (const line of lines) {
      const bulletMatch = line.match(/^[-*]\s+(.*)$/);
      const orderedMatch = line.match(/^(\d+)\.\s+(.*)$/);

      if (bulletMatch) {
        flushParagraph();
        if (!currentList || currentList.type !== 'bullet-list') {
          flushList();
          currentList = { type: 'bullet-list', items: [] };
        }
        currentList.items!.push(bulletMatch[1] ?? '');
      } else if (orderedMatch) {
        flushParagraph();
        if (!currentList || currentList.type !== 'ordered-list') {
          flushList();
          currentList = { type: 'ordered-list', items: [] };
        }
        currentList.items!.push(orderedMatch[2] ?? '');
      } else {
        flushList();
        paragraphLines.push(line);
      }
    }

    flushParagraph();
    flushList();
  }

  return blocks;
}

export interface FormattedTextProps {
  text: string;
  className?: string;
  style?: CSSProperties;
}

export function FormattedText({ text, className, style }: FormattedTextProps) {
  if (!text) return null;

  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;

  if (blocks.length === 1 && blocks[0]!.type === 'paragraph') {
    return (
      <p className={className} style={{ margin: 0, ...style }}>
        {renderInline(blocks[0]!.text ?? '', 'p-0')}
      </p>
    );
  }

  return (
    <div className={className} style={style}>
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1;
        if (block.type === 'paragraph') {
          return (
            <p
              key={i}
              style={{
                margin: isLast ? 0 : '0 0 8px 0',
                lineHeight: style?.lineHeight ?? 1.5
              }}
            >
              {renderInline(block.text ?? '', `b-${i}`)}
            </p>
          );
        }
        if (block.type === 'bullet-list') {
          return (
            <ul
              key={i}
              style={{
                margin: isLast ? '6px 0 0 0' : '6px 0 10px 0',
                paddingLeft: 22,
                listStyleType: 'disc'
              }}
            >
              {block.items?.map((item, itemIdx) => (
                <li key={itemIdx} style={{ marginBottom: 4 }}>
                  {renderInline(item, `ul-${i}-${itemIdx}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ordered-list') {
          return (
            <ol
              key={i}
              style={{
                margin: isLast ? '6px 0 0 0' : '6px 0 10px 0',
                paddingLeft: 22,
                listStyleType: 'decimal'
              }}
            >
              {block.items?.map((item, itemIdx) => (
                <li key={itemIdx} style={{ marginBottom: 4 }}>
                  {renderInline(item, `ol-${i}-${itemIdx}`)}
                </li>
              ))}
            </ol>
          );
        }
        return null;
      })}
    </div>
  );
}
