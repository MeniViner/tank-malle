import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CivilDateField } from './CivilDateField';

const render = (draftText: string) => renderToStaticMarkup(createElement(CivilDateField, {
  label: 'תאריך ביצוע', 'data-testid': 'care-day', draftText, onDraftTextChange: () => undefined,
}));

describe('civil-date draft and picker boundary', () => {
  it('preserves invalid text while keeping an unparseable day out of the native picker', () => {
    const markup = render('31/02/2026');
    expect(markup).toMatch(/<input[^>]*data-testid="care-day"[^>]*type="text"[^>]*value="31\/02\/2026"/);
    expect(markup).toMatch(/<input[^>]*type="date"[^>]*value=""/);
    expect(markup.match(/data-testid="care-day"/g)).toHaveLength(1);
  });

  it('interprets an ambiguous calendar date day first and isolates the editable digits', () => {
    const markup = render('01/02/2026');
    expect(markup).toMatch(/<input[^>]*type="text"[^>]*dir="ltr"[^>]*value="01\/02\/2026"/);
    expect(markup).toMatch(/<input[^>]*type="date"[^>]*value="2026-02-01"/);
  });

  it('retains a partial date without turning it into today or a previous valid value', () => {
    const markup = render('05/09/');
    expect(markup).toContain('value="05/09/"');
    expect(markup).toMatch(/<input[^>]*type="date"[^>]*value=""/);
  });
});
