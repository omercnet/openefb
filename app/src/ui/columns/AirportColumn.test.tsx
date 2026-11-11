import { StyleSheet } from 'react-native';
import { render } from '../../../tests/support/ui';
import { Space } from '../tokens';
import { AirportColumn } from './AirportColumn';

describe('AirportColumn header', () => {
  const titleBlock = async () => {
    const view = await render(<AirportColumn />);
    const [block] = view.byRole('header').filter((n) => String(n.props.accessibilityLabel).includes('flight category'));
    return { view, block };
  };

  it('speaks the identifier, the flight category and the name as one header', async () => {
    const { block } = await titleBlock();
    expect(block.props.accessibilityLabel).toBe('KSQL, flight category MVFR, San Carlos Airport');
    expect(block.props.accessible).toBe(true);
  });

  it('hugs its content: the block has no flex of its own inside the header wrapper', async () => {
    // React Native lays Yoga out with YGErrataAll (YogaLayoutableShadowNode.cpp). Under it a flexing block inside the
    // wrapper is stretched to the header row's 60 pt minimum height instead of hugging its content (4 + 37 + 16.5 + 4 =
    // 61.5 pt), so the band ended 1.5 pt short and every row below sat 1.5 pt high on iOS and Android (airport SSIM 0.885
    // and 0.858, run 43102552494). Reproduced with yoga-layout 3.2.1: nested flex 60, no flex 61.5.
    const { block } = await titleBlock();
    const style = StyleSheet.flatten(block.props.style);
    expect(style.flex).toBeUndefined();
    expect(style.flexGrow).toBeUndefined();
    expect(style.paddingVertical).toBe(Space.xs);
  });

  it('has the Log back button of the shared header', async () => {
    const { view } = await titleBlock();
    expect(view.byLabel('Back to flight log')).toHaveLength(1);
  });
});
