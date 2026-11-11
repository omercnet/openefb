import { formatVisibility, visibilityMetres } from './metarVisibility';

describe('METAR visibility', () => {
  it('nineNineNineNineMeansTenKilometresOrMore', () => {
    const raw = 'METAR LLBG 010920Z 29005KT 250V330 9999 FEW025 26/15 Q1017 NOSIG';
    expect(visibilityMetres(raw)).toBe(9999);
    expect(formatVisibility(9999)).toBe('\u226510 km');
  });
  it('belowTenKilometresIsShownInMetres', () => {
    expect(visibilityMetres('LLHA 011950Z VRB03KT 4000 HZ SCT020 24/20 Q1015')).toBe(4000);
    expect(formatVisibility(4000)).toBe('4000 m');
    expect(visibilityMetres('LLER 011950Z 28010KT 0800 FG VV002 12/12 Q1015')).toBe(800);
    expect(formatVisibility(800)).toBe('800 m');
  });
  it('cavokReadsAsTenKilometresOrMore', () => {
    expect(visibilityMetres('LLIB 011950Z 30008KT CAVOK 28/12 Q1014')).toBe(9999);
  });
  it('usStatuteMileReportsHaveNoMetricVisibility', () => {
    expect(visibilityMetres('KPAO 011953Z 31008KT 10SM FEW040 18/09 A3002')).toBeNull();
    expect(visibilityMetres('KSFO 011956Z 28012KT 1/2SM FG OVC002 12/11 A2998')).toBeNull();
    expect(visibilityMetres(null)).toBeNull();
  });
  it('aTimeOrTemperatureGroupIsNeverReadAsVisibility', () => {
    expect(visibilityMetres('LLBG 010920Z 29005KT 26/15 Q1017')).toBeNull();
  });
});
