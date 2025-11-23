export enum ShotStatus {
  DRAFT = 'DRAFT',
  LOCKED = 'LOCKED',
  RENDERING = 'RENDERING',
  RENDERED = 'RENDERED'
}

export interface CameraAngle {
  type: 'WIDE' | 'MEDIUM' | 'CLOSE_UP' | 'POV' | 'LOW_ANGLE' | 'HIGH_ANGLE';
  details?: string;
}

export class Shot {
  constructor(
    public readonly id: string,
    public visualPrompt: string,
    public cameraAngle: CameraAngle,
    public durationMs: number,
    public status: ShotStatus,
    public renderUrl?: string,
    public sequenceIndex?: number
  ) {}

  updatePrompt(newPrompt: string): void {
      this.visualPrompt = newPrompt;
  }
}
