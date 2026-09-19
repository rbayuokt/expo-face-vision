import { createContext, useContext } from 'react';

import type { FaceCameraController } from './controller';

export const FaceCameraContext = createContext<FaceCameraController | null>(null);

/** The controller of the nearest `<FaceCamera>`, or the one passed explicitly. */
export function useFaceCameraController(
  explicit?: FaceCameraController | null
): FaceCameraController | null {
  const fromContext = useContext(FaceCameraContext);
  return explicit ?? fromContext;
}
