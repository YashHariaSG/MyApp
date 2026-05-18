export type Keypoint = {
  name: string;
  x: number;
  y: number;
  score: number;
};

export type BodyPosition = {
  x: number;
  y: number;
  confidence: number;
};

/** ok = sitting + fully visible in frame */
export type PresenceStatus = 'ok' | 'out_of_frame' | 'not_sitting' | 'no_person';

export type PresenceCheck = {
  id: 'visible' | 'sitting';
  label: string;
  passed: boolean;
};

export type PresenceResult = {
  status: PresenceStatus;
  visibleCount: number;
  isInFrame: boolean;
  isSitting: boolean;
  title: string;
  message: string;
  checks: PresenceCheck[];
};
