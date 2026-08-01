import type { DesktopApi } from './types';

declare global {
  interface Window {
    desktopAPI: DesktopApi;
  }
}

export {};
