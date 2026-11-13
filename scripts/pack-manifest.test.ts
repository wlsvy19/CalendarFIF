import { expect, it } from 'vitest';
import { stageManifest } from './pack-manifest';

it('꾸리기용 package.json에는 koffi만 의존성으로 남긴다', () => {
  expect(stageManifest({ version: '0.3.0', dependencies: { firebase: '^13.3.0', koffi: '^3.3.8' } }, '3.3.8')).toEqual({
    name: 'calendarfif', productName: 'CalendarFIF', version: '0.3.0', private: true, main: 'desktop/main.cjs', dependencies: { koffi: '3.3.8' },
  });
});
