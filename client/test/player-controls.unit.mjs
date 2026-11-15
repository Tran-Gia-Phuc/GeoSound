import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: './vite.config.js',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});
const { default: PlayerBar } = await vite.ssrLoadModule('/src/features/player/PlayerBar.jsx');
after(() => vite.close());

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== 'object') return [];
  return [node, ...descendants(node.props?.children)];
}

test('transport seeks by 15 seconds and keeps stop navigation separate', () => {
  const seeks = [];
  const stops = [];
  const audio = {
    state: {
      status: 'paused',
      currentTime: 30,
      duration: 90,
      canSeek: true,
      trackId: 'first',
    },
    seek: (value) => seeks.push(value),
    toggle() {},
  };
  const engine = {
    currentPlace: { name: 'First stop' },
    currentRole: 'place',
    canPrev: true,
    canNext: true,
    prev: () => stops.push('previous'),
    next: () => stops.push('next'),
  };
  const buttons = descendants(PlayerBar({ audio, engine })).filter((node) => node.type === 'button');
  const button = (label) => buttons.find((node) => node.props['aria-label'] === label);

  button('Tua lùi 15 giây').props.onClick();
  button('Tua tới 15 giây').props.onClick();
  button('Điểm trước').props.onClick();
  button('Điểm kế tiếp').props.onClick();

  assert.deepEqual(seeks, [15, 45]);
  assert.deepEqual(stops, ['previous', 'next']);
});

test('TTS and loading disable unavailable controls', () => {
  const engine = { currentPlace: { name: 'Stop' }, canPrev: false, canNext: false };
  const audio = {
    state: { status: 'loading', trackId: 'first', canSeek: false },
    seek() {},
    toggle() {},
  };
  const buttons = descendants(PlayerBar({ audio, engine })).filter((node) => node.type === 'button');
  assert.equal(buttons.find((node) => node.props['aria-label'] === 'Tua lùi 15 giây').props.disabled, true);
  assert.equal(buttons.find((node) => node.props['aria-label'] === 'Phát').props.disabled, true);
});
