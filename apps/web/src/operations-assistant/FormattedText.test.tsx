// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FormattedText } from './FormattedText.js';

describe('FormattedText', () => {
  it('renders bold text with asterisks properly as strong tags', () => {
    const text = 'Based on the retrieved data, **1 service order** exists in the system.';
    const { container } = render(<FormattedText text={text} />);

    const strongEl = container.querySelector('strong');
    expect(strongEl).not.toBeNull();
    expect(strongEl?.textContent).toBe('1 service order');
    expect(container.textContent).toBe('Based on the retrieved data, 1 service order exists in the system.');
    // Ensure literal asterisks are NOT present in output
    expect(container.textContent).not.toContain('**');
  });

  it('renders multiple bold elements in the same sentence', () => {
    const text = 'Technician **Ali** has **3 orders** assigned.';
    const { container } = render(<FormattedText text={text} />);

    const strongEls = container.querySelectorAll('strong');
    expect(strongEls).toHaveLength(2);
    expect(strongEls[0]?.textContent).toBe('Ali');
    expect(strongEls[1]?.textContent).toBe('3 orders');
    expect(container.textContent).not.toContain('**');
  });

  it('renders italic formatting with single asterisks', () => {
    const text = 'This is an *important note* for operations.';
    const { container } = render(<FormattedText text={text} />);

    const emEl = container.querySelector('em');
    expect(emEl).not.toBeNull();
    expect(emEl?.textContent).toBe('important note');
    expect(container.textContent).not.toContain('*');
  });

  it('renders bold-italic with triple asterisks', () => {
    const text = 'This is ***critical information*** here.';
    const { container } = render(<FormattedText text={text} />);

    const strongEl = container.querySelector('strong');
    const emEl = strongEl?.querySelector('em');
    expect(strongEl).not.toBeNull();
    expect(emEl).not.toBeNull();
    expect(emEl?.textContent).toBe('critical information');
  });

  it('renders inline code with backticks', () => {
    const text = 'Use the `findOrders` operation.';
    const { container } = render(<FormattedText text={text} />);

    const codeEl = container.querySelector('code');
    expect(codeEl).not.toBeNull();
    expect(codeEl?.textContent).toBe('findOrders');
  });

  it('preserves mathematical and non-markdown asterisks', () => {
    const text = 'Calculate 2 * 3 = 6 and 5 * 10 = 50.';
    const { container } = render(<FormattedText text={text} />);

    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe('Calculate 2 * 3 = 6 and 5 * 10 = 50.');
  });

  it('renders bullet lists and ordered lists', () => {
    const text = 'Summary breakdown:\n- Ali: **1 order**\n- Bala: **2 orders**\n\nSteps:\n1. Open door\n2. Service unit';
    const { container } = render(<FormattedText text={text} />);

    const ul = container.querySelector('ul');
    const ol = container.querySelector('ol');
    expect(ul).not.toBeNull();
    expect(ol).not.toBeNull();

    const lis = container.querySelectorAll('li');
    expect(lis).toHaveLength(4);
    expect(lis[0]?.querySelector('strong')?.textContent).toBe('1 order');
  });

  it('handles empty or null text gracefully', () => {
    const { container } = render(<FormattedText text="" />);
    expect(container.firstChild).toBeNull();
  });
});
