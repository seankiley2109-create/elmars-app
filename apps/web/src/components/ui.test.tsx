import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Button, FOCUS_RING, fieldCls, inputCls } from './ui';

afterEach(cleanup);

describe('focus', () => {
  it('fields show a real 2px focus outline, not just a border colour', () => {
    for (const cls of FOCUS_RING.split(' ')) {
      expect(fieldCls.split(' ')).toContain(cls);
      expect(inputCls.split(' ')).toContain(cls);
    }
    expect(FOCUS_RING).toMatch(/focus-visible:outline-2/);
    expect(FOCUS_RING).toMatch(/focus-visible:outline-offset-2/);
    expect(FOCUS_RING).toMatch(/focus-visible:outline-focus/);
  });
});

describe('Button', () => {
  it('is a secondary, non-submitting button by default', () => {
    render(<Button>Later</Button>);
    const b = screen.getByRole('button', { name: 'Later' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.className).toContain('border-line-strong');
  });

  it('draws primary in the Montana action colour and quiet without a border', () => {
    render(
      <>
        <Button variant="primary">New</Button>
        <Button variant="quiet">Skip</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'New' }).className).toMatch(/\bbg-action\b/);
    expect(screen.getByRole('button', { name: 'Skip' }).className).toMatch(/\bborder-transparent\b/);
  });
});
