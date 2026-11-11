import { createContext, useContext } from 'react';
import type { Client } from './client';
import type { Appearance, PanelData } from './types';
export type Route =
  'overview' | 'sandboxes' | 'models' | 'activity' | 'appearance' | 'security' | 'guide';
export interface PanelContext {
  data: PanelData;
  client: Client;
  demo: boolean;
  days: number;
  setDays: (days: number) => void;
  names: Record<number, string>;
  setNames: (names: Record<number, string>) => void;
  appearance: Appearance;
  setAppearance: (value: Appearance) => void;
  navigate: (route: Route) => void;
  refresh: () => Promise<void>;
  run: (task: () => Promise<unknown>, message: string) => Promise<boolean>;
  notify: (text: string, error?: boolean) => void;
}
export const Context = createContext<PanelContext | null>(null);
export function usePanel() {
  const context = useContext(Context);
  if (!context) throw new Error('Panel context missing');
  return context;
}
