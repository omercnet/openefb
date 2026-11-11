// The rules of efb-212/Views/Flights/DebriefView.swift that are not drawing. Swift has no test of the view; the cases follow its source.
import { FAKE_DEBRIEF } from '../ports/debriefEngine';
import { debriefErrorText, debriefPane, executionBadge, ratingStars, ratingText } from './debriefView';

const base = { completed: null, isGenerating: false, partial: null, engineError: null, promptError: null };

describe('debriefPane', () => {
  it('shows the finished debrief before anything else', () => {
    expect(
      debriefPane({ ...base, completed: FAKE_DEBRIEF, isGenerating: true, partial: {}, engineError: new Error('x') }),
    ).toBe('completed');
  });

  it('streams while it is generating and the first part has arrived', () => {
    expect(debriefPane({ ...base, isGenerating: true, partial: { narrativeSummary: 'A short' } })).toBe('streaming');
  });

  it('shows the error, from the engine or from building the prompt', () => {
    expect(debriefPane({ ...base, engineError: new Error('The model returned nothing.') })).toBe('error');
    expect(debriefPane({ ...base, promptError: { kind: 'debriefFailed', cause: new Error('disk') } })).toBe('error');
  });

  it('is the first pane for a flight with nothing yet', () => {
    expect(debriefPane(base)).toBe('initial');
  });

  it('is still the first pane between pressing Generate and the first part arriving, as in Swift', () => {
    expect(debriefPane({ ...base, isGenerating: true })).toBe('initial');
  });

  it('shows the error rather than the stream once generating has stopped with a partial result left', () => {
    expect(debriefPane({ ...base, partial: { narrativeSummary: 'A sh' }, engineError: new Error('cut off') })).toBe(
      'error',
    );
  });
});

describe('debriefErrorText', () => {
  it('is the message of the engine error', () => {
    expect(debriefErrorText(new Error('The model returned nothing.'), null)).toBe('The model returned nothing.');
  });

  it('is the wording of a prompt error, with the reason', () => {
    expect(debriefErrorText(null, { kind: 'debriefFailed', cause: new Error('disk I/O error') })).toBe(
      'Debrief failed: disk I/O error',
    );
  });

  it('prefers the engine error when both are there, as Swift does (engine.error ?? promptError)', () => {
    expect(
      debriefErrorText(new Error('from the engine'), { kind: 'debriefFailed', cause: new Error('from the prompt') }),
    ).toBe('from the engine');
  });

  it('is empty when there is no error', () => {
    expect(debriefErrorText(null, null)).toBe('');
  });
});

describe('ratingStars and ratingText', () => {
  it('fills as many of the five stars as the rating', () => {
    expect(ratingStars(3)).toEqual([true, true, true, false, false]);
    expect(ratingStars(5)).toEqual([true, true, true, true, true]);
    expect(ratingStars(1)).toEqual([true, false, false, false, false]);
  });

  it('a rating outside 1 to 5 fills none or all, and reads as given', () => {
    expect(ratingStars(0)).toEqual([false, false, false, false, false]);
    expect(ratingStars(7)).toEqual([true, true, true, true, true]);
    expect(ratingText(7)).toEqual({ text: 'Rating: 7/5', spoken: 'Rating: 7 out of 5' });
  });

  it('is spoken out of five', () => {
    expect(ratingText(4)).toEqual({ text: 'Rating: 4/5', spoken: 'Rating: 4 out of 5' });
  });
});

describe('executionBadge', () => {
  it('says the verdict in words as well as colour', () => {
    expect(executionBadge(true)).toEqual({ text: 'Well executed', ok: true });
    expect(executionBadge(false)).toEqual({ text: 'Needs work', ok: false });
  });
});
